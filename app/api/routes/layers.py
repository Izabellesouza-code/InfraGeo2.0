"""Rotas CRUD de camadas e exportação GeoJSON."""

from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import get_export_service, get_feature_service, get_layer_service
from app.schemas.layer import LayerCreate, LayerRead, LayerUpdate
from app.services.export_service import ExportService
from app.services.feature_service import FeatureService
from app.services.layer_service import LayerService

router = APIRouter()


@router.get("", response_model=list[LayerRead])
def list_layers(
    only_visible: bool = False,
    service: LayerService = Depends(get_layer_service),
) -> list[dict]:
    """Lista todas as camadas cadastradas."""
    layers = service.list_layers(only_visible=only_visible)
    return [service.to_read_dict(layer) for layer in layers]


@router.post("", response_model=LayerRead, status_code=status.HTTP_201_CREATED)
def create_layer(
    payload: LayerCreate,
    service: LayerService = Depends(get_layer_service),
) -> dict:
    """Cria uma nova camada temática."""
    layer = service.create_layer(payload)
    return service.to_read_dict(layer)


@router.get("/{layer_id}", response_model=LayerRead)
def get_layer(
    layer_id: int,
    service: LayerService = Depends(get_layer_service),
) -> dict:
    """Detalha uma camada."""
    layer = service.get_layer(layer_id)
    return service.to_read_dict(layer)


@router.patch("/{layer_id}", response_model=LayerRead)
def update_layer(
    layer_id: int,
    payload: LayerUpdate,
    service: LayerService = Depends(get_layer_service),
) -> dict:
    """Atualiza metadados/estilo da camada."""
    layer = service.update_layer(layer_id, payload)
    return service.to_read_dict(layer)


@router.delete("/{layer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_layer(
    layer_id: int,
    service: LayerService = Depends(get_layer_service),
) -> None:
    """Remove camada e suas feições."""
    service.delete_layer(layer_id)


@router.get("/{layer_id}/geojson")
def layer_geojson(
    layer_id: int,
    service: FeatureService = Depends(get_feature_service),
) -> dict[str, Any]:
    """Retorna FeatureCollection GeoJSON da camada."""
    return service.layer_as_geojson(layer_id).model_dump()


@router.post("/{layer_id}/import")
async def import_geojson(
    layer_id: int,
    file: UploadFile = File(...),
    service: FeatureService = Depends(get_feature_service),
) -> dict[str, Any]:
    """Importa arquivo GeoJSON para a camada."""
    import json

    content = await file.read()
    data = json.loads(content.decode("utf-8"))
    count = service.import_geojson_features(layer_id, data)
    return {"imported": count, "layer_id": layer_id}


@router.get("/{layer_id}/export")
def export_layer(
    layer_id: int,
    fmt: str = "geojson",
    service: ExportService = Depends(get_export_service),
) -> FileResponse:
    """Exporta camada para arquivo (geojson|gpkg)."""
    path = service.export_layer(layer_id, fmt=fmt)  # type: ignore[arg-type]
    media = "application/geo+json" if fmt == "geojson" else "application/geopackage+sqlite3"
    return FileResponse(path, media_type=media, filename=path.name)
