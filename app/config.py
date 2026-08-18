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
    secret_key: str = ""

    host: str = "0.0.0.0"
    port: int = 8000

    # Obrigatório via DATABASE_URL no .env / Render
    database_url: str = ""

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
    # Obrigatório via AUTH_BOOTSTRAP_PASSWORD no .env (sem default no código)
    auth_bootstrap_password: str = ""
    auth_bootstrap_email: str = "admin@infrageo.local"

    # Sync de schemas: origem local → Neon (nuvem). Se vazio, usa só DATABASE_URL.
    source_database_url: str = ""
    neon_database_url: str = ""
    schema_sync_auto_git: bool = False
    schema_sync_git_remote: str = "origin"
    schema_sync_git_branch: str = "main"
    schema_sync_protected: str = (
        "public,topology,tiger,tiger_data,pg_catalog,information_schema,"
        "LIMITE_ESTADUAL,LIMITE_MUNICIPAL"
    )
    schema_sync_delete_phrase_prefix: str = "EXCLUIR"
    # Após upload no Neon, tenta espelhar no Postgres local (SOURCE_DATABASE_URL)
    upload_mirror_to_source: bool = True

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
