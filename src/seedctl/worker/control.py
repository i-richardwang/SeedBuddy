"""Admission and cancellation of work within a borrowed execution scope."""

import threading

from seedctl.worker.process import ProcessScope


class WorkerControl:
    """Draining ends admission; stopping also interrupts admitted work."""

    def __init__(self, processes: ProcessScope) -> None:
        self.stopped = threading.Event()
        self.draining = threading.Event()
        self.processes = processes

    def stop(self) -> None:
        self.draining.set()
        self.stopped.set()
