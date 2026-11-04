import pytest

from app.core.exceptions import WebGISException
from app.services.auth_service import ALLOWED_EMAIL_DOMAIN, is_allowed_email, principal_from_token


def _ok(local: str = "pessoa") -> str:
    return f"{local}@{ALLOWED_EMAIL_DOMAIN}"


def test_allows_consorcio_domain():
    assert is_allowed_email(f"  {_ok()} ")
    assert is_allowed_email(_ok("NOME.SOBRENOME").upper())
    assert is_allowed_email("  SANDRO@UNICACONSULTORES.COM.BR ")
    assert not is_allowed_email("outro@unicaconsultores.com.br")


def test_rejects_other_domains():
    assert not is_allowed_email("user@gmail.com")
    assert not is_allowed_email(f"pessoa@{ALLOWED_EMAIL_DOMAIN.removesuffix('.br')}")
    assert not is_allowed_email(ALLOWED_EMAIL_DOMAIN)
    assert not is_allowed_email("")
    assert not is_allowed_email(f"@{ALLOWED_EMAIL_DOMAIN}")


def test_guest_token_payload_builds_principal():
    email = "pessoa@exemplo.com"
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


def test_guest_rejects_invalid_email_in_token():
    assert (
        principal_from_token(
            {"auth_source": "email_gate", "email": "sem-arroba", "sub": "sem-arroba"},
            db=None,
        )
        is None
    )


def test_entrar_com_email_rejects_invalid_email():
    from app.services import auth_service

    with pytest.raises(WebGISException) as exc:
        auth_service.entrar_com_email(db=None, email="invalido")
    assert exc.value.status_code == 403
