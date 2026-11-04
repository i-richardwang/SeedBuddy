import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import annotation_document, manifest_document, manifest_entry

from vitroctl.datasets.manifest import (
    MAX_DATASET_MANIFEST_BYTES,
    BlobError,
    DatasetManifest,
    blob_path,
    encode_dataset_manifest,
    load_dataset_manifest,
    verified_blob,
)
from vitroctl.datasets.transfer import (
    MAX_IMAGE_BYTES,
    DatasetTransferError,
    PullReport,
    PushReport,
    pull_dataset,
    push_dataset,
)

IMAGE_A = b"image a"
IMAGE_B = b"image b"
DIGEST_A = hashlib.sha256(IMAGE_A).hexdigest()
DIGEST_B = hashlib.sha256(IMAGE_B).hexdigest()
CONTRACT_FIXTURE = (
    Path(__file__).parent / "fixtures" / "contracts" / "dataset-manifest.json"
)


def test_shared_dataset_manifest_contract() -> None:
    dataset = DatasetManifest.from_document(
        json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    )

    assert dataset.dataset == "seed-set"
    assert dataset.images[0].annotation is not None


def _manifest() -> dict[str, Any]:
    return manifest_document(
        "seeds",
        [
            manifest_entry(
                DIGEST_A,
                size=len(IMAGE_A),
                split="train",
                annotation=annotation_document(DIGEST_A),
            ),
            manifest_entry(DIGEST_B, size=len(IMAGE_B)),
        ],
    )


def test_manifest_says_which_photographs_are_unclear() -> None:
    document = _manifest()
    document["images"][0]["unclear"] = True

    manifest = DatasetManifest.from_document(document)
    marked, unsaid = manifest.images

    assert marked.unclear is True
    assert unsaid.unclear is False

    encoded = json.loads(encode_dataset_manifest(manifest.to_dict()))
    assert [image["unclear"] for image in encoded["images"]] == [True, False]

    malformed = _manifest()
    malformed["images"][0]["unclear"] = "yes"
    with pytest.raises((ValueError, TypeError), match=r"manifest.images\[0\].unclear"):
        DatasetManifest.from_document(malformed)


def test_manifest_documents_are_valid_and_belong_to_their_image() -> None:
    malformed = _manifest()
    malformed["images"][0]["detection"] = {"schemaVersion": 1}
    with pytest.raises(ValueError, match=r"manifest.images\[0\].detection"):
        DatasetManifest.from_document(malformed)

    mismatched = _manifest()
    mismatched["images"][0]["annotation"]["image"]["height"] += 1
    with pytest.raises(ValueError, match="dimensions differ"):
        DatasetManifest.from_document(mismatched)

    unknown_class = _manifest()
    unknown_class["images"][0]["annotation"]["instances"][0]["class"] = "mould"
    with pytest.raises(ValueError, match="unknown class: mould"):
        DatasetManifest.from_document(unknown_class)

    oversized_image = _manifest()
    oversized_image["images"][0]["bytes"] = MAX_IMAGE_BYTES + 1
    with pytest.raises(
        ValueError, match=r"manifest.images\[0\].bytes.*shared contract"
    ):
        DatasetManifest.from_document(oversized_image)


def test_manifest_encoding_is_canonical_and_bounded() -> None:
    document = _manifest()
    encoded = encode_dataset_manifest(DatasetManifest.from_document(document).to_dict())
    assert json.loads(encoded) == document
    assert encoded.endswith(b"\n")
    assert b": " not in encoded

    document["images"][0]["filename"] = "x" * MAX_DATASET_MANIFEST_BYTES
    with pytest.raises(ValueError, match=f"exceeds {MAX_DATASET_MANIFEST_BYTES} bytes"):
        encode_dataset_manifest(DatasetManifest.from_document(document).to_dict())


