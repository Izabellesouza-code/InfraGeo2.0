"""Endpoints auxiliares do mapa (configuração para o frontend)."""

from fastapi import APIRouter

from app.config import get_settings
from app.services.postgis_service import PostGISService

router = APIRouter()
settings = get_settings()


@router.get("/config")
def map_config() -> dict:
    """Configuração inicial do mapa Leaflet + catálogo PostGIS."""
    catalog: dict = {"groups": [], "layer_count": 0, "ok": False}
    try:
        catalog = PostGISService().catalog()
    except Exception as exc:  # noqa: BLE001
        catalog = {"ok": False, "error": str(exc), "groups": [], "layer_count": 0}

    return {
        "center": [settings.default_map_center_lat, settings.default_map_center_lon],
        "zoom": settings.default_map_zoom,
        "crs": settings.default_crs,
        "basemaps": [
            {
                "id": "google-earth",
                "name": "Google Earth",
                "url": "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
                "attribution": "&copy; Google",
                "maxZoom": 20,
                "subdomains": ["0", "1", "2", "3"],
                "default": True,
            },
            {
                "id": "google-hybrid",
                "name": "Google Earth híbrido",
                "url": "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
                "attribution": "&copy; Google",
                "maxZoom": 20,
                "subdomains": ["0", "1", "2", "3"],
            },
            {
                "id": "carto-positron",
                "name": "Carto Positron",
                "url": "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
                "attribution": "&copy; OpenStreetMap &copy; CARTO",
                "maxZoom": 20,
                "subdomains": "abcd",
            },
        ],
        "postgis": catalog,
        "groups": catalog.get("groups") or [],
    }
