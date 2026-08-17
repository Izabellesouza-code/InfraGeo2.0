"""Diff + sync source (rede local) → Neon. Nunca toca no schema public."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(ROOT / ".env", override=True)

from app.config import get_settings
from app.services.schema_sync_service import SchemaSyncService, _sa_url

get_settings.cache_clear()

SOURCE = os.getenv("SOURCE_DATABASE_URL", "").strip()
NEON = (os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()

if not SOURCE:
    raise SystemExit(
        "Defina SOURCE_DATABASE_URL no .env (Postgres origem). "
        "Não há fallback com senha no código."
    )
if not NEON:
    raise SystemExit(
        "Defina NEON_DATABASE_URL ou DATABASE_URL no .env (Neon/nuvem)."
    )

os.environ["SOURCE_DATABASE_URL"] = SOURCE
os.environ["NEON_DATABASE_URL"] = NEON
# força re-leitura
get_settings.cache_clear()


def list_schemas(eng) -> set[str]:
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT nspname FROM pg_namespace "
                "WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' "
                "AND nspname NOT IN ('information_schema')"
            )
        ).fetchall()
    return {r[0] for r in rows if r[0].lower() != "public"}


def list_geo(eng) -> set[tuple[str, str]]:
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT f_table_schema, f_table_name FROM geometry_columns "
                "WHERE lower(f_table_schema) <> 'public'"
            )
        ).fetchall()
    return {(r[0], r[1]) for r in rows}


def main() -> None:
    src_eng = create_engine(_sa_url(SOURCE), pool_pre_ping=True, connect_args={"connect_timeout": 15})
    neon_eng = create_engine(_sa_url(NEON), pool_pre_ping=True, connect_args={"connect_timeout": 30})

    ss, ns = list_schemas(src_eng), list_schemas(neon_eng)
    sg, ng = list_geo(src_eng), list_geo(neon_eng)

    print("SOURCE_ONLY_SCHEMAS", sorted(ss - ns))
    print("NEON_ONLY_SCHEMAS", sorted(ns - ss))
    print("GEO_SOURCE_ONLY", sorted(f"{a}.{b}" for a, b in sorted(sg - ng)))
    print("GEO_NEON_ONLY", sorted(f"{a}.{b}" for a, b in sorted(ng - sg)))
    print("GEO_BOTH", len(sg & ng))

    # schemas a sincronizar: só na origem OU com tabelas geo faltando no Neon
    missing_schema = ss - ns
    missing_geo_schemas = {a for a, _ in (sg - ng)}
    to_sync = sorted((missing_schema | missing_geo_schemas) - {"public", "Public"})
    # nunca public
    to_sync = [s for s in to_sync if s.lower() != "public"]

    print("TO_SYNC", to_sync)
    if not to_sync:
        print("Nada novo para sincronizar (exceto public, que é ignorado).")
        svc = SchemaSyncService()
        # ainda atualiza snapshot do Neon
        snap = svc.write_catalog_snapshot(actor="sync-script", reason="no-changes")
        print("SNAPSHOT", snap.get("schema_count"), "schemas,", snap.get("table_count"), "tables")
        return

    # Injeta URLs no settings via env antes de criar o service
    os.environ["SOURCE_DATABASE_URL"] = SOURCE
    os.environ["NEON_DATABASE_URL"] = NEON
    get_settings.cache_clear()
    svc = SchemaSyncService()

    results = []
    for schema in to_sync:
        if schema.lower() == "public":
            print("SKIP public")
            continue
        print(f"SYNC {schema} ...")
        try:
            res = svc.create_schema_on_neon(
                schema, copy_data=True, actor="sync-script", auto_git=False
            )
            results.append(res)
            print(
                f"  ok dump={res.get('dump_ok')} tables={res.get('copied_objects')}"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL {schema}: {exc}")
            results.append({"schema": schema, "ok": False, "error": str(exc)})

    snap = svc.write_catalog_snapshot(actor="sync-script", reason="sync-local-to-neon")
    print("SNAPSHOT", snap.get("schema_count"), "schemas,", snap.get("table_count"), "tables")
    print("DONE", len([r for r in results if r.get("ok")]), "/", len(results))


if __name__ == "__main__":
    main()