def _server(
    *,
    blobs: dict[str, bytes] | None = None,
    manifest: dict[str, Any] | None = None,
):
    served = {DIGEST_A: IMAGE_A, DIGEST_B: IMAGE_B} if blobs is None else blobs
    document = _manifest() if manifest is None else manifest
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        assert request.headers["Authorization"] == "Bearer secret"
        if request.url.path == "/api/transfer/datasets/seeds":
            return httpx.Response(200, json=document)
        digest = request.url.path.removeprefix("/api/transfer/images/")
        if digest in served:
            return httpx.Response(200, content=served[digest])
        return httpx.Response(404)

    return handle, requests


def _pull(root: Path, handle) -> PullReport:
    return pull_dataset(
        "https://workbench.example",
        "secret",
        "seeds",
        root,
        transport=httpx.MockTransport(handle),
    )


def test_pull_materializes_blobs_and_the_manifest(tmp_path: Path) -> None:
    handle, requests = _server()
    root = tmp_path / "data"

    report = _pull(root, handle)

    assert report == PullReport("seeds", kept=0, downloaded=2, replaced=0)
    assert report.images == 2
    assert blob_path(root, DIGEST_A).read_bytes() == IMAGE_A
    assert blob_path(root, DIGEST_B).read_bytes() == IMAGE_B
    manifest = root / "datasets" / "seeds.json"
    assert json.loads(manifest.read_text()) == _manifest()
    assert requests == [
        "/api/transfer/datasets/seeds",
        f"/api/transfer/images/{DIGEST_A}",
        f"/api/transfer/images/{DIGEST_B}",
    ]
    assert sorted(child.name for child in root.iterdir()) == ["blobs", "datasets"]
    annotated = load_dataset_manifest(manifest).annotated
    assert [image.digest for image in annotated] == [DIGEST_A]
    assert annotated[0].split == "train"
    assert verified_blob(root, DIGEST_A) == blob_path(root, DIGEST_A)


def test_pull_keeps_blobs_that_verify(tmp_path: Path) -> None:
    present = blob_path(tmp_path, DIGEST_A)
    present.parent.mkdir(parents=True)
    present.write_bytes(IMAGE_A)
    handle, requests = _server(blobs={DIGEST_B: IMAGE_B})

    assert _pull(tmp_path, handle) == PullReport("seeds", 1, 1, 0)

    assert requests == [
        "/api/transfer/datasets/seeds",
        f"/api/transfer/images/{DIGEST_B}",
    ]
    assert blob_path(tmp_path, DIGEST_B).read_bytes() == IMAGE_B


def test_pull_replaces_a_cached_blob_that_fails_verification(tmp_path: Path) -> None:
    corrupted = blob_path(tmp_path, DIGEST_A)
    corrupted.parent.mkdir(parents=True)
    corrupted.write_bytes(b"bit rot")
    handle, requests = _server()

    assert _pull(tmp_path, handle) == PullReport("seeds", 0, 1, 1)

    assert requests == [
        "/api/transfer/datasets/seeds",
        f"/api/transfer/images/{DIGEST_A}",
        f"/api/transfer/images/{DIGEST_B}",
    ]
    assert corrupted.read_bytes() == IMAGE_A
    assert [child.name for child in corrupted.parent.iterdir()] == [DIGEST_A]


def test_verified_blob_rejects_mismatched_bytes(tmp_path: Path) -> None:
    target = blob_path(tmp_path, DIGEST_A)
    target.parent.mkdir(parents=True)
    target.write_bytes(IMAGE_B)

    with pytest.raises(BlobError, match="digest verification"):
        verified_blob(tmp_path, DIGEST_A)
    with pytest.raises(BlobError, match="missing"):
        verified_blob(tmp_path, DIGEST_B)

    target.write_bytes(IMAGE_A)
    assert verified_blob(tmp_path, DIGEST_A) == target


def test_pull_rejects_corrupted_images(tmp_path: Path) -> None:
    handle, _ = _server(blobs={DIGEST_A: IMAGE_A, DIGEST_B: b"tampered"})
    with pytest.raises(ValueError, match="digest verification"):
        _pull(tmp_path, handle)

    assert blob_path(tmp_path, DIGEST_A).read_bytes() == IMAGE_A
    assert not blob_path(tmp_path, DIGEST_B).exists()
    assert not blob_path(tmp_path, DIGEST_B).parent.exists()
    assert not (tmp_path / "datasets").exists()


