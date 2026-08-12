"""Conexão com banco PostGIS e sessão SQLAlchemy."""

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    echo=False,
    connect_args={
        "connect_timeout": 10,
        "client_encoding": "utf8",
        "options": "-c client_encoding=UTF8",
    },
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base declarativa para todos os modelos ORM."""


def get_db() -> Generator[Session, None, None]:
    """Dependency FastAPI: fornece sessão e garante fechamento."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Cria extensões PostGIS e tabelas do sistema."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))

    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def check_postgis() -> dict:
    """Verifica se PostGIS está disponível e retorna versão."""
    with engine.connect() as conn:
        version = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        db = conn.execute(text("SELECT current_database()")).scalar()
        return {"ok": True, "postgis": True, "version": version, "database": db}
