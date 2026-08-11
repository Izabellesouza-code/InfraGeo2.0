"""Geocoding e reverse geocoding via Nominatim (OpenStreetMap)."""

from typing import Any, Optional

import httpx

from app.core.exceptions import WebGISException


NOMINATIM_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "InfraGeo-WebGIS/1.0 (contato@exemplo.local)"


class GeocodingService:
    """Busca coordenadas a partir de endereço e vice-versa."""

    def __init__(self, timeout: float = 15.0) -> None:
        self.timeout = timeout
        self.headers = {"User-Agent": USER_AGENT}

    async def geocode(
        self,
        query: str,
        limit: int = 5,
        country_codes: str = "br",
    ) -> list[dict[str, Any]]:
        """Converte texto de endereço em coordenadas."""
        if not query or not query.strip():
            raise WebGISException("Informe um endereço ou local para buscar", status_code=400)

        params = {
            "q": query,
            "format": "json",
            "addressdetails": 1,
            "limit": limit,
            "countrycodes": country_codes,
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            response = await client.get(f"{NOMINATIM_URL}/search", params=params)
            response.raise_for_status()
            data = response.json()

        return [
            {
                "display_name": item.get("display_name"),
                "lat": float(item["lat"]),
                "lon": float(item["lon"]),
                "bbox": item.get("boundingbox"),
                "type": item.get("type"),
                "importance": item.get("importance"),
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(item["lon"]), float(item["lat"])],
                },
            }
            for item in data
        ]

    async def reverse(
        self,
        lat: float,
        lon: float,
        zoom: int = 18,
    ) -> Optional[dict[str, Any]]:
        """Converte coordenadas em endereço."""
        params = {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": 1,
            "zoom": zoom,
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            response = await client.get(f"{NOMINATIM_URL}/reverse", params=params)
            response.raise_for_status()
            item = response.json()

        if not item or item.get("error"):
            return None

        return {
            "display_name": item.get("display_name"),
            "lat": float(item.get("lat", lat)),
            "lon": float(item.get("lon", lon)),
            "address": item.get("address"),
            "geometry": {
                "type": "Point",
                "coordinates": [float(item.get("lon", lon)), float(item.get("lat", lat))],
            },
        }
