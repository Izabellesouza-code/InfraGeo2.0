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
    """Metadados da aplicação, mapa e última atualização de dados."""
    from app.services import system_meta_service

    extra = []
    try:
        from app.services.schema_sync_service import SchemaSyncService

        sync = SchemaSyncService()
        if sync.can_mirror_to_source():
            extra.append(sync.source_engine)
            system_meta_service.ensure_meta_ready(sync.source_engine)
        system_meta_service.ensure_meta_ready(sync.neon_engine)
    except Exception:  # noqa: BLE001
        pass

    system_meta_service.ensure_meta_ready()
    meta = system_meta_service.get_last_data_update(extra_engines=extra or None)
    # Remove campos internos se houver
    meta.pop("_dt", None)

    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "default_crs": settings.default_crs,
        "map": {
            "center": [settings.default_map_center_lat, settings.default_map_center_lon],
            "zoom": settings.default_map_zoom,
        },
        **meta,
    }
