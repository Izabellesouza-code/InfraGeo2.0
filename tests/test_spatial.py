"""Testes unitários das operações espaciais (sem banco)."""

from app.gis.analysis import area_square_meters, buffer, distance_meters, intersects
from app.gis.geometry import geojson_to_shapely, shapely_to_geojson


def test_point_roundtrip():
    geo = {"type": "Point", "coordinates": [-47.93, -15.78]}
    geom = geojson_to_shapely(geo)
    assert geom.geom_type == "Point"
    back = shapely_to_geojson(geom)
    assert back["type"] == "Point"


def test_buffer_creates_polygon():
    point = {"type": "Point", "coordinates": [-47.93, -15.78]}
    result = buffer(point, distance_meters=1000)
    assert result["type"] in ("Polygon", "MultiPolygon")


def test_distance_positive():
    a = {"type": "Point", "coordinates": [-47.93, -15.78]}
    b = {"type": "Point", "coordinates": [-46.63, -23.55]}
    d = distance_meters(a, b)
    assert d > 0


def test_intersects_true():
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [-48.0, -16.0],
                [-47.0, -16.0],
                [-47.0, -15.0],
                [-48.0, -15.0],
                [-48.0, -16.0],
            ]
        ],
    }
    point = {"type": "Point", "coordinates": [-47.5, -15.5]}
    assert intersects(poly, point) is True


def test_area_positive():
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [-48.0, -16.0],
                [-47.0, -16.0],
                [-47.0, -15.0],
                [-48.0, -15.0],
                [-48.0, -16.0],
            ]
        ],
    }
    assert area_square_meters(poly) > 0
