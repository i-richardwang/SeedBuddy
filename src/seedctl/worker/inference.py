"""One inference task per execution slot, with bounded ownership and supervision."""

from __future__ import annotations

import logging
import threading
import time

import cv2
import httpx

from seedctl.worker.inference_process import InferenceExecutionError, InferenceProcess
from seedctl.worker.inference_protocol import InferenceClient, timestamp
from seedctl.worker.session import LeaseLostError

WORKER_ERRORS = (OSError, ValueError, RuntimeError, cv2.error, httpx.HTTPError)
LOGGER = logging.getLogger(__name__)
RENEW_SECONDS = 20.0


class InferenceRunner:
    def __init__(self, client: InferenceClient, process: InferenceProcess) -> None:
        self.client = client
        self.process = process

    def close(self) -> None:
        self.process.close()

    def run_once(self, stopped: threading.Event) -> bool:
        claimed_at = time.monotonic()
        assignment = self.client.claim()
        if assignment is None:
            return False
        # Server durations map to a local monotonic clock; host clock skew is irrelevant.
        deadline = (
            claimed_at
            + timestamp(assignment.deadline_at)
            - timestamp(assignment.server_time)
        )
        lease_until = (
            claimed_at
            + timestamp(assignment.lease_expires_at)
            - timestamp(assignment.server_time)
        )
        next_renewal = claimed_at + RENEW_SECONDS
        LOGGER.info(
            "claimed %s with %s attempt %s",
            assignment.image,
            assignment.version_id,
            assignment.attempt,
        )

        def check() -> None:
            nonlocal lease_until, next_renewal
            now = time.monotonic()
            if stopped.is_set():
                raise InferenceExecutionError("interrupted", "Worker is stopping")
            if now >= deadline:
                raise InferenceExecutionError(
                    "timeout", "Inference execution exceeded its deadline"
                )
            if now >= lease_until:
                raise LeaseLostError("Inference lease expired locally")
            if now >= next_renewal:
                renewed_at = time.monotonic()
                receipt = self.client.renew(assignment, lease_until)
                if receipt["deadlineAt"] != assignment.deadline_at:
                    raise LeaseLostError(
                        "Server changed the inference execution deadline"
                    )
                duration = timestamp(receipt["leaseExpiresAt"]) - timestamp(
                    receipt["serverTime"]
                )
                lease_until = min(deadline, renewed_at + duration)
                next_renewal = renewed_at + RENEW_SECONDS
                self.client.heartbeat(lease_until)
                if time.monotonic() >= lease_until:
                    raise LeaseLostError("Inference lease expired during renewal")

        try:
            result = self.process.run(assignment, deadline, check)
            check()
            self.client.put_result(assignment, result, lease_until)
            LOGGER.info(
                "detected %s with %s attempt %s",
                assignment.image,
                assignment.version_id,
                assignment.attempt,
            )
        except InferenceExecutionError as error:
            self.process.close()
            if time.monotonic() < lease_until:
                self.client.fail(assignment, error.code, str(error), lease_until)
            LOGGER.error("inference attempt %s failed: %s", assignment.attempt, error)
        except WORKER_ERRORS as error:
            self.process.close()
            if not isinstance(error, LeaseLostError) and time.monotonic() < lease_until:
                try:
                    self.client.fail(
                        assignment,
                        "transport"
                        if isinstance(error, httpx.HTTPError)
                        else "execution",
                        str(error),
                        lease_until,
                    )
                except WORKER_ERRORS:
                    LOGGER.warning(
                        "could not report failure of attempt %s; its lease will expire",
                        assignment.attempt,
                    )
            raise
        return True
