"""Rotas de geocoding / reverse geocoding."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_geocoding_service
from app.services.geocoding_service import GeocodingService

router = APIRouter()


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2, description="Endereço ou local"),
    limit: int = Query(5, ge=1, le=20),
    country_codes: str = "br",
    service: GeocodingService = Depends(get_geocoding_service),
) -> list[dict[str, Any]]:
    """Geocoding: texto → coordenadas."""
    return await service.geocode(q, limit=limit, country_codes=country_codes)


@router.get("/reverse")
async def reverse(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    zoom: int = Query(18, ge=0, le=18),
    service: GeocodingService = Depends(get_geocoding_service),
) -> Optional[dict[str, Any]]:
    """Reverse geocoding: coordenadas → endereço."""
    return await service.reverse(lat, lon, zoom=zoom)
