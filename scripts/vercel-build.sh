#!/usr/bin/env bash
# Build do front estático na Vercel (venv isolado — evita PEP 668).
set -euo pipefail

python3 -m venv .vercel_py
.vercel_py/bin/pip install --upgrade pip
.vercel_py/bin/pip install -r requirements-frontend.txt
.vercel_py/bin/python scripts/build_frontend.py
