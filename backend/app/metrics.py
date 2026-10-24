"""Small Prometheus text exposition registry."""

from __future__ import annotations

import threading
import time
from typing import Any


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._http: dict[tuple[str, str, str], list[float]] = {}
        self.started = time.time()

    def observe(
        self, method: str, route: str, status: int, duration: float
    ) -> None:
        route = route or "unknown"
        key = (method, route, str(status))
        with self._lock:
            entry = self._http.setdefault(key, [0.0, 0.0])
            entry[0] += 1
            entry[1] += duration

    def render(self, ext: dict[str, float]) -> str:
        with self._lock:
            snapshot = {key: list(value) for key, value in self._http.items()}
        keys = sorted(snapshot, key=lambda item: (item[1], item[0], item[2]))

        lines: list[str] = [
            "# HELP asterisk_backend_http_requests_total HTTP requests processed.",
            "# TYPE asterisk_backend_http_requests_total counter",
        ]
        for key in keys:
            method, route, status = key
            lines.append(
                "asterisk_backend_http_requests_total"
                f'{{method="{_escape(method)}",route="{_escape(route)}",'
                f'status="{_escape(status)}"}} {int(snapshot[key][0])}'
            )
        lines.extend(
            [
                "# HELP asterisk_backend_http_request_duration_seconds_sum "
                "Total time spent handling requests.",
                "# TYPE asterisk_backend_http_request_duration_seconds_sum counter",
            ]
        )
        for key in keys:
            method, route, status = key
            lines.append(
                "asterisk_backend_http_request_duration_seconds_sum"
                f'{{method="{_escape(method)}",route="{_escape(route)}",'
                f'status="{_escape(status)}"}} {snapshot[key][1]:f}'
            )
        lines.extend(
            [
                "# HELP asterisk_backend_uptime_seconds Process uptime.",
                "# TYPE asterisk_backend_uptime_seconds gauge",
                f"asterisk_backend_uptime_seconds {time.time() - self.started:.3f}",
                "# HELP asterisk_backend_goroutines Current thread count.",
                "# TYPE asterisk_backend_goroutines gauge",
                f"asterisk_backend_goroutines {threading.active_count()}",
                "# HELP asterisk_backend_memory_alloc_bytes Allocated heap bytes.",
                "# TYPE asterisk_backend_memory_alloc_bytes gauge",
                "asterisk_backend_memory_alloc_bytes 0",
            ]
        )
        for name in sorted(ext):
            lines.append(f"{name} {ext[name]:g}")
        return "\n".join(lines) + "\n"
