# Dockerfile leve — API InfraGeo (fallback). Preferir runtime Python no Render.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-prod.txt .
RUN pip install --upgrade pip && pip install -r requirements-prod.txt

COPY app ./app
COPY templates ./templates
COPY static ./static
COPY app.py .
COPY data ./data

RUN mkdir -p data/uploads data/exports

ENV HOST=0.0.0.0 \
    PORT=8000 \
    DEBUG=false

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1'

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
