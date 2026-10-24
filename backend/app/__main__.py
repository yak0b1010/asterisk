"""Run the API with ``python -m app``.

The HTTP bind address is taken from the same configuration the application
uses (``HTTP_ADDR``), which keeps ``make run`` and the container entrypoint in
sync.
"""

from __future__ import annotations

import uvicorn

from .config import load_config


def main() -> None:
    cfg = load_config()
    uvicorn.run(
        "app.main:app",
        host=cfg.http_host,
        port=cfg.http_port,
        log_level=cfg.log_level.lower(),
    )


if __name__ == "__main__":
    main()
