"""Configura / valida o banco InfraGeo no Supabase (PostGIS + tabelas ORM).

Uso:
  1) No dashboard Supabase → Connect → copie a URI (Session pooler ou Direct)
  2) No .env:
       DATABASE_URL=postgresql+psycopg2://postgres.[REF]:[SENHA]@aws-0-[REGIAO].pooler.supabase.com:5432/postgres?sslmode=require
  3) python scripts/setup_supabase.py

Preferência de conexão (Render / PC IPv4):
  - Session pooler porta 5432 (host *.pooler.supabase.com)
  - Ou Transaction pooler porta 6543 (serverless)
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlunparse, urlencode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal, check_postgis, engine, init_db
from app.services.auth_service import ensure_auth_ready


def ensure_sslmode(url: str) -> str:
    """Garante sslmode=require em URLs Supabase."""
    if "sslmode=" in url.lower():
        return url
    if "supabase" not in url.lower():
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


def bootstrap_sql() -> None:
    statements = [
        'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions',
        "CREATE SCHEMA IF NOT EXISTS uploads",
    ]
    with engine.begin() as conn:
        for sql in statements:
            try:
                conn.execute(text(sql))
                print(f"  OK  {sql}")
            except Exception as exc:  # noqa: BLE001
                # Fallback: postgis no public (alguns projetos já têm)
                if "postgis" in sql.lower():
                    try:
                        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
                        print("  OK  CREATE EXTENSION postgis (public)")
                        continue
                    except Exception as exc2:  # noqa: BLE001
                        print(f"  !!  {sql}: {exc2}")
                else:
                    print(f"  !!  {sql}: {exc}")


def main() -> None:
    settings = get_settings()
    url = settings.database_url
    print("=== InfraGeo -> Supabase ===")
    print(f"DATABASE_URL host: {urlparse(url).hostname}")

    if "supabase" not in url.lower() and "localhost" not in url.lower():
        print(
            "Aviso: a URL nao parece Supabase. Continuando mesmo assim..."
        )

    print("-> Extensoes / schemas...")
    bootstrap_sql()

    print("-> Tabelas ORM (users, layers, features)...")
    init_db()

    print("-> Usuario bootstrap...")
    db = SessionLocal()
    try:
        ensure_auth_ready(db)
    finally:
        db.close()

    print("-> Health PostGIS...")
    info = check_postgis()
    print(f"OK {info}")


if __name__ == "__main__":
    main()
