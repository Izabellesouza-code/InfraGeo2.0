"""Histórico de logins, acessos e alterações."""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.usuario import AUTH_SCHEMA


class AuditLog(Base):
    """Uma linha por evento (quem, o quê, quando)."""

    __tablename__ = "audit_logs"
    __table_args__ = {"schema": AUTH_SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    actor_nome: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    actor_email: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    target: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
