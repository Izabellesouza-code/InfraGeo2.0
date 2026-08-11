# Deploy — InfraGeo 2.0

Backend (**Render**) + Frontend (**Vercel**) + PostGIS na nuvem.

## Arquitetura

```
Navegador  →  Vercel (HTML/CSS/JS)  →  Render (FastAPI /api)  →  PostGIS
```

| Peça | Onde | Pasta / arquivo |
|------|------|-----------------|
| API | Render (Docker) | `app/`, `Dockerfile`, `render.yaml` |
| UI | Vercel | `templates/`, `static/`, `vercel.json`, `scripts/build_frontend.py` |
| Banco | Neon / Supabase / VPS com PostGIS | `DATABASE_URL` |

> O IP local (`192.168.x.x`) **não** funciona no Render. Use um PostGIS público.

---

## 1) Repositório GitHub `InfraGeo2.0`

Já preparado neste projeto. Se ainda não estiver no GitHub:

```bash
git init
git add .
git commit -m "InfraGeo 2.0 — API Render + front Vercel"
gh repo create InfraGeo2.0 --public --source=. --remote=origin --push
```

---

## 2) Backend no Render

1. [Render](https://dashboard.render.com) → **New** → **Blueprint** → selecione o repo `InfraGeo2.0`
   - Ou **Web Service** → Docker → root `Dockerfile`
2. Defina as variáveis (Dashboard → Environment):

| Variável | Exemplo |
|----------|---------|
| `DATABASE_URL` | `postgresql+psycopg2://user:pass@host:5432/infrageo` |
| `CORS_ORIGINS` | `https://seu-app.vercel.app` |
| `SECRET_KEY` | string longa aleatória |
| `AUTH_BOOTSTRAP_PASSWORD` | senha forte |
| `DEBUG` | `false` |

3. Deploy. Anote a URL, ex.: `https://infrageo-api.onrender.com`
4. Teste: `https://infrageo-api.onrender.com/api/health`

No plano free o serviço **dorme** após inatividade; a 1ª requisição pode demorar ~30–60s.

---

## 3) Frontend na Vercel

1. [Vercel](https://vercel.com) → **Add New Project** → importe `InfraGeo2.0`
2. Settings do projeto:
   - **Framework Preset:** Other
   - **Build Command:** `pip install jinja2 && python scripts/build_frontend.py`
   - **Output Directory:** `frontend/dist`
3. Environment Variables:

| Variável | Valor |
|----------|-------|
| `INFRA_GEO_API_URL` | `https://infrageo-api.onrender.com` (sem barra no final) |

4. Deploy. Anote a URL, ex.: `https://infrageo2.vercel.app`
5. Volte no Render e atualize `CORS_ORIGINS` com essa URL (além do regex `*.vercel.app` já suportado).

---

## 4) Banco PostGIS

Opções comuns:

- **Neon** / **Supabase** (habilite extensão `postgis`)
- **Render PostgreSQL** + `CREATE EXTENSION postgis;`
- VPS com Docker: `docker compose up -d` (arquivo deste repo)

Depois rode (apontando `DATABASE_URL` para o banco da nuvem):

```bash
python scripts/init_db.py
```

Importe/restaure as camadas SEPLAN se necessário.

---

## 5) Desenvolvimento local

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
docker compose up -d
# ajuste .env (DATABASE_URL local)
python scripts/init_db.py
python app.py
```

Abra http://127.0.0.1:8000 (API + UI juntas).

Gerar front estático (opcional):

```bash
set INFRA_GEO_API_URL=http://127.0.0.1:8000
python scripts/build_frontend.py
```

---

## Checklist rápido

- [ ] PostGIS na nuvem com extensão `postgis`
- [ ] Render com `DATABASE_URL` + health OK
- [ ] Vercel com `INFRA_GEO_API_URL` apontando para o Render
- [ ] `CORS_ORIGINS` inclui o domínio Vercel
- [ ] Login/upload testados no domínio de produção
