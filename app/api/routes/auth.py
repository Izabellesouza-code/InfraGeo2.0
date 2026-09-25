"""Rotas de autenticação."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, extract_access_token, get_current_user, require_admin_user
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.core.security import ACCESS_TOKEN_EXPIRE_MINUTES, decode_access_token
from app.database import get_db
from app.schemas.auth import (
    AuditAccessIn,
    ChangePasswordRequest,
    CreateUserRequest,
    CreatedUserResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RecoverPasswordRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateUserRequest,
    UserPublic,
)
from app.services import audit_service, auth_service

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
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Autentica contra a tabela usuarios.usuarios no Neon."""
    try:
        result = auth_service.login(db, payload.username, payload.password)
    except WebGISException as exc:
        if exc.status_code in {401, 403}:
            audit_service.record(
                category="login",
                action="login_falha",
                summary=f"Login recusado para {payload.username}",
                actor_email=payload.username,
                target="login",
                request=request,
                db=db,
            )
        raise
    quem = result.user.email or result.user.username
    audit_service.record(
        category="login",
        action="login",
        summary=f"Entrou no sistema ({quem})",
        actor=result.user,
        target="login",
        request=request,
        db=db,
    )
    _set_session_cookie(response, result.access_token)
    return result


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    request: Request,
    principal: auth_service.AuthPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Troca a senha provisória (primeiro acesso) ou a senha atual."""
    user = auth_service.get_user_by_id(db, int(principal.id))
    if not user:
        raise WebGISException("Usuário não encontrado.", status_code=404)
    result = auth_service.change_own_password(
        db, user, payload.current_password, payload.new_password
    )
    audit_service.record(
        category="alteracao",
        action="senha",
        summary="Alterou a própria senha",
        actor=principal,
        request=request,
    )
    _set_session_cookie(response, result.access_token)
    return result


@router.post("/recover-password")
def recover_password(
    payload: RecoverPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Redefine senha com e-mail e nome cadastrados no Neon."""
    auth_service.recover_password(db, payload.email, payload.nome, payload.new_password)
    audit_service.record(
        category="alteracao",
        action="senha_recuperada",
        summary="Redefiniu a senha pelo fluxo de recuperação",
        actor_email=payload.email,
        target=payload.email,
        request=request,
    )
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
    """Grava a nova senha em usuarios.usuarios."""
    auth_service.reset_password(db, payload.token, payload.new_password)
    return {"message": "Senha atualizada. Faça login com a nova senha."}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    token = extract_access_token(request, credentials)
    actor = None
    if token:
        payload = decode_access_token(token)
        if payload:
            actor = auth_service.principal_from_token(payload, db)
    if actor:
        audit_service.record(
            category="login",
            action="logout",
            summary=f"Saiu do sistema ({actor.email or actor.username})",
            actor=actor,
            target="logout",
            request=request,
            db=db,
        )
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


@router.post("/users", response_model=CreatedUserResponse)
def create_user(
    payload: CreateUserRequest,
    request: Request,
    admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> CreatedUserResponse:
    user, temporary_password = auth_service.create_usuario(
        db,
        nome=payload.nome,
        email=payload.email,
        password=payload.password,
        is_admin=payload.is_admin,
        can_upload=payload.can_upload,
    )
    audit_service.record(
        category="alteracao",
        action="usuario_criar",
        summary=f"Convidou o usuário {user.email}",
        actor=admin,
        target=user.email,
        request=request,
    )
    public = auth_service.user_to_public(user)
    return CreatedUserResponse(
        **public.model_dump(),
        temporary_password=temporary_password,
    )


@router.patch("/users/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    request: Request,
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
    bits = []
    if payload.nome is not None:
        bits.append("nome")
    if payload.email is not None:
        bits.append("e-mail")
    if payload.password:
        bits.append("senha")
    if payload.is_admin is not None or payload.can_upload is not None:
        bits.append("nível de acesso")
    if payload.is_active is not None:
        bits.append("status")
    what = ", ".join(bits) or "dados"
    audit_service.record(
        category="alteracao",
        action="usuario_editar",
        summary=f"Alterou {what} de {user.email}",
        actor=admin,
        target=user.email,
        request=request,
    )
    return auth_service.user_to_public(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    alvo = auth_service.get_user_by_id(db, user_id)
    email = alvo.email if alvo else str(user_id)
    auth_service.delete_usuario(db, user_id, actor_id=int(admin.id or 0))
    audit_service.record(
        category="alteracao",
        action="usuario_excluir",
        summary=f"Excluiu o usuário {email}",
        actor=admin,
        target=email,
        request=request,
    )
    return {"ok": True}


@router.get("/audit")
def list_audit(
    category: Optional[str] = None,
    _admin: auth_service.AuthPrincipal = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = audit_service.list_logs(db, category=category)
    return {"count": len(rows), "items": [audit_service.to_public(r) for r in rows]}


@router.post("/audit/acesso")
def audit_acesso(
    request: Request,
    payload: AuditAccessIn,
    user: auth_service.AuthPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    audit_service.record_access_once(
        actor=user, pagina=payload.pagina, request=request, db=db
    )
    return {"ok": True}


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
