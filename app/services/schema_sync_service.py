"""
Sincronização de schemas PostGIS: origem (local) → Neon (nuvem).

Fluxo:
  CREATE SCHEMA na origem  → cria/espelha no Neon + snapshot + git (opcional)
  DROP SCHEMA na origem    → NÃO apaga no Neon automaticamente;
                             registra exclusão pendente (confirmação admin)
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config import get_settings
from app.core.exceptions import WebGISException
from app.database import engine as default_engine

logger = logging.getLogger("infrageo.schema_sync")
settings = get_settings()

SYSTEM_SCHEMAS = {
    "pg_catalog",
    "information_schema",
    "pg_toast",
    "pg_temp_1",
    "pg_toast_temp_1",
}

SNAPSHOT_PATH = Path("data/catalog_snapshot.json")
PENDING_DELETE_PATH = Path("data/pending_schema_deletes.json")
REPO_ROOT = Path(__file__).resolve().parents[2]


def _sa_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return u
    if u.startswith("postgres://"):
        return "postgresql+psycopg2://" + u[len("postgres://") :]
    if u.startswith("postgresql://") and "+psycopg2" not in u:
        return "postgresql+psycopg2://" + u[len("postgresql://") :]
    return u


def _dsn_for_cli(sa_url: str) -> str:
    """Converte SQLAlchemy URL → DSN libpq (para pg_dump/pg_restore)."""
    return sa_url.replace("postgresql+psycopg2://", "postgresql://", 1)


def _safe_ident(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", (name or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned:
        raise WebGISException("Nome de schema inválido", status_code=400)
    if cleaned[0].isdigit():
        cleaned = f"s_{cleaned}"
    return cleaned[:63]


class SchemaSyncService:
    """Espelha schemas da origem para o Neon com exclusão protegida."""

    def __init__(self) -> None:
        self.source_url = _sa_url(
            settings.source_database_url or settings.database_url
        )
        self.neon_url = _sa_url(
            settings.neon_database_url or settings.database_url
        )
        self.source_engine: Engine = create_engine(
            self.source_url, pool_pre_ping=True, pool_size=2, max_overflow=0
        )
        self.neon_engine: Engine = (
            default_engine
            if self.neon_url == _sa_url(settings.database_url)
            else create_engine(
                self.neon_url, pool_pre_ping=True, pool_size=2, max_overflow=0
            )
        )

    def protected_schemas(self) -> set[str]:
        extra = {
            s.strip()
            for s in (settings.schema_sync_protected or "").split(",")
            if s.strip()
        }
        return {s.lower() for s in SYSTEM_SCHEMAS | extra}

    def is_protected(self, schema: str) -> bool:
        return schema.lower() in self.protected_schemas()

    def list_schemas(self, which: str = "neon") -> list[str]:
        eng = self.neon_engine if which == "neon" else self.source_engine
        sql = text(
            """
            SELECT nspname
            FROM pg_namespace
            WHERE nspname NOT LIKE 'pg_%'
              AND nspname <> 'information_schema'
              AND lower(nspname) <> 'public'
            ORDER BY 1
            """
        )
        with eng.connect() as conn:
            rows = conn.execute(sql).fetchall()
        return [r[0] for r in rows]

    def diff(self) -> dict[str, Any]:
        source = set(self.list_schemas("source"))
        neon = set(self.list_schemas("neon"))
        protected = self.protected_schemas()
        return {
            "source_only": sorted(source - neon),
            "neon_only": sorted(neon - source),
            "both": sorted(source & neon),
            "protected": sorted(protected),
            "pending_deletes": self._load_pending(),
        }

    # ── create / sync ───────────────────────────────────────────────

    def ensure_event_triggers_on_source(self) -> dict[str, Any]:
        """Instala event triggers LISTEN/NOTIFY na origem (CREATE/DROP SCHEMA)."""
        ddl = """
        CREATE OR REPLACE FUNCTION public.infrageo_notify_schema_ddl()
        RETURNS event_trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          r RECORD;
          payload TEXT;
        BEGIN
          FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
            payload := json_build_object(
              'command_tag', r.command_tag,
              'object_type', r.object_type,
              'schema_name', r.schema_name,
              'object_identity', r.object_identity,
              'at', NOW()
            )::text;
            PERFORM pg_notify('infrageo_schema_ddl', payload);
          END LOOP;
        END;
        $$;

        DROP EVENT TRIGGER IF EXISTS infrageo_schema_ddl_trigger;
        CREATE EVENT TRIGGER infrageo_schema_ddl_trigger
          ON ddl_command_end
          WHEN TAG IN ('CREATE SCHEMA', 'DROP SCHEMA', 'CREATE TABLE', 'DROP TABLE')
          EXECUTE FUNCTION public.infrageo_notify_schema_ddl();
        """
        try:
            with self.source_engine.begin() as conn:
                conn.execute(text(ddl))
            return {"ok": True, "channel": "infrageo_schema_ddl"}
        except Exception as exc:  # noqa: BLE001
            # PG < 14 usa EXECUTE PROCEDURE
            ddl_legacy = ddl.replace(
                "EXECUTE FUNCTION public.infrageo_notify_schema_ddl()",
                "EXECUTE PROCEDURE public.infrageo_notify_schema_ddl()",
            )
            try:
                with self.source_engine.begin() as conn:
                    conn.execute(text(ddl_legacy))
                return {"ok": True, "channel": "infrageo_schema_ddl", "legacy": True}
            except Exception as exc2:  # noqa: BLE001
                raise WebGISException(
                    f"Falha ao instalar event trigger: {exc2}",
                    status_code=500,
                ) from exc2

    def create_schema_on_neon(
        self,
        schema: str,
        *,
        copy_data: bool = True,
        actor: str = "system",
        auto_git: bool | None = None,
    ) -> dict[str, Any]:
        schema = _safe_ident(schema)
        if schema.lower() == "public":
            raise WebGISException(
                "Schema public nunca é sincronizado/atualizado por este fluxo",
                status_code=400,
            )
        if self.is_protected(schema) and schema.lower() in SYSTEM_SCHEMAS:
            raise WebGISException(
                f"Schema de sistema não pode ser gerenciado: {schema}",
                status_code=400,
            )

        with self.neon_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))

        copied: list[str] = []
        dump_ok = False
        if copy_data:
            try:
                copied = self._mirror_schema_with_pg_dump(schema)
                dump_ok = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("pg_dump falhou (%s); schema criado vazio no Neon", exc)
                copied = []

        snapshot = self.write_catalog_snapshot(actor=actor, reason=f"create:{schema}")
        git_result = None
        do_git = settings.schema_sync_auto_git if auto_git is None else auto_git
        if do_git:
            git_result = self.git_publish(
                message=f"chore(sync): schema {schema} criado/atualizado no Neon"
            )

        return {
            "ok": True,
            "action": "create",
            "schema": schema,
            "copied_objects": copied,
            "dump_ok": dump_ok,
            "snapshot": snapshot,
            "git": git_result,
            "note": (
                "O site lê o catálogo ao vivo do Neon; "
                "bastou criar o schema na nuvem para aparecer após refresh."
            ),
        }

    def sync_missing_from_source(
        self, *, actor: str = "system", auto_git: bool | None = None
    ) -> dict[str, Any]:
        diff = self.diff()
        created = []
        for schema in diff["source_only"]:
            if schema.lower() == "public":
                continue
            if self.is_protected(schema) and schema.lower() in SYSTEM_SCHEMAS:
                continue
            created.append(
                self.create_schema_on_neon(
                    schema, copy_data=True, actor=actor, auto_git=False
                )
            )
        git_result = None
        do_git = settings.schema_sync_auto_git if auto_git is None else auto_git
        if created and do_git:
            git_result = self.git_publish(
                message=f"chore(sync): {len(created)} schema(s) espelhados no Neon"
            )
        return {
            "ok": True,
            "created": created,
            "diff": self.diff(),
            "git": git_result,
        }

    def _mirror_schema_with_pg_dump(self, schema: str) -> list[str]:
        pg_dump = shutil.which("pg_dump")
        pg_restore = shutil.which("pg_restore")
        if not pg_dump or not pg_restore:
            raise RuntimeError("pg_dump/pg_restore não encontrados no PATH")

        source_dsn = _dsn_for_cli(self.source_url)
        neon_dsn = _dsn_for_cli(self.neon_url)
        tmp = Path(tempfile.mkdtemp(prefix="infrageo_schema_"))
        dump_file = tmp / f"{schema}.dump"
        # Schemas em MAIÚSCULAS exigem aspas no -n do pg_dump
        schema_pattern = f'"{schema}"'
        try:
            dump = subprocess.run(
                [
                    pg_dump,
                    f"--dbname={source_dsn}",
                    "-n",
                    schema_pattern,
                    "-Fc",
                    "--no-owner",
                    "--no-acl",
                    "-f",
                    str(dump_file),
                ],
                capture_output=True,
                text=True,
            )
            if dump.returncode != 0:
                raise RuntimeError(dump.stderr or dump.stdout or "pg_dump falhou")
            if not dump_file.exists() or dump_file.stat().st_size == 0:
                raise RuntimeError("pg_dump gerou arquivo vazio")

            # drop objects inside schema on neon then restore (schema already exists)
            restore = subprocess.run(
                [
                    pg_restore,
                    f"--dbname={neon_dsn}",
                    "--no-owner",
                    "--no-acl",
                    "--clean",
                    "--if-exists",
                    str(dump_file),
                ],
                capture_output=True,
                text=True,
            )
            # returncode 1 = warnings (ex.: already exists) — aceitável
            if restore.returncode not in (0, 1):
                raise RuntimeError(restore.stderr or "pg_restore falhou")

            with self.source_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT tablename FROM pg_tables
                        WHERE schemaname = :s ORDER BY 1
                        """
                    ),
                    {"s": schema},
                ).fetchall()
            return [r[0] for r in rows]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ── delete (secure) ─────────────────────────────────────────────

    def request_delete(
        self, schema: str, *, actor: str, reason: str = ""
    ) -> dict[str, Any]:
        """Registra exclusão pendente — NÃO remove dados do Neon ainda."""
        schema = _safe_ident(schema)
        if self.is_protected(schema):
            raise WebGISException(
                f"Schema protegido — exclusão bloqueada: {schema}",
                status_code=403,
            )
        neon_schemas = {s.lower() for s in self.list_schemas("neon")}
        if schema.lower() not in neon_schemas:
            raise WebGISException(
                f"Schema não existe no Neon: {schema}", status_code=404
            )

        phrase = f"{settings.schema_sync_delete_phrase_prefix} {schema}"
        pending = self._load_pending()
        token = f"del-{schema.lower()}-{int(datetime.now(tz=timezone.utc).timestamp())}"
        entry = {
            "schema": schema,
            "token": token,
            "requested_by": actor,
            "reason": reason or "",
            "requested_at": datetime.now(tz=timezone.utc).isoformat(),
            "confirm_phrase": phrase,
            "status": "pending",
        }
        pending = [p for p in pending if p.get("schema", "").lower() != schema.lower()]
        pending.append(entry)
        self._save_pending(pending)
        return {
            "ok": True,
            "action": "delete_requested",
            "schema": schema,
            "token": token,
            "confirm_phrase": phrase,
            "instructions": (
                "Para confirmar a exclusão no Neon, chame "
                "DELETE /api/admin/schemas/{schema} com body "
                '{"confirm_phrase": "' + phrase + '", "confirm_token": "' + token + '"}'
            ),
        }

    def confirm_delete(
        self,
        schema: str,
        *,
        confirm_phrase: str,
        confirm_token: str,
        actor: str,
        auto_git: bool | None = None,
    ) -> dict[str, Any]:
        """Apaga schema no Neon só após frase + token corretos."""
        schema = _safe_ident(schema)
        if self.is_protected(schema):
            raise WebGISException(
                f"Schema protegido — exclusão bloqueada: {schema}",
                status_code=403,
            )

        expected = f"{settings.schema_sync_delete_phrase_prefix} {schema}"
        if (confirm_phrase or "").strip() != expected:
            raise WebGISException(
                f'Frase de confirmação inválida. Use exatamente: "{expected}"',
                status_code=400,
            )

        pending = self._load_pending()
        match = next(
            (
                p
                for p in pending
                if p.get("schema", "").lower() == schema.lower()
                and p.get("token") == confirm_token
                and p.get("status") == "pending"
            ),
            None,
        )
        if not match:
            raise WebGISException(
                "Token inválido ou exclusão não solicitada. "
                "Chame POST /api/admin/schemas/{schema}/delete-request primeiro.",
                status_code=400,
            )

        with self.neon_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))

        pending = [
            p
            for p in pending
            if not (
                p.get("schema", "").lower() == schema.lower()
                and p.get("token") == confirm_token
            )
        ]
        self._save_pending(pending)

        snapshot = self.write_catalog_snapshot(
            actor=actor, reason=f"delete:{schema}"
        )
        git_result = None
        do_git = settings.schema_sync_auto_git if auto_git is None else auto_git
        if do_git:
            git_result = self.git_publish(
                message=f"chore(sync): schema {schema} removido do Neon"
            )

        return {
            "ok": True,
            "action": "deleted",
            "schema": schema,
            "deleted_by": actor,
            "snapshot": snapshot,
            "git": git_result,
        }

    def cancel_delete(self, schema: str) -> dict[str, Any]:
        schema = _safe_ident(schema)
        pending = self._load_pending()
        before = len(pending)
        pending = [
            p for p in pending if p.get("schema", "").lower() != schema.lower()
        ]
        self._save_pending(pending)
        return {
            "ok": True,
            "action": "delete_cancelled",
            "schema": schema,
            "removed": before - len(pending),
        }

    def handle_source_event(self, payload: dict[str, Any], *, actor: str = "watcher") -> dict[str, Any]:
        """Processa NOTIFY da origem: CREATE auto; DROP só agenda exclusão."""
        tag = str(payload.get("command_tag") or "").upper()
        identity = str(payload.get("object_identity") or "")
        schema_name = payload.get("schema_name")
        # object_identity para schema costuma ser "schema_name"
        if not schema_name and identity:
            schema_name = identity.strip().strip('"')

        if not schema_name:
            return {"ok": False, "reason": "schema_name ausente", "payload": payload}

        schema_name = _safe_ident(str(schema_name))
        if self.is_protected(schema_name):
            return {"ok": True, "skipped": True, "schema": schema_name, "reason": "protected"}

        if "CREATE SCHEMA" in tag:
            return self.create_schema_on_neon(
                schema_name, copy_data=True, actor=actor
            )
        if "DROP SCHEMA" in tag:
            # Segurança: nunca DROP automático no Neon
            return self.request_delete(
                schema_name,
                actor=actor,
                reason="DROP SCHEMA detectado na origem — aguarda confirmação admin",
            )
        if "CREATE TABLE" in tag or "DROP TABLE" in tag:
            # Re-espelha o schema inteiro (estrutura/dados)
            return self.create_schema_on_neon(
                schema_name, copy_data=True, actor=actor
            )
        return {"ok": True, "ignored": True, "payload": payload}

    # ── snapshot + git ──────────────────────────────────────────────

    def write_catalog_snapshot(
        self, *, actor: str = "system", reason: str = ""
    ) -> dict[str, Any]:
        schemas = self.list_schemas("neon")
        tables: list[dict[str, str]] = []
        with self.neon_engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT f_table_schema, f_table_name, type
                    FROM geometry_columns
                    WHERE f_table_schema NOT IN ('topology', 'public')
                    ORDER BY 1, 2
                    """
                )
            ).fetchall()
            tables = [
                {"schema": r[0], "table": r[1], "geom_type": r[2]} for r in rows
            ]

        payload = {
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
            "updated_by": actor,
            "reason": reason,
            "schemas": schemas,
            "geometry_tables": tables,
            "schema_count": len(schemas),
            "table_count": len(tables),
        }
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return payload

    def git_publish(self, message: str) -> dict[str, Any]:
        """Commita snapshot e faz push (se SCHEMA_SYNC_AUTO_GIT=true)."""
        if not shutil.which("git"):
            return {"ok": False, "error": "git não encontrado"}

        env = os.environ.copy()
        # Não altera git config global; usa env só neste processo
        try:
            subprocess.run(
                ["git", "add", str(SNAPSHOT_PATH.as_posix())],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
                env=env,
            )
            status = subprocess.run(
                ["git", "status", "--porcelain", str(SNAPSHOT_PATH.as_posix())],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                env=env,
                check=False,
            )
            if not status.stdout.strip():
                return {"ok": True, "skipped": True, "reason": "sem mudanças"}

            author_env = {
                **env,
                "GIT_AUTHOR_NAME": env.get("GIT_AUTHOR_NAME", "InfraGeo Sync"),
                "GIT_AUTHOR_EMAIL": env.get(
                    "GIT_AUTHOR_EMAIL", "sync@infrageo.local"
                ),
                "GIT_COMMITTER_NAME": env.get(
                    "GIT_COMMITTER_NAME", "InfraGeo Sync"
                ),
                "GIT_COMMITTER_EMAIL": env.get(
                    "GIT_COMMITTER_EMAIL", "sync@infrageo.local"
                ),
            }
            subprocess.run(
                ["git", "commit", "-m", message],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
                env=author_env,
            )
            remote = settings.schema_sync_git_remote
            branch = settings.schema_sync_git_branch
            push = subprocess.run(
                ["git", "push", remote, f"HEAD:{branch}"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                env=author_env,
                check=False,
            )
            return {
                "ok": push.returncode == 0,
                "pushed": push.returncode == 0,
                "remote": remote,
                "branch": branch,
                "stderr": (push.stderr or "")[:500],
            }
        except subprocess.CalledProcessError as exc:
            return {
                "ok": False,
                "error": (exc.stderr or str(exc))[:500],
            }

    def _load_pending(self) -> list[dict[str, Any]]:
        if not PENDING_DELETE_PATH.exists():
            return []
        try:
            data = json.loads(PENDING_DELETE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:  # noqa: BLE001
            return []

    def _save_pending(self, items: list[dict[str, Any]]) -> None:
        PENDING_DELETE_PATH.parent.mkdir(parents=True, exist_ok=True)
        PENDING_DELETE_PATH.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
