from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import detection_document

from vitroctl.detectors.contract import RuntimeDescriptor
from vitroctl.worker import inference
from vitroctl.worker.inference import InferenceRunner
from vitroctl.worker.inference_process import InferenceExecutionError
from vitroctl.worker.inference_protocol import Assignment, InferenceClient
from vitroctl.worker.model_store import ModelManifest, ModelStore
from vitroctl.worker.session import LeaseLostError, WorkerClient, WorkerSession

RUNTIME = RuntimeDescriptor(adapter="traditional", fingerprint="b" * 64)
SESSION = WorkerSession("test-session", "2026-08-27T00:00:00+00:00", (RUNTIME,), 8192)
MANIFEST = {
    "schemaVersion": 1,
    "modelVersionId": "traditional-v1",
    "classes": ["ungerminated", "germinated"],
    "artifact": {"kind": "traditional", "digest": "a" * 64},
}
DOCUMENT = {
    "manifest": MANIFEST,
    "image": "c" * 64,
    "attempt": 3,
    "serverTime": "2026-10-27T00:00:00Z",
    "leaseExpiresAt": "2026-10-27T00:01:30Z",
    "deadlineAt": "2026-10-27T00:15:00Z",
}


class Workbench:
    def __init__(self, *, lease_status: int = 200, result_status: int = 200):
        self.assignments: list[dict[str, Any]] = [
            DOCUMENT,
            {**DOCUMENT, "image": "d" * 64},
        ]
        self.calls: list[httpx.Request] = []
        self.lease_status = lease_status
        self.result_status = result_status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        path = request.url.path
        if path.endswith("/claim"):
            return httpx.Response(
                200,
                json={
                    "assignment": self.assignments.pop(0) if self.assignments else None
                },
            )
        if path.endswith("/lease"):
            return httpx.Response(
                self.lease_status,
                json={
                    k: DOCUMENT[k]
                    for k in ("serverTime", "leaseExpiresAt", "deadlineAt")
                },
            )
        if "/results/" in path:
            return httpx.Response(self.result_status, json={})
        return httpx.Response(200, json={})

    def client(self) -> InferenceClient:
        return InferenceClient(
            WorkerClient(
                "https://example.test",
                "secret",
                SESSION,
                transport=httpx.MockTransport(self),
            )
        )


class Process:
    def __init__(self, action=None):
        self.action = action
        self.closed = 0

    def run(self, assignment, deadline, check):
        check()
        if self.action:
            self.action(check)
        return detection_document(assignment.image)

    def close(self):
        self.closed += 1


@pytest.mark.parametrize(
    "filename", ["inference-assignment.json", "inference-assignment-yolo.json"]
)
def test_shared_assignment_contract(filename: str):
    a = Assignment.from_document(
        json.loads(
            (Path(__file__).parent / "fixtures/contracts" / filename).read_text()
        )
    )
    assert a.attempt == 1
    assert a.image in {"c" * 64, "d" * 64}


def test_assignment_requires_an_attempt_and_valid_deadlines():
    with pytest.raises(ValueError, match="assignment.*required property"):
        Assignment.from_document({"manifest": MANIFEST, "image": "c" * 64})
    with pytest.raises(ValueError, match="deadlines"):
        Assignment.from_document({**DOCUMENT, "deadlineAt": DOCUMENT["serverTime"]})


def test_worker_claims_only_one_task_and_fences_its_result():
    server = Workbench()
    client = server.client()
    process = Process()
    runner = InferenceRunner(client, process)  # type: ignore[arg-type]
    try:
        assert runner.run_once(threading.Event())
        assert len(server.assignments) == 1
        assert [r.method for r in server.calls] == ["POST", "PUT"]
        assert dict(server.calls[-1].url.params) == {
            "sessionId": "test-session",
            "attempt": "3",
        }
        assert process.closed == 0
        assert runner.run_once(threading.Event())
        assert len(server.assignments) == 0
    finally:
        runner.close()
        client.worker.close()


def test_execution_errors_are_attempt_failures_not_detection_results():
    server = Workbench()
    client = server.client()

    def fail(check):
        raise InferenceExecutionError("execution", "GPU error")

    process = Process(fail)
    try:
        assert InferenceRunner(client, process).run_once(threading.Event())  # type: ignore[arg-type]
        assert not any(r.method == "PUT" for r in server.calls)
        request = server.calls[-1]
        assert request.url.path.endswith("/fail")
        assert json.loads(request.read()) == {
            "sessionId": "test-session",
            "attempt": 3,
            "failure": {"code": "execution", "message": "GPU error"},
        }
        assert process.closed == 1
    finally:
        client.worker.close()


