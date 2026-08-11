"""Projeções e transformações de CRS com PyProj."""

from typing import Any

from pyproj import CRS, Transformer
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform

from app.core.exceptions import SpatialOperationError
from app.gis.geometry import geojson_to_shapely, shapely_to_geojson


def parse_crs(crs_code: str) -> CRS:
    """Interpreta código CRS (ex.: EPSG:4326)."""
    try:
        return CRS.from_user_input(crs_code)
    except Exception as exc:  # noqa: BLE001
        raise SpatialOperationError(f"CRS inválido: {crs_code}") from exc


def build_transformer(from_crs: str, to_crs: str) -> Transformer:
    """Cria transformador entre dois CRS."""
    return Transformer.from_crs(
        parse_crs(from_crs),
        parse_crs(to_crs),
        always_xy=True,
    )


def reproject_geometry(
    geometry: dict[str, Any],
    from_crs: str,
    to_crs: str,
) -> dict[str, Any]:
    """Reprojeta geometria GeoJSON de um CRS para outro."""
    if from_crs == to_crs:
        return geometry

    geom = geojson_to_shapely(geometry)
    transformer = build_transformer(from_crs, to_crs)

    def _project(x: float, y: float, z: float | None = None):
        if z is None:
            return transformer.transform(x, y)
        nx, ny = transformer.transform(x, y)
        return nx, ny, z

    projected = shapely_transform(_project, geom)
    return shapely_to_geojson(projected)


def to_metric(geometry: dict[str, Any], from_crs: str = "EPSG:4326") -> Any:
    """
    Reprojeta para um CRS métrico aproximado (Web Mercator)
    para cálculos de área/distância/buffer.
    """
    geom = geojson_to_shapely(geometry)
    transformer = build_transformer(from_crs, "EPSG:3857")
    return shapely_transform(transformer.transform, geom)


def from_metric(geom_metric: Any, to_crs: str = "EPSG:4326") -> dict[str, Any]:
    """Converte geometria métrica (3857) de volta para o CRS de saída."""
    transformer = build_transformer("EPSG:3857", to_crs)
    geom = shapely_transform(transformer.transform, geom_metric)
    return shapely_to_geojson(geom)


def wgs84_point(lon: float, lat: float) -> dict[str, Any]:
    """Cria Point GeoJSON WGS84."""
    return {"type": "Point", "coordinates": [lon, lat]}


def validate_bbox(bbox: list[float]) -> tuple[float, float, float, float]:
    """Valida e normaliza bbox."""
    if len(bbox) != 4:
        raise SpatialOperationError("BBox deve ter 4 valores: minx, miny, maxx, maxy")
    minx, miny, maxx, maxy = bbox
    if minx >= maxx or miny >= maxy:
        raise SpatialOperationError("BBox inválido: min deve ser menor que max")
    return minx, miny, maxx, maxy
