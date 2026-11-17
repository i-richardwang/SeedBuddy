"""An execution tree owned by one non-inheritable Windows job handle."""

from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes

if sys.platform != "win32":
    raise ImportError("Windows jobs are only available on Windows")


class _Limits(ctypes.Structure):
    _fields_ = [
        ("process_time", ctypes.c_int64),
        ("job_time", ctypes.c_int64),
        ("flags", wintypes.DWORD),
        ("minimum_working_set", ctypes.c_size_t),
        ("maximum_working_set", ctypes.c_size_t),
        ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t),
        ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD),
    ]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("basic", _Limits),
        ("io_counters", ctypes.c_uint64 * 6),
        ("process_memory", ctypes.c_size_t),
        ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t),
        ("peak_job_memory", ctypes.c_size_t),
    ]


class _Accounting(ctypes.Structure):
    _fields_ = [
        ("times", ctypes.c_int64 * 4),
        ("page_faults", wintypes.DWORD),
        ("total", wintypes.DWORD),
        ("active", wintypes.DWORD),
        ("terminated", wintypes.DWORD),
    ]


class _Members(ctypes.Structure):
    _fields_ = [
        ("assigned", wintypes.DWORD),
        ("listed", wintypes.DWORD),
        ("identifiers", ctypes.c_size_t * 1024),
    ]


_SYNCHRONIZE = 0x00100000
_WAIT_OBJECT_0 = 0


class Job:
    """Kills every member when closed, including descendants of an exited root,
    and returns once they have ended and let go of what they held."""

    def __init__(self) -> None:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = (
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        )
        kernel.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        kernel.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel.QueryInformationJobObject.argtypes = (
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.c_void_p,
        )
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.IsProcessInJob.argtypes = (
            wintypes.HANDLE,
            wintypes.HANDLE,
            ctypes.POINTER(wintypes.BOOL),
        )
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        self._kernel = kernel
        self._handle = kernel.CreateJobObjectW(None, None)
        if not self._handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = _ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(
            self._handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        ):
            error = ctypes.WinError(ctypes.get_last_error())
            kernel.CloseHandle(self._handle)
            raise error

    def assign(self, process_handle: int) -> None:
        if not self._kernel.AssignProcessToJobObject(self._handle, process_handle):
            raise ctypes.WinError(ctypes.get_last_error())

    def _members(self) -> list[int]:
        """A handle to each process in the job, for waiting on its end."""
        listing = _Members()
        # A listing too long for the buffer still fills it; `close` counts the
        # members it could not wait on until none is left.
        self._kernel.QueryInformationJobObject(
            self._handle, 3, ctypes.byref(listing), ctypes.sizeof(listing), None
        )
        members = []
        for identifier in listing.identifiers[: listing.listed]:
            member = self._kernel.OpenProcess(_SYNCHRONIZE, False, identifier)
            if not member:
                continue
            # The process listed may have ended and another taken its identifier.
            inside = wintypes.BOOL()
            if (
                self._kernel.IsProcessInJob(member, self._handle, ctypes.byref(inside))
                and inside
            ):
                members.append(member)
            else:
                self._kernel.CloseHandle(member)
        return members

    def close(self) -> None:
        if not self._handle:
            return
        handle = self._handle
        members = self._members()
        deadline = time.monotonic() + 2
        try:
            if not self._kernel.TerminateJobObject(handle, 1):
                raise ctypes.WinError(ctypes.get_last_error())
            # A process leaves the job's count before the system has closed
            # what it held; its own handle signals after.
            for member in members:
                remaining = max(0.0, deadline - time.monotonic())
                if (
                    self._kernel.WaitForSingleObject(member, int(remaining * 1000))
                    != _WAIT_OBJECT_0
                ):
                    raise RuntimeError(
                        "Worker execution job did not finish terminating"
                    )
        finally:
            for member in members:
                self._kernel.CloseHandle(member)
        while True:
            accounting = _Accounting()
            if not self._kernel.QueryInformationJobObject(
                handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            if not accounting.active:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Worker execution job did not finish terminating")
            time.sleep(0.01)
        if not self._kernel.CloseHandle(handle):
            raise ctypes.WinError(ctypes.get_last_error())
        self._handle = None
