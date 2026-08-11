"""Schemas Pydantic de entrada/saída da API."""

from app.schemas.feature import FeatureCreate, FeatureRead, FeatureUpdate
from app.schemas.geojson import FeatureCollection, GeoJSONFeature
from app.schemas.layer import LayerCreate, LayerRead, LayerUpdate
from app.schemas.spatial import (
    BufferRequest,
    DistanceRequest,
    IntersectRequest,
    SpatialResult,
)

__all__ = [
    "LayerCreate",
    "LayerRead",
    "LayerUpdate",
    "FeatureCreate",
    "FeatureRead",
    "FeatureUpdate",
    "GeoJSONFeature",
    "FeatureCollection",
    "BufferRequest",
    "DistanceRequest",
    "IntersectRequest",
    "SpatialResult",
]
