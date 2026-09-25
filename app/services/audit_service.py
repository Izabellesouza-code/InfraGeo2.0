"""Grava e consulta o histórico de auditoria em usuarios.audit_logs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def client_ip(request: Request | None) -> str:
    if not request:
        return ""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    if request.client and request.client.host:
        return str(request.client.host)[:64]
    return ""


def _actor_fields(actor: Any) -> tuple[int | None, str, str]:
    if actor is None:
        return None, "", ""
    if isinstance(actor, dict):
        aid = actor.get("id")
        try:
            aid = int(aid) if aid is not None else None
        except (TypeError, ValueError):
            aid = None
        nome = str(actor.get("full_name") or actor.get("nome") or actor.get("username") or "")
        email = str(actor.get("email") or "")
        return aid, nome[:200], email[:200]
    aid = getattr(actor, "id", None)
    try:
        aid = int(aid) if aid is not None else None
    except (TypeError, ValueError):
        aid = None
    if hasattr(actor, "model_dump"):
        try:
            dumped = actor.model_dump()
            if isinstance(dumped, dict):
                return _actor_fields(dumped)
        except Exception:  # noqa: BLE001
            pass
    nome = str(
        getattr(actor, "full_name", None)
        or getattr(actor, "nome", None)
        or getattr(actor, "username", "")
        or ""
    )
    email = str(getattr(actor, "email", "") or "")
    return aid, nome[:200], email[:200]


def record(
    *,
    category: str,
    action: str,
    summary: str,
    actor: Any = None,
    actor_email: str = "",
    target: str = "",
    ip: str = "",
    request: Request | None = None,
    db: Session | None = None,
) -> None:
    """Registra um evento. Falha silenciosa para não quebrar a ação principal."""
    from app.database import SessionLocal

    actor_id, nome, email = _actor_fields(actor)
    if actor_email and not email:
        email = actor_email[:200]
        if not nome:
            nome = actor_email[:200]
    own = db is None
    if own:
        db = SessionLocal()
    try:
        db.add(
            AuditLog(
                category=(category or "alteracao")[:32],
                action=(action or "evento")[:64],
                summary=(summary or "")[:500],
                actor_id=actor_id,
                actor_nome=nome,
                actor_email=email,
                target=(target or "")[:300],
                ip=(ip or client_ip(request))[:64],
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[audit] {exc}")
    finally:
        if own:
            db.close()


def record_access_once(
    *,
    actor: Any,
    pagina: str,
    request: Request | None = None,
    minutes: int = 10,
    db: Session | None = None,
) -> None:
    """Evita encher o log com o mesmo acesso no intervalo."""
    from app.database import SessionLocal

    actor_id, nome, email = _actor_fields(actor)
    key = (pagina or "mapa").strip().lower()[:80]
    if key not in {"mapa", "painel"}:
        key = "mapa"
    labels = {
        "mapa": "Abriu o mapa",
        "painel": "Abriu o painel de administrador",
    }
    own = db is None
    if own:
        db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        q = db.query(AuditLog).filter(
            AuditLog.category == "acesso",
            AuditLog.target == key,
            AuditLog.created_at >= cutoff,
        )
        if actor_id is not None:
            q = q.filter(AuditLog.actor_id == actor_id)
        elif email:
            q = q.filter(AuditLog.actor_email == email)
        if q.first():
            return
        db.add(
            AuditLog(
                category="acesso",
                action="acesso",
                summary=labels[key],
                actor_id=actor_id,
                actor_nome=nome,
                actor_email=email,
                target=key,
                ip=client_ip(request),
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[audit] {exc}")
    finally:
        if own:
            db.close()


def list_logs(
    db: Session,
    *,
    category: str | None = None,
    limit: int = 400,
) -> list[AuditLog]:
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    key = (category or "").strip().lower()
    if key == "login":
        q = q.filter(AuditLog.category == "login")
    elif key == "mapa":
        q = q.filter(AuditLog.category == "acesso", AuditLog.target == "mapa")
    elif key == "painel":
        q = q.filter(AuditLog.category == "acesso", AuditLog.target == "painel")
    elif key == "acesso":
        q = q.filter(AuditLog.category == "acesso")
    elif key == "alteracao":
        q = q.filter(AuditLog.category == "alteracao")
    cap = max(1, min(int(limit or 400), 800))
    return q.limit(cap).all()


def to_public(row: AuditLog) -> dict[str, Any]:
    created = row.created_at
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "created_at": created.isoformat() if created else None,
        "category": row.category,
        "action": row.action,
        "summary": row.summary,
        "actor_id": row.actor_id,
        "actor_nome": row.actor_nome,
        "actor_email": row.actor_email,
        "target": row.target,
        "ip": row.ip,
    }
