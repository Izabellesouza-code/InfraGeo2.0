"""Serviço de autenticação contra public.usuarios no Neon."""

from __future__ import annotations

import hashlib
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import WebGISException
from app.core.security import create_access_token, hash_password, verify_password
from app.models.password_reset import PasswordResetToken
from app.models.usuario import Usuario
from app.schemas.auth import TokenResponse, UserPublic
from app.services.mail_service import send_email

settings = get_settings()

RESET_TOKEN_HOURS = 1
RESET_TOKEN_DIGITS = 6
GENERIC_RESET_MSG = (
    "Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos. "
    "Confira a caixa de entrada e o spam."
)


class AuthPrincipal:
    """Usuário da sessão (linha em public.usuarios)."""

    def __init__(
        self,
        id: int,
        username: str,
        email: str,
        full_name: str | None,
        is_active: bool = True,
        is_admin: bool = False,
        can_upload: bool = False,
        source: str = "usuarios",
    ) -> None:
        self.id = id
        self.username = username
        self.email = email
        self.full_name = full_name
        self.is_active = is_active
        self.is_admin = is_admin
        self.can_upload = can_upload
        self.source = source


def user_to_public(user: Usuario | AuthPrincipal) -> UserPublic:
    email = getattr(user, "email", "") or ""
    nome = getattr(user, "full_name", None) or getattr(user, "nome", None)
    return UserPublic(
        id=int(user.id or 0),
        username=email or getattr(user, "username", "") or (nome or ""),
        email=email,
        full_name=nome,
        is_admin=bool(user.is_admin),
        can_upload=bool(user.can_upload or user.is_admin),
        is_active=bool(getattr(user, "is_active", True)),
    )


def has_upload_permission(user: Usuario | AuthPrincipal) -> bool:
    return bool(user and user.is_active and (user.is_admin or user.can_upload))


def _looks_like_bcrypt(value: str) -> bool:
    return bool(value) and value.startswith(("$2a$", "$2b$", "$2y$")) and len(value) >= 50


def _verify_stored_password(plain: str, stored: str) -> bool:
    if _looks_like_bcrypt(stored):
        return verify_password(plain, stored)
    return secrets.compare_digest(plain.encode("utf-8"), (stored or "").encode("utf-8"))


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _principal_from_usuario(user: Usuario) -> AuthPrincipal:
    return AuthPrincipal(
        id=user.id,
        username=user.email,
        email=user.email,
        full_name=user.nome,
        is_active=bool(user.is_active),
        is_admin=bool(user.is_admin),
        can_upload=bool(user.can_upload or user.is_admin),
        source="usuarios",
    )


def find_usuario(db: Session, login: str) -> Usuario | None:
    key = (login or "").strip()
    if not key:
        return None
    return (
        db.query(Usuario)
        .filter(
            or_(
                func.lower(Usuario.email) == key.lower(),
                func.lower(Usuario.nome) == key.lower(),
            )
        )
        .first()
    )


def authenticate(db: Session, username: str, password: str) -> Usuario:
    user = find_usuario(db, username)
    if not user or not _verify_stored_password(password, user.senha_hash or ""):
        raise WebGISException("Usuário ou senha inválidos", status_code=401)
    if user.is_active is False:
        raise WebGISException("Usuário desativado", status_code=403)
    if not _looks_like_bcrypt(user.senha_hash or ""):
        user.senha_hash = hash_password(password)
        db.commit()
        db.refresh(user)
    return user


def login(db: Session, username: str, password: str) -> TokenResponse:
    user = authenticate(db, username, password)
    principal = _principal_from_usuario(user)
    token = create_access_token(
        subject=str(principal.id),
        extra={
            "username": principal.username,
            "is_admin": bool(principal.is_admin),
            "can_upload": bool(principal.can_upload),
            "auth_source": principal.source,
        },
    )
    return TokenResponse(access_token=token, user=user_to_public(principal))


def principal_from_token(payload: dict, db: Session | None = None) -> AuthPrincipal | None:
    if not db:
        return None
    sub = str(payload.get("sub") or "")
    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        return None
    user = get_user_by_id(db, user_id)
    if not user or user.is_active is False:
        return None
    return _principal_from_usuario(user)


def get_user_by_id(db: Session, user_id: int) -> Usuario | None:
    return db.query(Usuario).filter(Usuario.id == user_id).first()


def _normalize_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.casefold().split())


