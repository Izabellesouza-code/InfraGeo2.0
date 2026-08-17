"""Serviço de autenticação (usuários no banco PostGIS / public.users)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import WebGISException
from app.core.security import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import TokenResponse, UserPublic

settings = get_settings()


def user_to_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        is_admin=bool(user.is_admin),
        can_upload=bool(user.can_upload or user.is_admin),
    )


def has_upload_permission(user: User) -> bool:
    """Permissão de upload: admin ou flag can_upload no banco."""
    return bool(user and user.is_active and (user.is_admin or user.can_upload))


def authenticate(db: Session, username: str, password: str) -> User:
    """Consulta public.users e valida senha."""
    user = (
        db.query(User)
        .filter(User.username == username.strip())
        .first()
    )
    if not user or not verify_password(password, user.hashed_password):
        raise WebGISException("Usuário ou senha inválidos", status_code=401)
    if not user.is_active:
        raise WebGISException("Usuário desativado", status_code=403)
    return user


def login(db: Session, username: str, password: str) -> TokenResponse:
    """Login para upload: usuário existente + ativo + permissão no PostgreSQL."""
    user = authenticate(db, username, password)
    if not has_upload_permission(user):
        raise WebGISException(
            "Usuário sem permissão para upload de camadas",
            status_code=403,
        )
    token = create_access_token(
        subject=str(user.id),
        extra={
            "username": user.username,
            "is_admin": bool(user.is_admin),
            "can_upload": True,
        },
    )
    return TokenResponse(access_token=token, user=user_to_public(user))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def ensure_auth_ready(db: Session) -> None:
    """Garante tabela users, coluna can_upload e um admin inicial se vazio."""
    from app.database import engine

    User.__table__.create(bind=engine, checkfirst=True)

    # Colunas novas em bancos já existentes
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE public.users
                ADD COLUMN IF NOT EXISTS can_upload BOOLEAN DEFAULT FALSE
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE public.users
                SET can_upload = TRUE
                WHERE is_admin = TRUE AND (can_upload IS DISTINCT FROM TRUE)
                """
            )
        )

    count = db.query(User).count()
    if count > 0:
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

    admin = User(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        full_name="Administrador",
        is_active=True,
        is_admin=True,
        can_upload=True,
    )
    db.add(admin)
    db.commit()
