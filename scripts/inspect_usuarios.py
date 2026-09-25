"""Inspeciona tabelas de usuário em public e no schema usuarios."""

from dotenv import load_dotenv

load_dotenv(".env", override=True)

from sqlalchemy import text

from app.config import get_settings
from app.database import engine
from sqlalchemy import create_engine

get_settings.cache_clear()
settings = get_settings()

SQL_COLS = """
SELECT column_name
FROM information_schema.columns
WHERE table_schema = :s AND table_name = :t
ORDER BY 1
"""


def inspect(label, url):
    print("====", label)
    eng = create_engine(url, pool_pre_ping=True)
    with eng.connect() as c:
        print("db", c.execute(text("select current_database()")).scalar())
        for schema, table in (
            ("public", "usuarios"),
            ("public", "users"),
            ("usuarios", "usuarios"),
        ):
            qual = f"{schema}.{table}"
            exists = c.execute(text("select to_regclass(:q)"), {"q": qual}).scalar()
            print(qual, "->", exists)
            if not exists:
                continue
            n = c.execute(text(f"select count(*) from {schema}.{table}")).scalar()
            cols = [r[0] for r in c.execute(text(SQL_COLS), {"s": schema, "t": table})]
            print("  count", n, "cols", cols)
            rows = c.execute(text(f"select * from {schema}.{table} order by 1")).mappings()
            for row in rows:
                email = row.get("email") or row.get("username")
                nome = row.get("nome") or row.get("full_name") or row.get("username")
                print("   ", row.get("id"), nome, email)


inspect("DATABASE_URL", settings.database_url)
if settings.source_database_url:
    inspect("SOURCE", settings.source_database_url)
if settings.neon_database_url and settings.neon_database_url != settings.database_url:
    inspect("NEON", settings.neon_database_url)

SQL_COLS = """
SELECT column_name
FROM information_schema.columns
WHERE table_schema = :s AND table_name = :t
ORDER BY 1
"""

with engine.connect() as c:
    print("db", c.execute(text("select current_database()")).scalar())
    for schema, table in (
        ("public", "usuarios"),
        ("public", "users"),
        ("usuarios", "usuarios"),
        ("usuarios", "password_reset_tokens"),
    ):
        qual = f"{schema}.{table}"
        exists = c.execute(text("select to_regclass(:q)"), {"q": qual}).scalar()
        print(qual, "->", exists)
        if not exists:
            continue
        n = c.execute(text(f"select count(*) from {schema}.{table}")).scalar()
        cols = [r[0] for r in c.execute(text(SQL_COLS), {"s": schema, "t": table})]
        print("  count", n, "cols", cols)
        if table in {"usuarios", "users"} and n:
            preview = c.execute(
                text(f"select * from {schema}.{table} order by 1 limit 20")
            ).mappings()
            for row in preview:
                email = row.get("email") or row.get("username")
                nome = row.get("nome") or row.get("full_name") or row.get("username")
                print("   ", row.get("id"), nome, email)
