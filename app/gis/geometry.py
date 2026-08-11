"""Validação e conversão de geometrias (Shapely + GeoJSON)."""

from typing import Any

from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity, make_valid

from app.core.exceptions import InvalidGeometryError

SUPPORTED_TYPES = {
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
}


def geojson_to_shapely(geometry: dict[str, Any]) -> BaseGeometry:
    """Converte dict GeoJSON em geometria Shapely."""
    if not isinstance(geometry, dict) or "type" not in geometry:
        raise InvalidGeometryError("Geometria deve ser um objeto GeoJSON com 'type'")

    geom_type = geometry.get("type")
    if geom_type not in SUPPORTED_TYPES:
        raise InvalidGeometryError(f"Tipo de geometria não suportado: {geom_type}")

    try:
        geom = shape(geometry)
    except Exception as exc:  # noqa: BLE001
        raise InvalidGeometryError(f"Falha ao parsear geometria: {exc}") from exc

    if geom.is_empty:
        raise InvalidGeometryError("Geometria vazia não é permitida")

    if not geom.is_valid:
        geom = make_valid(geom)
        if not geom.is_valid:
            raise InvalidGeometryError(f"Geometria inválida: {explain_validity(geom)}")

    return geom


def shapely_to_geojson(geom: BaseGeometry) -> dict[str, Any]:
    """Converte geometria Shapely em dict GeoJSON."""
    return mapping(geom)


def ensure_geometry_type(geom: BaseGeometry, expected: str) -> None:
    """Garante que a geometria corresponda ao tipo esperado da camada."""
    actual = geom.geom_type
    # Multi* aceita single do mesmo tipo base
    if expected.startswith("Multi") and actual == expected.replace("Multi", ""):
        return
    if actual != expected and expected != "Geometry":
        raise InvalidGeometryError(
            f"Tipo esperado '{expected}', recebido '{actual}'"
        )


def geometry_bbox(geom: BaseGeometry) -> list[float]:
    """Retorna bbox [minx, miny, maxx, maxy]."""
    return list(geom.bounds)


def geometry_centroid(geom: BaseGeometry) -> dict[str, Any]:
    """Retorna centroide em GeoJSON."""
    return shapely_to_geojson(geom.centroid)