def test_pull_rejects_a_blob_size_that_differs_from_the_manifest(
    tmp_path: Path,
) -> None:
    manifest = _manifest()
    manifest["images"][0]["bytes"] = len(IMAGE_A) + 1
    handle, _ = _server(manifest=manifest)

    with pytest.raises(DatasetTransferError, match="size differs"):
        _pull(tmp_path, handle)

    assert not blob_path(tmp_path, DIGEST_A).exists()
    assert not (tmp_path / "datasets").exists()


def test_pull_rejects_invalid_manifest_entries(tmp_path: Path) -> None:
    manifest = _manifest()
    manifest["images"][1]["digest"] = "not-a-digest"
    handle, requests = _server(manifest=manifest)
    with pytest.raises(
        DatasetTransferError, match=r"manifest.images\[1\].digest.*shared contract"
    ):
        _pull(tmp_path, handle)
    assert requests == ["/api/transfer/datasets/seeds"]
    assert list(tmp_path.iterdir()) == []


def test_pull_propagates_http_errors(tmp_path: Path) -> None:
    handle, _ = _server(blobs={})
    with pytest.raises(httpx.HTTPStatusError):
        _pull(tmp_path, handle)
    assert not blob_path(tmp_path, DIGEST_A).exists()
    assert not (tmp_path / "datasets").exists()


def test_pull_rejects_unknown_schema_versions(tmp_path: Path) -> None:
    manifest = _manifest()
    manifest["schemaVersion"] = 99
    handle, requests = _server(manifest=manifest)
    with pytest.raises(
        DatasetTransferError, match="manifest.schemaVersion.*shared contract"
    ):
        _pull(tmp_path, handle)
    assert requests == ["/api/transfer/datasets/seeds"]
    assert list(tmp_path.iterdir()) == []


def test_failed_pull_leaves_the_previous_manifest_untouched(tmp_path: Path) -> None:
    manifest = tmp_path / "datasets" / "seeds.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("previous")
    handle, _ = _server(blobs={DIGEST_A: IMAGE_A, DIGEST_B: b"tampered"})

    with pytest.raises(ValueError, match="digest verification"):
        _pull(tmp_path, handle)

    assert manifest.read_text() == "previous"
    assert [child.name for child in manifest.parent.iterdir()] == ["seeds.json"]


def test_pull_replaces_the_previous_manifest(tmp_path: Path) -> None:
    manifest = tmp_path / "datasets" / "seeds.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("previous")
    handle, _ = _server()

    _pull(tmp_path, handle)

    assert json.loads(manifest.read_text()) == _manifest()
    assert [child.name for child in manifest.parent.iterdir()] == ["seeds.json"]


def _data_root(root: Path, document: dict[str, Any] | None = None) -> None:
    for digest, image in ((DIGEST_A, IMAGE_A), (DIGEST_B, IMAGE_B)):
        path = blob_path(root, digest)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image)
    manifest = root / "datasets" / "seeds.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(_manifest() if document is None else document))