def recover_password(db: Session, email: str, nome: str, new_password: str) -> None:
    """Redefine senha com e-mail + nome cadastrados, sem SMTP."""
    key = (email or "").strip().lower()
    name = _normalize_name(nome)
    password = (new_password or "").strip()
    if not key or not name or len(password) < 6:
        raise WebGISException("Preencha e-mail, nome completo e a nova senha.", status_code=400)

    user = db.query(Usuario).filter(func.lower(Usuario.email) == key).first()
    if (
        not user
        or user.is_active is False
        or _normalize_name(user.nome) != name
    ):
        raise WebGISException("E-mail e nome não conferem com o cadastro.", status_code=400)

    user.senha_hash = hash_password(password)
    db.commit()


def request_password_reset(db: Session, email: str, public_base_url: str) -> str:
    """Cria token, envia e-mail se o endereço existir. Sempre retorna mensagem genérica."""
    key = (email or "").strip().lower()
    if not key:
        return GENERIC_RESET_MSG

    user = db.query(Usuario).filter(func.lower(Usuario.email) == key).first()
    if not user or user.is_active is False:
        return GENERIC_RESET_MSG

    raw = f"{secrets.randbelow(10 ** RESET_TOKEN_DIGITS):0{RESET_TOKEN_DIGITS}d}"
    now = datetime.now(timezone.utc)
    db.add(
        PasswordResetToken(
            usuario_id=user.id,
            token_hash=_hash_reset_token(raw),
            expires_at=now + timedelta(hours=RESET_TOKEN_HOURS),
        )
    )
    db.commit()

    base = (public_base_url or settings.app_public_url or "").rstrip("/")
    link = f"{base}/redefinir-senha" if base else "/redefinir-senha"
    nome = user.nome or "usuário"
    text_body = (
        f"Olá, {nome}.\n\n"
        "Seu código para redefinir a senha no InfraGeo AM é:\n\n"
        f"{raw}\n\n"
        f"Digite apenas esses {RESET_TOKEN_DIGITS} números em {link}\n"
        f"O código vale por {RESET_TOKEN_HOURS} hora(s). "
        "Se você não pediu isso, ignore este e-mail.\n"
    )
    html_body = (
        f"<p>Olá, {nome}.</p>"
        "<p>Seu código para redefinir a senha no <strong>InfraGeo AM</strong> é:</p>"
        f'<p style="font-size:28px;letter-spacing:6px;font-weight:700;">{raw}</p>'
        f'<p>Digite apenas esses {RESET_TOKEN_DIGITS} números em '
        f'<a href="{link}">{link}</a>.</p>'
        f"<p>O código vale por {RESET_TOKEN_HOURS} hora(s). "
        "Se você não pediu isso, ignore este e-mail.</p>"
    )
    send_email(
        to_address=user.email,
        subject="InfraGeo AM — código para redefinir senha",
        body_text=text_body,
        body_html=html_body,
    )
    return GENERIC_RESET_MSG


def reset_password(db: Session, token: str, new_password: str) -> None:
    raw = (token or "").strip()
    password = (new_password or "").strip()
    if not raw.isdigit() or len(raw) != RESET_TOKEN_DIGITS or len(password) < 6:
        raise WebGISException(
            "Informe o código de 6 dígitos e uma senha com pelo menos 6 caracteres",
            status_code=400,
        )

    now = datetime.now(timezone.utc)
    row = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == _hash_reset_token(raw))
        .first()
    )
    if not row or row.used_at is not None or row.expires_at < now:
        raise WebGISException("Token inválido ou expirado", status_code=400)

    user = get_user_by_id(db, row.usuario_id)
    if not user or user.is_active is False:
        raise WebGISException("Token inválido ou expirado", status_code=400)

    user.senha_hash = hash_password(password)
    row.used_at = now
    db.commit()


def list_usuarios(db: Session) -> list[Usuario]:
    return db.query(Usuario).order_by(Usuario.id).all()


def create_usuario(
    db: Session,
    *,
    nome: str,
    email: str,
    password: str,
    is_admin: bool = False,
    can_upload: bool = True,
) -> Usuario:
    """Insere em public.usuarios no Neon (nome, email, senha_hash)."""
    nome_limpo = (nome or "").strip()[:100]
    email_limpo = (email or "").strip().lower()
    senha = (password or "").strip()
    if not nome_limpo or not email_limpo or len(senha) < 6:
        raise WebGISException(
            "Informe nome, e-mail e senha com pelo menos 6 caracteres.",
            status_code=400,
        )
    existe = db.query(Usuario).filter(func.lower(Usuario.email) == email_limpo).first()
    if existe:
        raise WebGISException("Já existe um usuário com este e-mail.", status_code=409)

    db.execute(
        text(
            """
            INSERT INTO public.usuarios
                (nome, email, senha_hash, is_active, is_admin, can_upload)
            VALUES
                (:nome, :email, :senha_hash, TRUE, :is_admin, :can_upload)
            """
        ),
        {
            "nome": nome_limpo,
            "email": email_limpo,
            "senha_hash": hash_password(senha),
            "is_admin": bool(is_admin),
            "can_upload": bool(can_upload or is_admin),
        },
    )
    db.commit()
    user = db.query(Usuario).filter(func.lower(Usuario.email) == email_limpo).first()
    if not user:
        raise WebGISException("Não foi possível gravar o usuário no Neon.", status_code=500)
    return user


