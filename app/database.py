"""Conexão com banco PostGIS e sessão SQLAlchemy."""

from collections.abc import Generator
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()


def _normalize_database_url(url: str) -> str:
    """Aceita URI do painel Supabase e força driver + SSL."""
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://") :]
    if raw.startswith("postgresql://") and "+psycopg2" not in raw:
        raw = "postgresql+psycopg2://" + raw[len("postgresql://") :]

    # Supabase exige SSL
    if "supabase.co" in raw or "pooler.supabase.com" in raw:
        parsed = urlparse(raw)
        q = dict(parse_qsl(parsed.query, keep_blank_values=True))
        q.setdefault("sslmode", "require")
        raw = urlunparse(parsed._replace(query=urlencode(q)))
    return raw


DATABASE_URL = _normalize_database_url(settings.database_url)


def _connect_args(url: str) -> dict:
    args: dict = {
        "connect_timeout": 20,
        "client_encoding": "utf8",
        "options": "-c client_encoding=UTF8",
    }
    # sslmode na URL já cobre; reforço via connect_args em hosts Supabase
    if "supabase" in url.lower():
        args["sslmode"] = "require"
    return args


def _pool_kwargs(url: str) -> dict:
    # Pooler transaction (6543): conexões curtas
    if ":6543" in url or "pooler.supabase.com" in url:
        return {"pool_size": 5, "max_overflow": 5, "pool_recycle": 280}
    return {"pool_size": 8, "max_overflow": 10, "pool_recycle": 1800}


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,
    connect_args=_connect_args(DATABASE_URL),
    **_pool_kwargs(DATABASE_URL),
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
    """Cria extensões PostGIS (quando permitido) e tabelas do sistema."""
    with engine.begin() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions"))
        except Exception:
            try:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            except Exception as exc:  # noqa: BLE001
                print(f"[db] aviso PostGIS: {exc}")

    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def check_postgis() -> dict:
    """Verifica se PostGIS está disponível e retorna versão."""
    with engine.connect() as conn:
        try:
            version = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        except Exception:
            version = conn.execute(text("SELECT extensions.PostGIS_Version()")).scalar()
        db = conn.execute(text("SELECT current_database()")).scalar()
        return {"ok": True, "postgis": True, "version": version, "database": db}
