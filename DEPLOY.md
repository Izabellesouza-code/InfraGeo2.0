# Deploy — InfraGeo 2.0

**Site (abrir no navegador):** Vercel  
**API (dados):** Render → `https://infrageo2-0.onrender.com`  
**Banco:** Neon / PostGIS

```
Navegador  →  Vercel (UI)  →  Render (FastAPI /api)  →  PostGIS
```

## Vercel (frontend) — use esta URL no dia a dia

1. [Vercel](https://vercel.com) → **Add New Project** → importe `InfraGeo2.0`
2. Confirme:
   - **Framework:** Other
   - **Install:** `pip install jinja2`
   - **Build:** `python scripts/build_frontend.py`
   - **Output:** `frontend/dist`
3. Variável (já no `vercel.json`; pode sobrescrever no painel):

| Variável | Valor |
|----------|-------|
| `INFRA_GEO_API_URL` | `https://infrageo2-0.onrender.com` |

4. Deploy → abra `https://….vercel.app` (este é o site)

## Render (só API)

Mantenha o Web Service com `DATABASE_URL` (Neon) e:

| Variável | Valor |
|----------|-------|
| `DEBUG` | `false` |
| `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app$` |
| `CORS_ORIGINS` | `https://seu-app.vercel.app` |
| `FRONTEND_URL` | `https://seu-app.vercel.app` (opcional: `/` no Render redireciona para a Vercel) |

Health: `https://infrageo2-0.onrender.com/api/health`

No plano free o Render **dorme**; a 1ª chamada após inatividade pode levar 30–60s.

## Local

```bash
python app.py
```

http://127.0.0.1:8000 (UI + API juntos; `INFRA_GEO_API_URL` vazio).