def update_usuario(
    db: Session,
    user_id: int,
    *,
    actor_id: int | None = None,
    nome: str | None = None,
    email: str | None = None,
    password: str | None = None,
    is_admin: bool | None = None,
    can_upload: bool | None = None,
    is_active: bool | None = None,
) -> Usuario:
    user = get_user_by_id(db, user_id)
    if not user:
        raise WebGISException("Usuário não encontrado.", status_code=404)

    next_admin = user.is_admin if is_admin is None else bool(is_admin)
    next_active = user.is_active if is_active is None else bool(is_active)
    if user.is_admin and (not next_admin or not next_active):
        outros = (
            db.query(Usuario)
            .filter(
                Usuario.id != user.id,
                Usuario.is_admin.is_(True),
                Usuario.is_active.is_(True),
            )
            .count()
        )
        if outros < 1:
            raise WebGISException(
                "É preciso manter pelo menos um administrador ativo.",
                status_code=400,
            )
    if actor_id is not None and int(actor_id) == int(user.id) and is_active is False:
        raise WebGISException("Você não pode desativar a própria conta.", status_code=400)

    if nome is not None:
        user.nome = nome.strip()[:100]
    if email is not None:
        email_limpo = email.strip().lower()
        outro = (
            db.query(Usuario)
            .filter(func.lower(Usuario.email) == email_limpo, Usuario.id != user.id)
            .first()
        )
        if outro:
            raise WebGISException("Já existe um usuário com este e-mail.", status_code=409)
        user.email = email_limpo
    if password:
        senha = password.strip()
        if len(senha) < 6:
            raise WebGISException("A senha deve ter pelo menos 6 caracteres.", status_code=400)
        user.senha_hash = hash_password(senha)
    if is_admin is not None:
        user.is_admin = bool(is_admin)
    if can_upload is not None or is_admin is not None:
        admin_flag = user.is_admin
        upload_flag = True if admin_flag else (user.can_upload if can_upload is None else bool(can_upload))
        user.can_upload = bool(upload_flag or admin_flag)
    if is_active is not None:
        user.is_active = bool(is_active)

    db.commit()
    db.refresh(user)
    return user


def ensure_auth_ready(db: Session) -> None:
    """Garante tabela usuarios, colunas extras e hashes bcrypt."""
    from app.database import engine
    from app.models.password_reset import PasswordResetToken as ResetModel

    Usuario.__table__.create(bind=engine, checkfirst=True)
    ResetModel.__table__.create(bind=engine, checkfirst=True)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE public.usuarios
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS can_upload BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE public.usuarios
                SET is_active = COALESCE(is_active, TRUE),
                    can_upload = COALESCE(can_upload, TRUE)
                """
            )
        )

    for user in db.query(Usuario).all():
        stored = user.senha_hash or ""
        if stored and not _looks_like_bcrypt(stored):
            user.senha_hash = hash_password(stored)
    db.commit()

    if db.query(Usuario).filter(Usuario.is_admin.is_(True)).count() == 0:
        first = db.query(Usuario).order_by(Usuario.id).first()
        if first:
            first.is_admin = True
            first.can_upload = True
            db.commit()

    if db.query(Usuario).count() > 0:
        return

    username = (settings.auth_bootstrap_username or "admin").strip()
    password = (settings.auth_bootstrap_password or "").strip()
    if not password:
        raise WebGISException(
            "AUTH_BOOTSTRAP_PASSWORD não definido — "
            "impossível criar o usuário administrador inicial",
            status_code=500,
        )
    email = settings.auth_bootstrap_email or f"{username}@infrageo.local"
    db.add(
        Usuario(
            nome=username,
            email=email,
            senha_hash=hash_password(password),
            is_active=True,
            is_admin=True,
            can_upload=True,
        )
    )
    db.commit()
