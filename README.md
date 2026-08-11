# InfraGeo 2.0

WebGIS Amazonas — **FastAPI + PostGIS** (Render) e **Leaflet** (Vercel).

## Deploy rápido

Veja o guia completo: **[DEPLOY.md](./DEPLOY.md)**

| Serviço | Plataforma |
|---------|------------|
| API (`/api/*`) | [Render](https://render.com) — `Dockerfile` + `render.yaml` |
| Frontend | [Vercel](https://vercel.com) — `vercel.json` |
| Banco | PostGIS na nuvem (`DATABASE_URL`) |

## Desenvolvimento local

```bash
python -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r requirements.txt
docker compose up -d              # PostGIS local
# configure .env a partir de .env.example
python scripts/init_db.py
python app.py
```

Abra: http://127.0.0.1:8000  
Docs: http://127.0.0.1:8000/docs

## Estrutura

```
├── app/                 # API FastAPI
├── templates/ + static/ # UI (fonte do front Vercel)
├── scripts/build_frontend.py
├── Dockerfile           # Render
├── render.yaml
├── vercel.json
└── DEPLOY.md
```

## Endpoints principais

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/health` | Health check |
| GET | `/api/postgis/catalog` | Catálogo de camadas |
| GET | `/api/postgis/geojson` | GeoJSON da camada |
| POST | `/api/auth/login` | Login (upload) |

## Testes

```bash
pytest -q
```
