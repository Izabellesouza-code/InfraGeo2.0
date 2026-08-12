#!/usr/bin/env bash
# Start script for Render (Python native or Docker)
set -e
echo "InfraGeo starting on PORT=${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
