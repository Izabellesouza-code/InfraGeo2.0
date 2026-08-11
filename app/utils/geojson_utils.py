"""Helpers para montagem e leitura de GeoJSON."""

from typing import Any, Optional

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry.base import BaseGeometry

from app.gis.geometry import geojson_to_shapely, shapely_to_geojson
from app.schemas.geojson import FeatureCollection, GeoJSONFeature


def wkb_element_from_geojson(geometry: dict[str, Any], srid: int = 4326):
    """Converte GeoJSON em elemento WKB para GeoAlchemy2."""
    geom = geojson_to_shapely(geometry)
    return from_shape(geom, srid=srid)


def geojson_from_wkb(wkb_element) -> dict[str, Any]:
    """Converte coluna Geometry (WKB) em GeoJSON dict."""
    geom: BaseGeometry = to_shape(wkb_element)
    return shapely_to_geojson(geom)


def feature_to_geojson(
    feature_id: int,
    geometry: dict[str, Any],
    properties: Optional[dict[str, Any]] = None,
    name: Optional[str] = None,
) -> GeoJSONFeature:
    """Monta Feature GeoJSON a partir de dados da feição."""
    props = dict(properties or {})
    if name is not None:
        props.setdefault("name", name)
    return GeoJSONFeature(id=feature_id, geometry=geometry, properties=props)


def build_feature_collection(
    features: list[GeoJSONFeature],
    metadata: Optional[dict[str, Any]] = None,
    bbox: Optional[list[float]] = None,
) -> FeatureCollection:
    """Monta FeatureCollection GeoJSON."""
    return FeatureCollection(
        features=features,
        metadata=metadata,
        bbox=bbox,
        crs={"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
    )