def test_lost_lease_stops_execution_and_prevents_late_result(monkeypatch):
    monkeypatch.setattr(inference, "RENEW_SECONDS", 0)
    server = Workbench(lease_status=409)
    client = server.client()
    process = Process()
    try:
        with pytest.raises(LeaseLostError):
            InferenceRunner(client, process).run_once(threading.Event())  # type: ignore[arg-type]
        assert process.closed == 1
        assert not any(r.method == "PUT" for r in server.calls)
    finally:
        client.worker.close()


def test_execution_deadline_stops_a_live_worker_even_when_renewal_succeeds(monkeypatch):
    server = Workbench()
    client = server.client()
    clock = [100.0]
    monkeypatch.setattr(inference.time, "monotonic", lambda: clock[0])

    def hang(check):
        clock[0] += 901
        check()

    process = Process(hang)
    try:
        assert InferenceRunner(client, process).run_once(threading.Event())  # type: ignore[arg-type]
        assert process.closed == 1
        assert not any(r.method == "PUT" for r in server.calls)
    finally:
        client.worker.close()


def test_stopping_worker_releases_attempt_by_failure():
    server = Workbench()
    client = server.client()
    stopped = threading.Event()

    def stop(check):
        stopped.set()
        check()

    try:
        assert InferenceRunner(client, Process(stop)).run_once(stopped)  # type: ignore[arg-type]
        assert json.loads(server.calls[-1].read())["failure"]["code"] == "interrupted"
        assert not any(r.method == "PUT" for r in server.calls)
    finally:
        client.worker.close()


def test_result_transport_retries_keep_the_same_attempt_and_payload():
    server = Workbench()
    original = server.__call__
    results = []

    def transport(request):
        if request.method == "PUT":
            results.append((str(request.url), request.read()))
            if len(results) == 1:
                raise httpx.ReadError("response lost")
        return original(request)

    worker = WorkerClient(
        "https://example.test",
        "secret",
        SESSION,
        transport=httpx.MockTransport(transport),
    )
    try:
        assert InferenceRunner(InferenceClient(worker), Process()).run_once(  # type: ignore[arg-type]
            threading.Event()
        )
        assert len(results) == 2 and results[0] == results[1]
    finally:
        worker.close()


def test_inference_network_deadline_bounds_a_streaming_response():
    class SlowStream(httpx.SyncByteStream):
        def __iter__(self):
            for _ in range(100):
                time.sleep(0.01)
                yield b"x"

    worker = WorkerClient(
        "https://example.test",
        "secret",
        SESSION,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, stream=SlowStream())
        ),
    )
    started = time.monotonic()
    try:
        with pytest.raises(httpx.TimeoutException):
            worker.request("GET", "slow", deadline=started + 0.03)
        assert time.monotonic() - started < 0.5
    finally:
        worker.close()


def test_traditional_detector_requires_its_class(tmp_path: Path):
    class NoWeights:
        def weights(self, version_id: str) -> bytes:
            raise AssertionError(version_id)

    store = ModelStore(NoWeights(), tmp_path, None)
    with pytest.raises(ValueError, match="declares ungerminated"):
        store.load(ModelManifest.from_document({**MANIFEST, "classes": ["germinated"]}))


def test_bounded_http_decodes_compressed_responses_once():
    import gzip

    worker = WorkerClient(
        "https://example.test",
        "secret",
        SESSION,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"content-encoding": "gzip"},
                content=gzip.compress(b"result"),
            )
        ),
    )
    try:
        assert (
            worker.request("GET", "result", deadline=time.monotonic() + 5).content
            == b"result"
        )
    finally:
        worker.close()


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (
            {"quality": {"status": "ok", "warnings": ["Not A Code"]}},
            r"quality.warnings\[0\]",
        ),
        (
            {
                "instances": [
                    {
                        "id": "1",
                        "class": "seed",
                        "score": float("nan"),
                        "bbox": {"x": 0, "y": 0, "width": 1, "height": 1},
                    }
                ]
            },
            r"instances\[0\].score must be finite",
        ),
        (
            {
                "instances": [
                    {
                        "id": "1",
                        "class": "seed",
                        "score": 1.1,
                        "bbox": {"x": 0, "y": 0, "width": 1, "height": 1},
                    }
                ]
            },
            r"instances\[0\].score.*shared contract",
        ),
        (
            {
                "instances": [
                    {
                        "id": "1",
                        "class": "seed",
                        "score": 0.5,
                        "bbox": {"x": 0, "y": 0, "width": 0, "height": 1},
                    }
                ]
            },
            r"instances\[0\].bbox.width.*shared contract",
        ),
        (
            {"image": {"digest": "d" * 64, "width": 1000, "height": 800}},
            "describes another image",
        ),
    ],
)
def test_outbound_detection_is_validated_before_any_network_request(change, reason):
    server = Workbench()
    client = server.client()
    try:
        with pytest.raises(ValueError, match=reason):
            client.put_result(
                Assignment.from_document(DOCUMENT),
                {**detection_document("c" * 64), **change},
                time.monotonic() + 10,
            )
        assert server.calls == []
    finally:
        client.worker.close()
