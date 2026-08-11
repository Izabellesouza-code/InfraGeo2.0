"""Análises espaciais: buffer, distância, interseção, área, etc."""

from typing import Any

from shapely.ops import unary_union

from app.core.exceptions import SpatialOperationError
from app.gis.geometry import geojson_to_shapely, shapely_to_geojson
from app.gis.projection import from_metric, to_metric


def buffer(
    geometry: dict[str, Any],
    distance_meters: float,
    segments: int = 16,
) -> dict[str, Any]:
    """Gera buffer em metros ao redor da geometria."""
    if distance_meters <= 0:
        raise SpatialOperationError("Distância do buffer deve ser positiva")

    metric = to_metric(geometry)
    buffered = metric.buffer(distance_meters, quad_segs=segments)
    return from_metric(buffered)


def distance_meters(geometry_a: dict[str, Any], geometry_b: dict[str, Any]) -> float:
    """Distância mínima entre duas geometrias em metros."""
    a = to_metric(geometry_a)
    b = to_metric(geometry_b)
    return float(a.distance(b))


def intersects(geometry_a: dict[str, Any], geometry_b: dict[str, Any]) -> bool:
    """Verifica se duas geometrias se intersectam."""
    a = geojson_to_shapely(geometry_a)
    b = geojson_to_shapely(geometry_b)
    return bool(a.intersects(b))


def intersection_geometry(
    geometry_a: dict[str, Any],
    geometry_b: dict[str, Any],
) -> dict[str, Any] | None:
    """Retorna geometria da interseção ou None se vazia."""
    a = geojson_to_shapely(geometry_a)
    b = geojson_to_shapely(geometry_b)
    result = a.intersection(b)
    if result.is_empty:
        return None
    return shapely_to_geojson(result)


def within(geometry_a: dict[str, Any], geometry_b: dict[str, Any]) -> bool:
    """Verifica se A está contido em B."""
    a = geojson_to_shapely(geometry_a)
    b = geojson_to_shapely(geometry_b)
    return bool(a.within(b))


def contains(geometry_a: dict[str, Any], geometry_b: dict[str, Any]) -> bool:
    """Verifica se A contém B."""
    a = geojson_to_shapely(geometry_a)
    b = geojson_to_shapely(geometry_b)
    return bool(a.contains(b))


def area_square_meters(geometry: dict[str, Any]) -> float:
    """Área da geometria em m²."""
    metric = to_metric(geometry)
    return float(metric.area)


def length_meters(geometry: dict[str, Any]) -> float:
    """Comprimento (linhas) ou perímetro (polígonos) em metros."""
    metric = to_metric(geometry)
    return float(metric.length)


def dissolve(geometries: list[dict[str, Any]]) -> dict[str, Any]:
    """Une (dissolve) uma lista de geometrias."""
    if not geometries:
        raise SpatialOperationError("Lista de geometrias vazia")
    shapes = [geojson_to_shapely(g) for g in geometries]
    merged = unary_union(shapes)
    return shapely_to_geojson(merged)


def simplify(geometry: dict[str, Any], tolerance: float = 0.0001) -> dict[str, Any]:
    """Simplifica geometria (Douglas-Peucker)."""
    geom = geojson_to_shapely(geometry)
    simplified = geom.simplify(tolerance, preserve_topology=True)
    return shapely_to_geojson(simplified)
