"""Server metrics for the dashboard (CPU, memory and disk)."""

from datetime import datetime, timezone

import psutil


def collect() -> dict:
    """Take one metrics sample from the machine running the backend."""
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    gigabyte = 1024**3

    return {
        "timestamp": datetime.now(timezone.utc),
        # 0.1 s gives a meaningful CPU reading on the first request too.
        "cpu_percent": round(psutil.cpu_percent(interval=0.1), 1),
        "memory_percent": round(memory.percent, 1),
        "memory_used_mb": round(memory.used / 1024**2, 1),
        "memory_total_mb": round(memory.total / 1024**2, 1),
        "disk_percent": round(disk.percent, 1),
        "disk_used_gb": round(disk.used / gigabyte, 1),
        "disk_total_gb": round(disk.total / gigabyte, 1),
    }
