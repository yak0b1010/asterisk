"""Unit tests for helpers that do not need a database."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.auth import (
    InvalidToken,
    TokenService,
    check_password,
    hash_password,
    has_permission,
    permissions_for_role,
)
from app.config import _env_duration, _parse_http_addr, _split_csv
from app.responses import (
    go_time,
    normalize_codecs,
    parse_time_bound,
    valid_number,
    valid_slug,
)


def _request(query: str = "") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "query_string": query.encode(),
            "headers": [],
        }
    )


def test_password_hash_roundtrip():
    hashed = hash_password("correct horse battery staple")
    assert hashed.startswith("$2")
    assert check_password(hashed, "correct horse battery staple")
    assert not check_password(hashed, "wrong")
    assert not check_password("", "anything")


def test_token_service_roundtrip():
    service = TokenService("x" * 32, "issuer", "audience", 60, 120)
    user = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", username="alice", role="admin")
    token, expires = service.issue_access_token(user)
    assert expires.tzinfo is not None
    claims = service.parse_access_token(token)
    assert claims["uid"] == user.id
    assert claims["username"] == "alice"
    assert claims["role"] == "admin"
    assert claims["typ"] == "access"

    with pytest.raises(InvalidToken):
        service.parse_access_token(token + "x")


def test_role_permissions():
    assert has_permission("admin", "backups.write")
    assert has_permission("viewer", "extensions.read")
    assert not has_permission("viewer", "extensions.write")
    assert not has_permission("agent", "users.read")
    assert "dashboard.read" in permissions_for_role("viewer")


def test_go_time():
    value = datetime(2026, 10, 24, 12, 34, 56, 123456, tzinfo=timezone.utc)
    assert go_time(value) == "2026-10-24T12:34:56.123456Z"
    assert go_time(None) is None


def test_parse_time_bound_date_is_exclusive_for_end_of_day():
    start, exclusive, ok = parse_time_bound("2026-10-24", False)
    assert ok and not exclusive
    assert start == datetime(2026, 10, 24, tzinfo=timezone.utc)

    end, exclusive, ok = parse_time_bound("2026-10-24", True)
    assert ok and exclusive
    assert end == datetime(2026, 10, 25, tzinfo=timezone.utc)

    exact, exclusive, ok = parse_time_bound("2026-10-24T12:00:00Z", True)
    assert ok and not exclusive
    assert exact == datetime(2026, 10, 24, 12, tzinfo=timezone.utc)

    _, _, ok = parse_time_bound("not-a-date", False)
    assert not ok


def test_input_validators():
    assert valid_number("1234", 2, 10)
    assert not valid_number("12a4", 2, 10)
    assert not valid_number("1", 2, 10)
    assert valid_slug("queue-main.1", 120)
    assert not valid_slug("bad name", 120)
    assert normalize_codecs(" ULAW, alaw,ulaw ") == "ulaw,alaw"


def test_config_helpers():
    assert _parse_http_addr(":9000") == ("0.0.0.0", 9000)
    assert _parse_http_addr("127.0.0.1:8081") == ("127.0.0.1", 8081)
    assert _split_csv("a, b,,c") == ["a", "b", "c"]
    assert _env_duration("MISSING_TEST_DURATION", 15) == 15


def test_query_parsing():
    from app.responses import pagination, query_bool, query_int

    request = _request("page=2&limit=25&active=true&count=7")
    assert pagination(request) == (2, 25, 25)
    assert query_bool(request, "active") == (True, True)
    assert query_int(request, "count", 0) == 7

    empty = _request()
    assert pagination(empty) == (1, 50, 0)
    assert query_bool(empty, "active") == (False, False)
    assert query_int(empty, "count", 9) == 9
