"""Rotas de autenticação."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, extract_access_token, get_current_user, require_admin_user
from app.config import get_settings
from app.core.security import ACCESS_TOKEN_EXPIRE_MINUTES, decode_access_token
from app.database import get_db
from app.schemas.auth import (
    CreateUserRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RecoverPasswordRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateUserRequest,
    UserPublic,
)
from app.services import auth_service

router = APIRouter()
bearer = HTTPBearer(auto_error=False)


def _cookie_kwargs() -> dict[str, Any]:
    """Em produção o front (Vercel) chama a API (Render): cookie precisa cruzar origem."""
    cross_site = not get_settings().debug
    return {
        "httponly": True,
        "secure": cross_site,
        "samesite": "none" if cross_site else "lax",
        "path": "/",
    }


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **_cookie_kwargs(),
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Autentica contra a tabela public.usuarios no Neon."""
    result = auth_service.login(db, payload.username, payload.password)
    _set_session_cookie(response, result.access_token)
    return result


@router.post("/recover-password")
def recover_password(
    payload: RecoverPasswordRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Redefine senha com e-mail e nome cadastrados no Neon."""
    auth_service.recover_password(db, payload.email, payload.nome, payload.new_password)
    return {"message": "Senha atualizada. Faça login com a nova senha."}


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Envia token de redefinição para o e-mail cadastrado em usuarios."""
    base = (auth_service.settings.app_public_url or str(request.base_url)).rstrip("/")
    message = auth_service.request_password_reset(db, payload.email, base)
    return {"message": message}


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Grava a nova senha em public.usuarios."""
    auth_service.reset_password(db, payload.token, payload.new_password)
    return {"message": "Senha atualizada. Faça login com a nova senha."}


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    kw = _cookie_kwargs()
    response.delete_cookie(
        SESSION_COOKIE,
        path=kw["path"],
        samesite=kw["samesite"],
        secure=kw["secure"],
    )
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
def me(user: auth_service.AuthPrincipal = Depends(get_current_user)) -> UserPublic:
    """Retorna o usuário autenticado."""
    return auth_service.user_to_public(user)


@router.get("/users", response_model=list[UserPublic])
def list_users(
    _admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> list[UserPublic]:
    return [auth_service.user_to_public(u) for u in auth_service.list_usuarios(db)]


@router.post("/users", response_model=UserPublic)
def create_user(
    payload: CreateUserRequest,
    _admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserPublic:
    user = auth_service.create_usuario(
        db,
        nome=payload.nome,
        email=payload.email,
        password=payload.password,
        is_admin=payload.is_admin,
        can_upload=payload.can_upload,
    )
    return auth_service.user_to_public(user)


@router.patch("/users/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> UserPublic:
    user = auth_service.update_usuario(
        db,
        user_id,
        actor_id=int(admin.id or 0),
        nome=payload.nome,
        email=payload.email,
        password=payload.password,
        is_admin=payload.is_admin,
        can_upload=payload.can_upload,
        is_active=payload.is_active,
    )
    return auth_service.user_to_public(user)


@router.get("/status")
def auth_status(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Indica se há sessão válida (sem exigir 401)."""
    token = extract_access_token(request, credentials)
    if not token:
        return {"authenticated": False, "user": None}
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return {"authenticated": False, "user": None}
    user = auth_service.principal_from_token(payload, db)
    if not user or not user.is_active:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": auth_service.user_to_public(user).model_dump(),
    }
