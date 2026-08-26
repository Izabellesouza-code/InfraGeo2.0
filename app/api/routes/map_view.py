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
                "id": "esri-light-gray",
                "name": "Esri Light Gray",
                "url": "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
                "attribution": "Tiles &copy; Esri",
                "maxZoom": 16,
                "default": True,
            },
            {
                "id": "esri-topo",
                "name": "Esri Topográfico",
                "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
                "attribution": "Tiles &copy; Esri",
                "maxZoom": 19,
            },
            {
                "id": "osm",
                "name": "OpenStreetMap",
                "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "attribution": "&copy; OpenStreetMap",
                "maxZoom": 19,
            },
            {
                "id": "google-earth",
                "name": "Google Earth",
                "url": "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
                "attribution": "&copy; Google",
                "maxZoom": 20,
                "subdomains": ["0", "1", "2", "3"],
            },
        ],
        "postgis": catalog,
        "groups": catalog.get("groups") or [],
    }
