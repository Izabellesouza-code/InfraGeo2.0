"""Rotas CRUD de feições e consultas espaciais."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import get_feature_service
from app.schemas.feature import FeatureCreate, FeatureRead, FeatureUpdate
from app.services.feature_service import FeatureService

router = APIRouter()


@router.get("", response_model=list[FeatureRead])
def list_features(
    layer_id: int = Query(..., description="ID da camada"),
    service: FeatureService = Depends(get_feature_service),
) -> list[dict]:
    """Lista feições de uma camada."""
    features = service.list_by_layer(layer_id)
    return [service.to_read_dict(f) for f in features]


@router.post("", response_model=FeatureRead, status_code=status.HTTP_201_CREATED)
def create_feature(
    payload: FeatureCreate,
    service: FeatureService = Depends(get_feature_service),
) -> dict:
    """Cria feição geográfica."""
    feature = service.create_feature(payload)
    return service.to_read_dict(feature)


@router.get("/query/bbox")
def query_bbox(
    minx: float,
    miny: float,
    maxx: float,
    maxy: float,
    layer_id: Optional[int] = None,
    service: FeatureService = Depends(get_feature_service),
) -> dict[str, Any]:
    """Consulta feições por bounding box."""
    return service.query_by_bbox([minx, miny, maxx, maxy], layer_id=layer_id).model_dump()


@router.get("/{feature_id}", response_model=FeatureRead)
def get_feature(
    feature_id: int,
    service: FeatureService = Depends(get_feature_service),
) -> dict:
    """Detalha uma feição."""
    feature = service.get_feature(feature_id)
    return service.to_read_dict(feature)


@router.patch("/{feature_id}", response_model=FeatureRead)
def update_feature(
    feature_id: int,
    payload: FeatureUpdate,
    service: FeatureService = Depends(get_feature_service),
) -> dict:
    """Atualiza feição."""
    feature = service.update_feature(feature_id, payload)
    return service.to_read_dict(feature)


@router.delete("/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feature(
    feature_id: int,
    service: FeatureService = Depends(get_feature_service),
) -> None:
    """Remove feição."""
    service.delete_feature(feature_id)
