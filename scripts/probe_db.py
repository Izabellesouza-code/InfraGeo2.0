"""Tenta conectar em varios bancos/senhas comuns e lista schemas geoespaciais."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CANDIDATES = [
    # (user, password, host, port, database)
    ("postgres", "postgres", "localhost", 5432, "postgres"),
    ("postgres", "postgres", "localhost", 5432, "Infrageo"),
    ("postgres", "postgres", "localhost", 5432, "infrageo"),
    ("postgres", "admin", "localhost", 5432, "postgres"),
    ("postgres", "admin", "localhost", 5432, "Infrageo"),
    ("postgres", "1234", "localhost", 5432, "postgres"),
    ("postgres", "123456", "localhost", 5432, "postgres"),
    ("postgres", "root", "localhost", 5432, "postgres"),
]


def try_connect(user, password, host, port, database):
    url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}"
    engine = create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 3, "client_encoding": "latin1"},
    )
    with engine.connect() as conn:
        db = conn.execute(text("SELECT current_database()")).scalar()
        dbs = [r[0] for r in conn.execute(text("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1"))]
        return db, dbs, url


def inspect(url: str) -> None:
    engine = create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, "client_encoding": "latin1"},
    )
    with engine.connect() as conn:
        print("OK:", url)
        print("DB:", conn.execute(text("SELECT current_database()")).scalar())
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
        has_postgis = conn.execute(
            text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis')")
        ).scalar()
        print("POSTGIS:", has_postgis)
        if has_postgis:
            rows = conn.execute(
                text(
                    "SELECT f_table_schema, f_table_name, f_geometry_column, type, srid "
                    "FROM geometry_columns ORDER BY 1,2"
                )
            ).fetchall()
            print(f"GEO TABLES ({len(rows)}):")
            for r in rows:
                print(f"  {r[0]}.{r[1]} | {r[2]} | {r[3]} | SRID {r[4]}")


def main() -> None:
    for user, password, host, port, database in CANDIDATES:
        try:
            db, dbs, url = try_connect(user, password, host, port, database)
            print("CONNECTED:", url)
            print("DATABASES:", dbs)
            # Prefer Infrageo if exists
            target = None
            for name in dbs:
                if name.lower() == "infrageo":
                    target = name
                    break
            if target and target != db:
                url2 = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{target}"
                inspect(url2)
            else:
                inspect(url)
            return
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).encode("utf-8", "replace").decode("utf-8")
            print(f"FAIL {database}/{password}: {type(exc).__name__}: {msg[:180]}")
    print("Nenhuma credencial funcionou.")
    sys.exit(1)


if __name__ == "__main__":
    main()
