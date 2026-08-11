"""Agrega todos os roteadores da API."""

from fastapi import APIRouter

from app.api.routes import auth, features, geocoding, layers, map_view, postgis, spatial, system

api_router = APIRouter(prefix="/api")

api_router.include_router(system.router, tags=["Sistema"])
api_router.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
api_router.include_router(layers.router, prefix="/layers", tags=["Camadas"])
api_router.include_router(features.router, prefix="/features", tags=["Feições"])
api_router.include_router(spatial.router, prefix="/spatial", tags=["Análise Espacial"])
api_router.include_router(geocoding.router, prefix="/geocoding", tags=["Geocoding"])
api_router.include_router(map_view.router, prefix="/map", tags=["Mapa"])
api_router.include_router(postgis.router, prefix="/postgis", tags=["PostGIS"])
