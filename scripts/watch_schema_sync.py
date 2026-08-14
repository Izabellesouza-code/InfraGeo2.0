"""
Watcher: escuta CREATE/DROP SCHEMA na origem (Postgres local)
e sincroniza com o Neon.

Uso:
  1) Configure SOURCE_DATABASE_URL (local) e NEON_DATABASE_URL (nuvem)
  2) SCHEMA_SYNC_AUTO_GIT=true  (opcional — commit/push do snapshot)
  3) python scripts/watch_schema_sync.py

Na primeira execução instala event triggers e faz sync dos schemas faltantes.
DROP SCHEMA na origem NÃO apaga no Neon — só cria pedido de exclusão pendente.
"""

from __future__ import annotations

import json
import select
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.services.schema_sync_service import SchemaSyncService  # noqa: E402


def main() -> None:
    svc = SchemaSyncService()
    print("[sync] instalando event triggers na origem…")
    print(svc.ensure_event_triggers_on_source())

    print("[sync] espelhando schemas faltantes → Neon…")
    print(json.dumps(svc.sync_missing_from_source(actor="watcher"), indent=2, ensure_ascii=False))

    # LISTEN via conexão psycopg2 crua
    raw = svc.source_engine.raw_connection()
    try:
        raw.set_isolation_level(0)  # autocommit para LISTEN
    except Exception:
        pass
    cur = raw.cursor()
    cur.execute("LISTEN infrageo_schema_ddl")
    print("[sync] ouvindo canal infrageo_schema_ddl (Ctrl+C para sair)…")

    try:
        while True:
            if select.select([raw], [], [], 5.0) == ([], [], []):
                continue
            raw.poll()
            while raw.notifies:
                notify = raw.notifies.pop(0)
                try:
                    payload = json.loads(notify.payload)
                except Exception:
                    payload = {"raw": notify.payload}
                print("[sync] evento:", payload)
                result = svc.handle_source_event(payload, actor="watcher")
                print("[sync] resultado:", json.dumps(result, ensure_ascii=False, default=str)[:800])
            time.sleep(0.05)
    except KeyboardInterrupt:
        print("\n[sync] encerrado.")
    finally:
        try:
            cur.close()
            raw.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
