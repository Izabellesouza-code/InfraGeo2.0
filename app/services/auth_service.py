"""Serviço de autenticação (usuários no banco PostGIS)."""

from __future__ import annotations

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
    )


def authenticate(db: Session, username: str, password: str) -> User:
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
    user = authenticate(db, username, password)
    token = create_access_token(
        subject=str(user.id),
        extra={"username": user.username, "is_admin": bool(user.is_admin)},
    )
    return TokenResponse(access_token=token, user=user_to_public(user))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def ensure_auth_ready(db: Session) -> None:
    """Garante tabela users e um admin inicial se o banco estiver vazio."""
    from app.database import engine

    User.__table__.create(bind=engine, checkfirst=True)

    count = db.query(User).count()
    if count > 0:
        return

    username = (settings.auth_bootstrap_username or "admin").strip()
    password = settings.auth_bootstrap_password or "InfraGeo@2026"
    email = settings.auth_bootstrap_email or f"{username}@infrageo.local"

    admin = User(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        full_name="Administrador",
        is_active=True,
        is_admin=True,
    )
    db.add(admin)
    db.commit()
