# Dockerfile — API InfraGeo 2.0 (Render)
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    GDAL_DATA=/usr/share/gdal \
    PROJ_LIB=/usr/share/proj

RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Build deps só na instalação; imagem final mais leve
COPY requirements-prod.txt .
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && pip install --upgrade pip \
    && pip install -r requirements-prod.txt \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

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

# Render define PORT dinamicamente — precisa de shell para expandir
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1'

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
