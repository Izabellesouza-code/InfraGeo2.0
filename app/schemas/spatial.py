"""Schemas de operações espaciais."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class BufferRequest(BaseModel):
    """Solicita buffer em torno de uma geometria."""

    geometry: dict[str, Any]
    distance_meters: float = Field(..., gt=0, description="Distância do buffer em metros")
    segments: int = Field(16, ge=4, le=64)
    dissolve: bool = False


class DistanceRequest(BaseModel):
    """Calcula distância entre duas geometrias."""

    geometry_a: dict[str, Any]
    geometry_b: dict[str, Any]
    unit: Literal["meters", "kilometers"] = "meters"


class IntersectRequest(BaseModel):
    """Verifica/interseção entre geometrias."""

    geometry_a: dict[str, Any]
    geometry_b: dict[str, Any]
    return_geometry: bool = True


class WithinRequest(BaseModel):
    """Verifica se A está contido em B."""

    geometry_a: dict[str, Any]
    geometry_b: dict[str, Any]


class BBoxRequest(BaseModel):
    """Consulta por bounding box [minx, miny, maxx, maxy]."""

    bbox: list[float] = Field(..., min_length=4, max_length=4)
    layer_id: Optional[int] = None
    crs: str = "EPSG:4326"


class SpatialResult(BaseModel):
    """Resultado genérico de análise espacial."""

    operation: str
    success: bool = True
    value: Optional[float] = None
    unit: Optional[str] = None
    geometry: Optional[dict[str, Any]] = None
    message: Optional[str] = None
    details: Optional[dict[str, Any]] = None
