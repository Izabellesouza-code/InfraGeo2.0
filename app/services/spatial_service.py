"""Fachada de análises espaciais para a API."""

from typing import Any

from app.gis import analysis
from app.schemas.spatial import (
    BufferRequest,
    DistanceRequest,
    IntersectRequest,
    SpatialResult,
    WithinRequest,
)


class SpatialService:
    """Encapsula operações espaciais puras em respostas padronizadas."""

    def buffer(self, request: BufferRequest) -> SpatialResult:
        geom = analysis.buffer(
            request.geometry,
            request.distance_meters,
            segments=request.segments,
        )
        return SpatialResult(
            operation="buffer",
            geometry=geom,
            value=request.distance_meters,
            unit="meters",
            message="Buffer gerado com sucesso",
        )

    def distance(self, request: DistanceRequest) -> SpatialResult:
        meters = analysis.distance_meters(request.geometry_a, request.geometry_b)
        value = meters / 1000.0 if request.unit == "kilometers" else meters
        return SpatialResult(
            operation="distance",
            value=round(value, 4),
            unit=request.unit,
            message="Distância calculada",
        )

    def intersect(self, request: IntersectRequest) -> SpatialResult:
        hits = analysis.intersects(request.geometry_a, request.geometry_b)
        geom = None
        if hits and request.return_geometry:
            geom = analysis.intersection_geometry(request.geometry_a, request.geometry_b)
        return SpatialResult(
            operation="intersect",
            success=True,
            geometry=geom,
            details={"intersects": hits},
            message="Interseção calculada",
        )

    def within(self, request: WithinRequest) -> SpatialResult:
        result = analysis.within(request.geometry_a, request.geometry_b)
        return SpatialResult(
            operation="within",
            details={"within": result},
            message="Relação de contenção avaliada",
        )

    def area(self, geometry: dict[str, Any]) -> SpatialResult:
        sqm = analysis.area_square_meters(geometry)
        return SpatialResult(
            operation="area",
            value=round(sqm, 4),
            unit="square_meters",
            details={"hectares": round(sqm / 10_000, 4)},
            message="Área calculada",
        )

    def length(self, geometry: dict[str, Any]) -> SpatialResult:
        meters = analysis.length_meters(geometry)
        return SpatialResult(
            operation="length",
            value=round(meters, 4),
            unit="meters",
            message="Comprimento/perímetro calculado",
        )

    def simplify(self, geometry: dict[str, Any], tolerance: float = 0.0001) -> SpatialResult:
        geom = analysis.simplify(geometry, tolerance=tolerance)
        return SpatialResult(
            operation="simplify",
            geometry=geom,
            details={"tolerance": tolerance},
            message="Geometria simplificada",
        )
