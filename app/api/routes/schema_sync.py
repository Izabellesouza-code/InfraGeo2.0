"""API admin: sincronização de schemas Local → Neon."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import require_admin_user
from app.models.user import User
from app.services.schema_sync_service import SchemaSyncService

router = APIRouter()


class SchemaCreateBody(BaseModel):
    schema_name: str = Field(..., min_length=1, max_length=63)
    copy_data: bool = True
    auto_git: Optional[bool] = None


class DeleteRequestBody(BaseModel):
    reason: str = ""


class DeleteConfirmBody(BaseModel):
    confirm_phrase: str = Field(
        ...,
        description='Deve ser exatamente: EXCLUIR <nome_do_schema>',
    )
    confirm_token: str = Field(..., min_length=8)
    auto_git: Optional[bool] = None


class SourceEventBody(BaseModel):
    payload: dict[str, Any]


def _svc() -> SchemaSyncService:
    return SchemaSyncService()


@router.get("/schemas/diff")
def schemas_diff(_admin: User = Depends(require_admin_user)) -> dict[str, Any]:
    """Compara schemas da origem (local) com o Neon."""
    return {"ok": True, **_svc().diff()}


@router.post("/schemas/install-triggers")
def install_triggers(_admin: User = Depends(require_admin_user)) -> dict[str, Any]:
    """Instala event triggers NOTIFY na origem para CREATE/DROP SCHEMA."""
    return _svc().ensure_event_triggers_on_source()


@router.post("/schemas/sync-missing")
def sync_missing(
    auto_git: Optional[bool] = None,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Cria no Neon todos os schemas que existem só na origem."""
    return _svc().sync_missing_from_source(
        actor=admin.username, auto_git=auto_git
    )


@router.post("/schemas/sync-missing-from-neon")
def sync_missing_from_neon(
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Espelha no Postgres local os schemas que existem só no Neon (ex.: uploads)."""
    return _svc().sync_missing_from_neon(actor=admin.username)


@router.post("/schemas/{schema_name}/mirror-to-local")
def mirror_schema_to_local(
    schema_name: str,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Espelha um schema específico Neon → Postgres local."""
    return _svc().mirror_schema_to_source(schema_name, actor=admin.username)


@router.post("/schemas")
def create_schema(
    body: SchemaCreateBody,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Cria/espelha um schema no Neon (e opcionalmente publica no git)."""
    return _svc().create_schema_on_neon(
        body.schema_name,
        copy_data=body.copy_data,
        actor=admin.username,
        auto_git=body.auto_git,
    )


@router.post("/schemas/{schema_name}/delete-request")
def request_delete(
    schema_name: str,
    body: DeleteRequestBody,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """
    Etapa 1 da exclusão segura: NÃO apaga no Neon.
    Retorna token + frase obrigatória para a confirmação.
    """
    return _svc().request_delete(
        schema_name, actor=admin.username, reason=body.reason
    )


@router.delete("/schemas/{schema_name}")
def confirm_delete(
    schema_name: str,
    body: DeleteConfirmBody,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """
    Etapa 2: apaga schema no Neon somente com frase + token corretos.
    Schemas protegidos (LIMITE_*, public, topology…) nunca são apagados.
    """
    return _svc().confirm_delete(
        schema_name,
        confirm_phrase=body.confirm_phrase,
        confirm_token=body.confirm_token,
        actor=admin.username,
        auto_git=body.auto_git,
    )


@router.post("/schemas/{schema_name}/delete-cancel")
def cancel_delete(
    schema_name: str,
    _admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Cancela uma exclusão pendente."""
    return _svc().cancel_delete(schema_name)


@router.post("/schemas/source-event")
def source_event(
    body: SourceEventBody,
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Recebe evento DDL da origem (usado pelo watcher)."""
    return _svc().handle_source_event(body.payload, actor=admin.username)


@router.post("/schemas/snapshot")
def write_snapshot(
    admin: User = Depends(require_admin_user),
) -> dict[str, Any]:
    """Atualiza data/catalog_snapshot.json a partir do Neon."""
    snap = _svc().write_catalog_snapshot(actor=admin.username, reason="manual")
    return {"ok": True, "snapshot": snap}
