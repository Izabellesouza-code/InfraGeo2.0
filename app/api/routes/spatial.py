"""Rotas de análise espacial."""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import get_spatial_service
from app.schemas.spatial import (
    BufferRequest,
    DistanceRequest,
    IntersectRequest,
    SpatialResult,
    WithinRequest,
)
from app.services.spatial_service import SpatialService

router = APIRouter()


@router.post("/buffer", response_model=SpatialResult)
def buffer(
    payload: BufferRequest,
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Gera buffer em metros."""
    return service.buffer(payload)


@router.post("/distance", response_model=SpatialResult)
def distance(
    payload: DistanceRequest,
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Calcula distância entre geometrias."""
    return service.distance(payload)


@router.post("/intersect", response_model=SpatialResult)
def intersect(
    payload: IntersectRequest,
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Calcula interseção."""
    return service.intersect(payload)


@router.post("/within", response_model=SpatialResult)
def within(
    payload: WithinRequest,
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Verifica contenção (A within B)."""
    return service.within(payload)


@router.post("/area", response_model=SpatialResult)
def area(
    geometry: dict[str, Any],
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Calcula área em m²."""
    return service.area(geometry)


@router.post("/length", response_model=SpatialResult)
def length(
    geometry: dict[str, Any],
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Calcula comprimento/perímetro em metros."""
    return service.length(geometry)


@router.post("/simplify", response_model=SpatialResult)
def simplify(
    geometry: dict[str, Any],
    tolerance: float = 0.0001,
    service: SpatialService = Depends(get_spatial_service),
) -> SpatialResult:
    """Simplifica geometria."""
    return service.simplify(geometry, tolerance=tolerance)
