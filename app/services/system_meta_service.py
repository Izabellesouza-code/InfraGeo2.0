"""Metadados do sistema — última atualização (upload ou commit)."""

from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.database import engine as default_engine

logger = logging.getLogger("infrageo.system_meta")

META_KEY = "last_data_upload"
FILE_PATH = Path("data/last_data_update.json")
REPO_ROOT = Path(__file__).resolve().parents[2]


def _ensure_table(eng: Engine) -> None:
    with eng.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS public.infrageo_system_meta (
                  meta_key TEXT PRIMARY KEY,
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  source TEXT,
                  detail TEXT
                )
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE public.infrageo_system_meta
                ADD COLUMN IF NOT EXISTS detail TEXT
                """
            )
        )
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM pg_event_trigger
                    WHERE evtname = 'infrageo_touch_data_update'
                  ) THEN
                    DROP EVENT TRIGGER infrageo_touch_data_update;
                  END IF;
                END;
                $$;
                """
            )
        )


def ensure_meta_ready(eng: Engine | None = None) -> None:
    eng = eng or default_engine
    try:
        _ensure_table(eng)
    except Exception as exc:  # noqa: BLE001
        logger.warning("meta table: %s", exc)


def _write_file(when: datetime, *, name: str, source: str = "upload") -> None:
    try:
        FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FILE_PATH.write_text(
            json.dumps(
                {
                    "last_data_upload": when.astimezone(timezone.utc).isoformat(),
                    "source": source,
                    "name": name,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("meta file: %s", exc)


def _read_file() -> dict[str, Any] | None:
    try:
        if not FILE_PATH.exists():
            return None
        data = json.loads(FILE_PATH.read_text(encoding="utf-8"))
        raw = data.get("last_data_upload") or data.get("last_data_update")
        if not raw:
            return None
        src = (data.get("source") or "upload").lower()
        if src != "upload":
            return None
        ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return {"ts": ts, "source": "upload", "name": data.get("name") or ""}
    except Exception:  # noqa: BLE001
        return None


def touch_data_upload(
    name: str = "",
    *,
    engines: list[Engine] | None = None,
) -> datetime:
    """Registra data + nome da camada do último upload."""
    when = datetime.now(timezone.utc)
    label = (name or "").strip()[:120]
    targets = engines or [default_engine]
    for eng in targets:
        try:
            _ensure_table(eng)
            with eng.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO public.infrageo_system_meta
                          (meta_key, updated_at, source, detail)
                        VALUES (:k, :ts, 'upload', :d)
                        ON CONFLICT (meta_key) DO UPDATE
                          SET updated_at = EXCLUDED.updated_at,
                              source = 'upload',
                              detail = EXCLUDED.detail
                        """
                    ),
                    {"k": META_KEY, "ts": when, "d": label or None},
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("touch upload meta: %s", exc)
    _write_file(when, name=label, source="upload")
    return when


def touch_data_update(
    source: str = "upload",
    *,
    engines: list[Engine] | None = None,
    name: str = "",
) -> datetime | None:
    if (source or "").lower() != "upload":
        return None
    return touch_data_upload(name, engines=engines)


def _read_db(eng: Engine) -> dict[str, Any] | None:
    try:
        _ensure_table(eng)
        with eng.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT updated_at, source, detail
                    FROM public.infrageo_system_meta
                    WHERE meta_key IN ('last_data_upload', 'last_data_update')
                      AND lower(coalesce(source, 'upload')) = 'upload'
                    ORDER BY
                      CASE WHEN meta_key = 'last_data_upload' THEN 0 ELSE 1 END,
                      updated_at DESC
                    LIMIT 1
                    """
                ),
            ).first()
        if not row:
            return None
        ts = row[0]
        if ts is not None and getattr(ts, "tzinfo", None) is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return {"ts": ts, "source": row[1] or "upload", "name": (row[2] or "").strip()}
    except Exception as exc:  # noqa: BLE001
        logger.warning("read meta: %s", exc)
        return None


def _last_commit_ts() -> datetime | None:
    """Data do último commit git (sem expor link/mensagem)."""
    try:
        out = subprocess.run(
            [
                "git",
                "-C",
                str(REPO_ROOT),
                "log",
                "-1",
                "--format=%cI",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        return datetime.fromisoformat(out.stdout.strip().replace("Z", "+00:00"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("git log: %s", exc)
        return None


def get_last_data_update(
    *,
    extra_engines: list[Engine] | None = None,
) -> dict[str, Any]:
    """Data mais recente entre upload de dados e último commit (só dia)."""
    candidates: list[dict[str, Any]] = []

    for eng in [default_engine, *(extra_engines or [])]:
        row = _read_db(eng)
        if row and row.get("ts"):
            candidates.append({"ts": row["ts"], "source": "upload"})

    file_row = _read_file()
    if file_row and file_row.get("ts"):
        candidates.append({"ts": file_row["ts"], "source": "upload"})

    commit_ts = _last_commit_ts()
    if commit_ts is not None:
        candidates.append({"ts": commit_ts, "source": "commit"})

    if not candidates:
        return {
            "last_data_update": None,
            "last_data_update_display": "Nenhuma atualização registrada",
            "source": None,
        }

    best = max(candidates, key=lambda x: x["ts"])
    display = best["ts"].astimezone().strftime("%d/%m/%Y")

    return {
        "last_data_update": best["ts"].astimezone(timezone.utc).isoformat(),
        "last_data_update_display": display,
        "source": best.get("source"),
    }
