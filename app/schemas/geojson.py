"""Schemas GeoJSON (RFC 7946)."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: Any


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: Optional[int | str] = None
    geometry: dict[str, Any]
    properties: dict[str, Any] = Field(default_factory=dict)


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoJSONFeature] = Field(default_factory=list)
    crs: Optional[dict[str, Any]] = None
    bbox: Optional[list[float]] = None
    metadata: Optional[dict[str, Any]] = None
