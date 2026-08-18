"""
Espelha no Postgres local os schemas que só existem no Neon
(ex.: camadas enviadas pelo upload do WebGIS).

Uso (no seu PC, na mesma rede do Postgres local):
  1) No .env:
       DATABASE_URL=...neon...          (ou NEON_DATABASE_URL)
       SOURCE_DATABASE_URL=...local...  (Postgres do pgAdmin)
  2) pg_dump e pg_restore no PATH (instalação do PostgreSQL)
  3) python scripts/sync_neon_to_local.py
     python scripts/sync_neon_to_local.py USINA_BR319   # só um schema
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from app.config import get_settings  # noqa: E402
from app.services.schema_sync_service import SchemaSyncService  # noqa: E402


def main() -> int:
    get_settings.cache_clear()
    svc = SchemaSyncService()
    if not svc.can_mirror_to_source():
        print(
            "Configure SOURCE_DATABASE_URL (Postgres local) e "
            "NEON_DATABASE_URL ou DATABASE_URL (Neon), diferentes entre si."
        )
        return 1

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        results = []
        for name in args:
            print(f"[sync] espelhando {name} Neon -> local...")
            results.append(svc.mirror_schema_to_source(name, actor="cli"))
        print(json.dumps({"ok": True, "mirrored": results}, indent=2, ensure_ascii=False))
        return 0 if all(r.get("ok") for r in results) else 2

    print("[sync] schemas so no Neon -> Postgres local...")
    out = svc.sync_missing_from_neon(actor="cli")
    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
    return 0 if out.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
