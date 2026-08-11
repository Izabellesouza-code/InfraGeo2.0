"""Estilos padrão para renderização de camadas no mapa."""

from typing import Any


DEFAULT_STYLES: dict[str, dict[str, Any]] = {
    "Point": {
        "radius": 7,
        "fillColor": "#2563eb",
        "color": "#1e3a8a",
        "weight": 2,
        "opacity": 1,
        "fillOpacity": 0.75,
    },
    "LineString": {
        "color": "#dc2626",
        "weight": 3,
        "opacity": 0.9,
    },
    "Polygon": {
        "fillColor": "#16a34a",
        "color": "#14532d",
        "weight": 2,
        "opacity": 0.9,
        "fillOpacity": 0.35,
    },
    "MultiPolygon": {
        "fillColor": "#16a34a",
        "color": "#14532d",
        "weight": 2,
        "opacity": 0.9,
        "fillOpacity": 0.35,
    },
}


def get_default_style(geometry_type: str) -> dict[str, Any]:
    """Retorna estilo padrão conforme tipo de geometria."""
    return dict(DEFAULT_STYLES.get(geometry_type, DEFAULT_STYLES["Polygon"]))


def merge_style(geometry_type: str, custom: dict[str, Any] | None) -> dict[str, Any]:
    """Mescla estilo customizado sobre o padrão."""
    base = get_default_style(geometry_type)
    if custom:
        base.update(custom)
    return base


def style_for_leaflet(style: dict[str, Any]) -> dict[str, Any]:
    """Garante chaves compatíveis com path options do Leaflet."""
    allowed = {
        "stroke",
        "color",
        "weight",
        "opacity",
        "lineCap",
        "lineJoin",
        "dashArray",
        "dashOffset",
        "fill",
        "fillColor",
        "fillOpacity",
        "fillRule",
        "radius",
    }
    return {k: v for k, v in style.items() if k in allowed}
