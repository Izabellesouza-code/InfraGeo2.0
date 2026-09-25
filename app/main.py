"""Ponto de entrada FastAPI do InfraGeo WebGIS."""

from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.deps import extract_access_token
from app.api.routes import api_router
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.core.security import decode_access_token
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
        from app.services.system_meta_service import ensure_meta_ready

        db = SessionLocal()
        try:
            ensure_auth_ready(db)
        finally:
            db.close()
        ensure_meta_ready()
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
_upload_dir = BASE_DIR / settings.upload_dir
_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_dir)), name="uploads")
app.include_router(api_router)


@app.exception_handler(WebGISException)
async def webgis_exception_handler(_request: Request, exc: WebGISException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "details": exc.details},
    )


def _current_principal(request: Request):
    token = extract_access_token(request)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    try:
        from app.database import SessionLocal
        from app.services.auth_service import principal_from_token

        db = SessionLocal()
        try:
            user = principal_from_token(payload, db)
            if user and user.is_active:
                return user
            return None
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        return None


def _is_logged_in(request: Request) -> bool:
    return _current_principal(request) is not None


def _is_admin(request: Request) -> bool:
    user = _current_principal(request)
    return bool(user and user.is_admin)


def _must_change_password(request: Request) -> bool:
    user = _current_principal(request)
    return bool(user and getattr(user, "must_change_password", False))


def _auth_page(request: Request, template: str):
    return templates.TemplateResponse(
        request,
        template,
        {
            "app_name": settings.app_name,
            "app_version": settings.app_version,
            "year": datetime.now().year,
        },
    )


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Tela de login (antes do splash / mapa)."""
    nxt = (request.query_params.get("next") or "").strip()
    if _is_logged_in(request):
        if _must_change_password(request):
            return RedirectResponse(url="/definir-senha", status_code=302)
        if nxt == "/admin":
            if _is_admin(request):
                return RedirectResponse(url="/admin", status_code=302)
            return _auth_page(request, "pages/login.html")
        return RedirectResponse(url="/", status_code=302)
    return _auth_page(request, "pages/login.html")


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    """Painel de administrador."""
    if not _is_logged_in(request):
        return RedirectResponse(url="/login?next=/admin", status_code=302)
    if _must_change_password(request):
        return RedirectResponse(url="/definir-senha", status_code=302)
    if not _is_admin(request):
        return RedirectResponse(url="/login?next=/admin", status_code=302)
    return _auth_page(request, "pages/admin.html")


@app.get("/definir-senha", response_class=HTMLResponse)
async def first_password_page(request: Request):
    """Primeiro acesso: o usuário define a senha permanente."""
    if not _is_logged_in(request):
        return RedirectResponse(url="/login", status_code=302)
    if not _must_change_password(request):
        return RedirectResponse(url="/", status_code=302)
    return _auth_page(request, "pages/change-password.html")


@app.get("/esqueci-senha", response_class=HTMLResponse)
async def forgot_password_page(request: Request):
    """Pedido de token de redefinição de senha."""
    return _auth_page(request, "pages/forgot-password.html")


@app.get("/redefinir-senha", response_class=HTMLResponse)
async def reset_password_page(request: Request):
    """Formulário para gravar a nova senha com o token do e-mail."""
    return _auth_page(request, "pages/reset-password.html")


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """UI local em DEBUG; em produção redireciona para a Vercel (FRONTEND_URL)."""
    frontend = (settings.frontend_url or "").strip().rstrip("/")
    if frontend and not settings.debug:
        return RedirectResponse(url=frontend, status_code=302)

    if not _is_logged_in(request):
        return RedirectResponse(url="/login", status_code=302)
    if _must_change_password(request):
        return RedirectResponse(url="/definir-senha", status_code=302)

    return templates.TemplateResponse(
        request,
        "pages/mapa.html",
        {
            "app_name": settings.app_name,
            "app_version": settings.app_version,
            "center_lat": settings.default_map_center_lat,
            "center_lon": settings.default_map_center_lon,
            "zoom": settings.default_map_zoom,
            "year": datetime.now().year,
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
