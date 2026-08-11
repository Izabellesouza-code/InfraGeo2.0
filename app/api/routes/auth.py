"""Rotas de autenticação."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import decode_access_token
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic
from app.services import auth_service

router = APIRouter()
bearer = HTTPBearer(auto_error=False)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Autentica com usuário cadastrado na tabela public.users."""
    return auth_service.login(db, payload.username, payload.password)


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user)) -> UserPublic:
    """Retorna o usuário autenticado."""
    return auth_service.user_to_public(user)


@router.get("/status")
def auth_status(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Indica se há sessão válida (sem exigir 401)."""
    if not credentials or not credentials.credentials:
        return {"authenticated": False, "user": None}
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        return {"authenticated": False, "user": None}
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        return {"authenticated": False, "user": None}
    user = auth_service.get_user_by_id(db, user_id)
    if not user or not user.is_active:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": auth_service.user_to_public(user).model_dump(),
    }
