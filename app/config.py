"""Configurações centralizadas via variáveis de ambiente."""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Carrega e valida configurações do projeto."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "InfraGeo AM"
    app_version: str = "2.0.0"
    debug: bool = True
    secret_key: str = "altere-esta-chave-em-producao"

    host: str = "0.0.0.0"
    port: int = 8000

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/infrageo"

    default_crs: str = "EPSG:4326"
    default_map_center_lat: float = -3.4653
    default_map_center_lon: float = -62.2159
    default_map_zoom: int = 5

    postgis_simplify_tolerance: float = 0.0
    postgis_geojson_limit: int = 0

    max_upload_size_mb: int = 50
    upload_dir: str = "data/uploads"
    export_dir: str = "data/exports"

    auth_bootstrap_username: str = "admin"
    auth_bootstrap_password: str = "InfraGeo@2026"
    auth_bootstrap_email: str = "admin@infrageo.local"

    cors_origins: str = (
        "http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )
    # Previews e deploys Vercel (*.vercel.app)
    cors_origin_regex: str = r"https://.*\.vercel\.app$"
    # URL do front na Vercel (produção). Se definida e DEBUG=false, / redireciona para lá.
    frontend_url: str = ""

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Retorna instância cacheada das configurações."""
    return Settings()
