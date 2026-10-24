"""Host and process statistics without external dependencies."""

from __future__ import annotations

import os
import platform
import resource
import threading
import time
from typing import Any


def _round2(value: float) -> float:
    return float(int(value * 100 + 0.5)) / 100


class Collector:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_total = 0
        self._last_idle = 0
        self._last_at = 0.0
        self.started_at = time.time()

    def process_uptime(self) -> float:
        return time.time() - self.started_at

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        stats: dict[str, Any] = {
            "hostname": "",
            "os": platform.system().lower(),
            "arch": platform.machine(),
            "cpus": os.cpu_count() or 0,
            "uptime_seconds": 0.0,
            "load_1": 0.0,
            "load_5": 0.0,
            "load_15": 0.0,
            "cpu_percent": 0.0,
            "memory_total_bytes": 0,
            "memory_used_bytes": 0,
            "memory_free_bytes": 0,
            "memory_percent": 0.0,
            "swap_total_bytes": 0,
            "swap_used_bytes": 0,
            "disk_total_bytes": 0,
            "disk_used_bytes": 0,
            "disk_free_bytes": 0,
            "disk_percent": 0.0,
            "goroutines": threading.active_count(),
            "heap_alloc_bytes": 0,
            "rss_bytes": 0,
            "collected_at": None,
        }
        try:
            stats["hostname"] = os.uname().nodename
        except Exception:
            stats["hostname"] = platform.node()

        cpu = self._read_cpu()
        if cpu is not None:
            total, idle = cpu
            with self._lock:
                if self._last_total > 0 and total > self._last_total:
                    delta_total = total - self._last_total
                    delta_idle = idle - self._last_idle
                    if delta_total > 0 and delta_idle <= delta_total:
                        stats["cpu_percent"] = _round2(
                            (delta_total - delta_idle) / delta_total * 100
                        )
                if self._last_total == 0 or now - self._last_at >= 0.5:
                    self._last_total = total
                    self._last_idle = idle
                    self._last_at = now

        mem = self._read_mem()
        if mem is not None:
            total, free, available, swap_total, swap_free = mem
            used = total - available
            stats.update(
                {
                    "memory_total_bytes": total,
                    "memory_free_bytes": free,
                    "memory_used_bytes": used,
                    "swap_total_bytes": swap_total,
                    "swap_used_bytes": swap_total - swap_free,
                    "memory_percent": _round2(used / total * 100) if total else 0.0,
                }
            )

        disk = self._read_disk("/")
        if disk is not None:
            total, used, free = disk
            stats.update(
                {
                    "disk_total_bytes": total,
                    "disk_used_bytes": used,
                    "disk_free_bytes": free,
                    "disk_percent": _round2(used / total * 100) if total else 0.0,
                }
            )

        load = self._read_load()
        if load is not None:
            stats["load_1"], stats["load_5"], stats["load_15"] = load
        uptime = self._read_uptime()
        if uptime is not None:
            stats["uptime_seconds"] = uptime
        stats["rss_bytes"] = self._read_rss()
        stats["collected_at"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)
        )
        return stats

    @staticmethod
    def _read_cpu() -> tuple[int, int] | None:
        try:
            with open("/proc/stat", "r", encoding="utf-8") as handle:
                first = handle.readline()
        except OSError:
            return None
        fields = first.split()
        if len(fields) < 5 or fields[0] != "cpu":
            return None
        total = 0
        idle = 0
        for index, field in enumerate(fields[1:], start=1):
            try:
                value = int(field)
            except ValueError:
                continue
            total += value
            if index in (4, 5):
                idle += value
        return total, idle

    @staticmethod
    def _read_mem() -> tuple[int, int, int, int, int] | None:
        try:
            with open("/proc/meminfo", "r", encoding="utf-8") as handle:
                lines = handle.readlines()
        except OSError:
            return None
        values: dict[str, int] = {}
        for line in lines:
            fields = line.split()
            if len(fields) < 2:
                continue
            try:
                values[fields[0].rstrip(":")] = int(fields[1]) * 1024
            except ValueError:
                continue
        if not values:
            return None
        total = values.get("MemTotal", 0)
        free = values.get("MemFree", 0)
        available = values.get("MemAvailable", 0)
        if available == 0:
            available = free + values.get("Buffers", 0) + values.get("Cached", 0)
        swap_total = values.get("SwapTotal", 0)
        swap_free = values.get("SwapFree", 0)
        if total <= 0:
            return None
        return total, free, available, swap_total, swap_free

    @staticmethod
    def _read_disk(path: str) -> tuple[int, int, int] | None:
        try:
            stats = os.statvfs(path)
        except OSError:
            return None
        total = stats.f_blocks * stats.f_frsize
        free = stats.f_bavail * stats.f_frsize
        return total, total - free, free

    @staticmethod
    def _read_load() -> tuple[float, float, float] | None:
        try:
            with open("/proc/loadavg", "r", encoding="utf-8") as handle:
                fields = handle.read().split()
        except OSError:
            return None
        if len(fields) < 3:
            return None
        try:
            return float(fields[0]), float(fields[1]), float(fields[2])
        except ValueError:
            return None

    @staticmethod
    def _read_uptime() -> float | None:
        try:
            with open("/proc/uptime", "r", encoding="utf-8") as handle:
                return float(handle.read().split()[0])
        except (OSError, ValueError, IndexError):
            return None

    @staticmethod
    def _read_rss() -> int:
        try:
            with open("/proc/self/statm", "r", encoding="utf-8") as handle:
                pages = int(handle.read().split()[1])
            return pages * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError, IndexError):
            try:
                return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
            except Exception:
                return 0
