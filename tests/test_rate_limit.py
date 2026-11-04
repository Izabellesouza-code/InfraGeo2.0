from fastapi import Request

from app.core.exceptions import WebGISException
from app.utils.rate_limit import client_ip, enforce_rate_limit, reset_rate_limits


class _Client:
    def __init__(self, host: str) -> None:
        self.host = host


def test_enforce_allows_under_limit():
    reset_rate_limits()
    for _ in range(3):
        enforce_rate_limit("t-ok", max_hits=3, window_sec=60)


def test_enforce_returns_429_and_retry_after():
    reset_rate_limits()
    for _ in range(2):
        enforce_rate_limit("t-block", max_hits=2, window_sec=60)
    try:
        enforce_rate_limit("t-block", max_hits=2, window_sec=60)
        raise AssertionError("expected 429")
    except WebGISException as exc:
        assert exc.status_code == 429
        assert exc.headers.get("Retry-After")
        assert int(exc.headers["Retry-After"]) >= 1


def test_keys_are_independent():
    reset_rate_limits()
    enforce_rate_limit("a", max_hits=1, window_sec=60)
    enforce_rate_limit("b", max_hits=1, window_sec=60)


def test_client_ip_prefers_forwarded():
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "headers": [(b"x-forwarded-for", b"203.0.113.9, 10.0.0.1")],
        "client": ("127.0.0.1", 123),
        "server": ("test", 80),
        "scheme": "http",
        "query_string": b"",
    }
    request = Request(scope)
    assert client_ip(request) == "203.0.113.9"
