"""Schemas de camada geográfica."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class LayerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, pattern=r"^[a-z0-9_]+$")
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    geometry_type: str = Field(..., examples=["Point", "LineString", "Polygon", "MultiPolygon"])
    crs: str = "EPSG:4326"
    style: Optional[dict[str, Any]] = None
    is_visible: bool = True
    is_public: bool = True
    source: Optional[str] = None


class LayerCreate(LayerBase):
    """Payload para criar camada."""


class LayerUpdate(BaseModel):
    """Payload parcial para atualizar camada."""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    style: Optional[dict[str, Any]] = None
    is_visible: Optional[bool] = None
    is_public: Optional[bool] = None
    source: Optional[str] = None


class LayerRead(LayerBase):
    """Resposta de leitura de camada."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    feature_count: Optional[int] = None
