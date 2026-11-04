"""Limite simples em memória (por processo)."""

from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock
from typing import Optional

from fastapi import Request

from app.core.exceptions import WebGISException

_lock = Lock()
_hits: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:80]
    host = request.client.host if request.client else ""
    return host or "unknown"


def reset_rate_limits() -> None:
    with _lock:
        _hits.clear()


def seconds_until_retry(key: str, window_sec: float) -> int:
    now = time.monotonic()
    with _lock:
        bucket = [t for t in _hits.get(key, []) if now - t < window_sec]
        if not bucket:
            return 1
        return max(1, int(window_sec - (now - bucket[0])) + 1)


def enforce_rate_limit(key: str, *, max_hits: int, window_sec: float) -> None:
    now = time.monotonic()
    with _lock:
        bucket = [t for t in _hits[key] if now - t < window_sec]
        if len(bucket) >= max_hits:
            _hits[key] = bucket
            retry_after = max(1, int(window_sec - (now - bucket[0])) + 1)
            raise WebGISException(
                "Muitas solicitações. Aguarde um momento e tente de novo.",
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
        _hits[key] = bucket


def limit_request(
    request: Request,
    scope: str,
    *,
    max_hits: int,
    window_sec: float,
    extra: Optional[str] = None,
) -> None:
    ip = client_ip(request)
    enforce_rate_limit(f"{scope}:ip:{ip}", max_hits=max_hits, window_sec=window_sec)
    if extra:
        enforce_rate_limit(
            f"{scope}:id:{extra.strip().lower()[:120]}",
            max_hits=max_hits,
            window_sec=window_sec,
        )
