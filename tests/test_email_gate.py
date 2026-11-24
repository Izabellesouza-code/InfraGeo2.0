import pytest

from app.config import get_settings
from app.core.exceptions import WebGISException
from app.services.auth_service import is_allowed_email, principal_from_token

DOMAIN = "allowed.test"
EXTRA = "guest@extra.test"


@pytest.fixture(autouse=True)
def allowlist_env(monkeypatch):
    monkeypatch.setenv("AUTH_ALLOWED_EMAIL_DOMAIN", DOMAIN)
    monkeypatch.setenv("AUTH_ALLOWED_EXTRA_EMAILS", EXTRA)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _ok(local: str = "pessoa") -> str:
    return f"{local}@{DOMAIN}"


def test_allows_configured_domain_and_extra():
    assert is_allowed_email(f"  {_ok()} ")
    assert is_allowed_email(_ok("NOME.SOBRENOME").upper())
    assert is_allowed_email(f"  {EXTRA.upper()} ")
    assert not is_allowed_email("outro@extra.test")


def test_rejects_other_domains():
    assert not is_allowed_email("user@gmail.com")
    assert not is_allowed_email(f"pessoa@{DOMAIN.removesuffix('.test')}")
    assert not is_allowed_email(DOMAIN)
    assert not is_allowed_email("")
    assert not is_allowed_email(f"@{DOMAIN}")


def test_guest_token_payload_builds_principal():
    email = _ok()
    principal = principal_from_token(
        {
            "auth_source": "email_gate",
            "email": email,
            "sub": email,
        },
        db=None,
    )
    assert principal is not None
    assert principal.email == email
    assert principal.is_admin is False
    assert principal.can_upload is False


def test_guest_rejects_foreign_domain_in_token():
    assert (
        principal_from_token(
            {"auth_source": "email_gate", "email": "a@gmail.com", "sub": "a@gmail.com"},
            db=None,
        )
        is None
    )


def test_entrar_com_email_rejects_without_db_call():
    from app.services import auth_service

    with pytest.raises(WebGISException) as exc:
        auth_service.entrar_com_email(db=None, email="leo.a@example.org")
    assert exc.value.status_code == 403
