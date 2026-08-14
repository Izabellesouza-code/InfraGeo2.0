"""Copia um schema (case-sensitive) da origem para o Neon via pg_dump/pg_restore."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=True)

schema = sys.argv[1] if len(sys.argv) > 1 else "ZA_UC_ESTADUAL_ATUALIZADA"
src = os.getenv(
    "SOURCE_DATABASE_URL",
    "postgresql+psycopg2://postgres:Manaus%402026@192.168.0.102:5432/infrageo",
).replace("postgresql+psycopg2://", "postgresql://", 1)
neon = (
    os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL", "")
).replace("postgresql+psycopg2://", "postgresql://", 1)

# pg_dump exige aspas duplas no pattern para preservar maiúsculas
pattern = f'"{schema}"'
dump = Path(tempfile.gettempdir()) / f"{schema}.dump"

cmd_dump = [
    "pg_dump",
    f"--dbname={src}",
    "-n",
    pattern,
    "-Fc",
    "--no-owner",
    "--no-acl",
    "-f",
    str(dump),
]
print("dump:", cmd_dump[:4], "...")
r = subprocess.run(cmd_dump, capture_output=True, text=True)
print("dump_rc", r.returncode)
if r.stderr:
    print("dump_err", r.stderr[:1000])
print("size", dump.stat().st_size if dump.exists() else 0)
if r.returncode != 0 or not dump.exists() or dump.stat().st_size == 0:
    sys.exit(1)

cmd_restore = [
    "pg_restore",
    f"--dbname={neon}",
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    str(dump),
]
r2 = subprocess.run(cmd_restore, capture_output=True, text=True)
print("restore_rc", r2.returncode)
if r2.stderr:
    print("restore_err", r2.stderr[:1500])
sys.exit(0 if r2.returncode in (0, 1) else r2.returncode)  # 1 = warnings
