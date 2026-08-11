"""Lista schemas e geometrias do PostGIS usando .env atual."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(ROOT / ".env", override=True)

from app.config import get_settings

settings = get_settings()
get_settings.cache_clear()
settings = get_settings()

print("URL:", settings.database_url)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 8, "client_encoding": "latin1"},
)

with engine.connect() as conn:
    print("DB:", conn.execute(text("SELECT current_database()")).scalar())
    print("USER:", conn.execute(text("SELECT current_user")).scalar())
    print("POSTGIS:", conn.execute(text("SELECT PostGIS_Version()")).scalar())

    schemas = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT schema_name FROM information_schema.schemata "
                "WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') "
                "ORDER BY 1"
            )
        )
    ]
    print("SCHEMAS:", schemas)

    rows = conn.execute(
        text(
            """
            SELECT f_table_schema, f_table_name, f_geometry_column, type, srid
            FROM geometry_columns
            ORDER BY 1, 2
            """
        )
    ).fetchall()
    print(f"GEO_TABLES={len(rows)}")
    for schema, table, col, gtype, srid in rows:
        try:
            cnt = conn.execute(
                text(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
            ).scalar()
        except Exception as exc:  # noqa: BLE001
            cnt = f"err:{exc}"
        print(f"  {schema}.{table} | {col} | {gtype} | SRID {srid} | n={cnt}")