def _receiver(*, existing: bool = False, refusal: str | None = None):
    received: list[tuple[str, str, bytes]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer secret"
        received.append((request.method, request.url.path, request.content))
        if request.url.path == "/api/transfer/datasets/seeds":
            if request.method == "GET":
                return httpx.Response(200 if existing else 404)
            if refusal is not None:
                return httpx.Response(409, json={"error": refusal})
            return httpx.Response(201, json={"dataset": {"id": "seeds"}})
        assert request.method == "PUT"
        assert request.headers["Content-Type"] == "image/avif"
        digest = request.url.path.removeprefix("/api/transfer/images/")
        assert hashlib.sha256(request.content).hexdigest() == digest
        return httpx.Response(200, json={"digest": digest})

    return handle, received


def _push(root: Path, handle) -> PushReport:
    return push_dataset(
        "https://workbench.example",
        "secret",
        "seeds",
        root,
        transport=httpx.MockTransport(handle),
    )


def test_push_sends_every_blob_and_then_the_manifest(tmp_path: Path) -> None:
    _data_root(tmp_path)
    handle, received = _receiver()

    assert _push(tmp_path, handle) == PushReport("seeds", 2)

    assert [(method, path) for method, path, _ in received] == [
        ("GET", "/api/transfer/datasets/seeds"),
        ("PUT", f"/api/transfer/images/{DIGEST_A}"),
        ("PUT", f"/api/transfer/images/{DIGEST_B}"),
        ("PUT", "/api/transfer/datasets/seeds"),
    ]
    assert received[1][2] == IMAGE_A
    assert json.loads(received[3][2]) == _manifest()


def test_push_refuses_before_sending_when_the_dataset_exists(tmp_path: Path) -> None:
    _data_root(tmp_path)
    handle, received = _receiver(existing=True)

    with pytest.raises(DatasetTransferError, match="already exists"):
        _push(tmp_path, handle)

    assert [method for method, _, _ in received] == ["GET"]


def test_push_reports_a_refused_manifest(tmp_path: Path) -> None:
    _data_root(tmp_path)
    handle, _ = _receiver(refusal="Unknown model: seed-detector")

    with pytest.raises(DatasetTransferError, match="Unknown model"):
        _push(tmp_path, handle)


def test_push_verifies_blobs_before_sending_anything(tmp_path: Path) -> None:
    _data_root(tmp_path)
    blob_path(tmp_path, DIGEST_B).write_bytes(b"bit rot")
    handle, received = _receiver()

    with pytest.raises(BlobError, match="digest verification"):
        _push(tmp_path, handle)

    assert received == []


def test_push_verifies_manifest_blob_sizes_before_sending_anything(
    tmp_path: Path,
) -> None:
    document = _manifest()
    document["images"][0]["bytes"] = len(IMAGE_A) + 1
    _data_root(tmp_path, document)
    handle, received = _receiver()

    with pytest.raises(DatasetTransferError, match="size differs"):
        _push(tmp_path, handle)

    assert received == []


def test_push_requires_a_local_manifest(tmp_path: Path) -> None:
    handle, received = _receiver()

    with pytest.raises(DatasetTransferError, match="No manifest"):
        _push(tmp_path, handle)

    assert received == []


@pytest.mark.parametrize("declared", [False, True])
def test_pull_bounds_streamed_blobs_and_preserves_cached_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, declared: bool
) -> None:
    from vitroctl.datasets import transfer

    monkeypatch.setattr(transfer, "MAX_IMAGE_BYTES", 4)
    cached = blob_path(tmp_path, DIGEST_A)
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"old")

    class Stream(httpx.SyncByteStream):
        def __iter__(self):
            yield b"abc"
            yield b"def"

    def server(request: httpx.Request) -> httpx.Response:
        if "/datasets/" in request.url.path:
            return httpx.Response(200, json=_manifest())
        return httpx.Response(
            200, headers={"content-length": "6"} if declared else {}, stream=Stream()
        )

    with pytest.raises(DatasetTransferError, match="Image exceeds 4 bytes"):
        _pull(tmp_path, server)
    assert cached.read_bytes() == b"old"
    assert list(cached.parent.iterdir()) == [cached]
    assert not (tmp_path / "datasets").exists()


def test_push_validates_the_document_before_any_request(tmp_path):
    document = _manifest()
    document["schemaVersion"] = 99
    _data_root(tmp_path, document)
    handle, received = _receiver()
    with pytest.raises(DatasetTransferError, match="schemaVersion"):
        _push(tmp_path, handle)
    assert received == []


def test_manifest_requires_an_explicit_unclear_flag():
    document = _manifest()
    document["images"][0].pop("unclear")
    with pytest.raises(ValueError, match="unclear"):
        DatasetManifest.from_document(document)
