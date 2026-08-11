"""Schemas de feição geográfica."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class FeatureBase(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    properties: dict[str, Any] = Field(default_factory=dict)
    geometry: dict[str, Any] = Field(
        ...,
        description="Geometria GeoJSON (Point, LineString, Polygon, Multi*).",
        examples=[{"type": "Point", "coordinates": [-47.93, -15.78]}],
    )


class FeatureCreate(FeatureBase):
    """Payload para criar feição em uma camada."""

    layer_id: int


class FeatureUpdate(BaseModel):
    """Payload parcial para atualizar feição."""

    name: Optional[str] = Field(None, max_length=200)
    properties: Optional[dict[str, Any]] = None
    geometry: Optional[dict[str, Any]] = None


class FeatureRead(BaseModel):
    """Resposta de leitura de feição."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    layer_id: int
    name: Optional[str] = None
    properties: Optional[dict[str, Any]] = None
    geometry: dict[str, Any]
    created_at: datetime
    updated_at: datetime
