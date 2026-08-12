"""Ponto de entrada FastAPI do InfraGeo WebGIS."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.routes import api_router
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.utils.file_utils import ensure_directories

settings = get_settings()

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup/shutdown: pastas de dados + usuários no banco (não bloqueia deploy)."""
    try:
        ensure_directories()
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] pastas: {exc}")

    try:
        from app.database import SessionLocal
        from app.services.auth_service import ensure_auth_ready

        db = SessionLocal()
        try:
            ensure_auth_ready(db)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        print(f"[auth] aviso ao preparar usuarios: {exc}")
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="API e interface WebGIS para geoprocessamento e visualização de mapas.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.include_router(api_router)


@app.exception_handler(WebGISException)
async def webgis_exception_handler(_request: Request, exc: WebGISException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "details": exc.details},
    )


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    """Interface principal do mapa (InfraGeo AM)."""
    return templates.TemplateResponse(
        request,
        "pages/mapa.html",
        {
            "app_name": settings.app_name,
            "center_lat": settings.default_map_center_lat,
            "center_lon": settings.default_map_center_lon,
            "zoom": settings.default_map_zoom,
        },
    )


def run() -> None:
    """Executa servidor Uvicorn (python -m app.main)."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    run()
