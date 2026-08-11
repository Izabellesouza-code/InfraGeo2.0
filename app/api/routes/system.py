"""Endpoints de saúde e metadados do sistema."""

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()
settings = get_settings()


@router.get("/health")
def health() -> dict:
    """Health check simples."""
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version}


@router.get("/info")
def info() -> dict:
    """Metadados da aplicação e defaults do mapa."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "default_crs": settings.default_crs,
        "map": {
            "center": [settings.default_map_center_lat, settings.default_map_center_lon],
            "zoom": settings.default_map_zoom,
        },
    }
