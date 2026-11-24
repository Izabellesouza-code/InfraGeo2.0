"""Configurações centralizadas via variáveis de ambiente."""

from functools import lru_cache
from typing import List

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WEAK_JWT_SECRETS = frozenset(
    {
        "",
        "dev-secret-change-me",
        "altere-esta-chave-em-producao",
        "change-me",
        "secret",
        "jwt-secret",
        "your-secret-key",
    }
)


class Settings(BaseSettings):
    """Carrega e valida configurações do projeto."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "InfraGeo AM"
    app_version: str = "2.1"
    debug: bool = True
    secret_key: str = ""
    jwt_secret: str = Field(default="", validation_alias="JWT_SECRET")

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
    auth_allowed_email_domain: str = ""
    auth_allowed_extra_emails: str = ""

    # URL pública para links de redefinição de senha (ex.: http://127.0.0.1:8000)
    app_public_url: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    # Sync de schemas: origem local → Neon (nuvem). Se vazio, usa só DATABASE_URL.
    source_database_url: str = ""
    neon_database_url: str = ""
    schema_sync_auto_git: bool = False
    schema_sync_git_remote: str = "origin"
    schema_sync_git_branch: str = "main"
    schema_sync_protected: str = (
        "public,usuarios,topology,tiger,tiger_data,pg_catalog,information_schema,"
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

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    @model_validator(mode="after")
    def bind_jwt_secret(self):
        key = (self.jwt_secret or self.secret_key or "").strip()
        object.__setattr__(self, "secret_key", key)
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_extra_email_set(self) -> frozenset:
        return frozenset(
            e.strip().lower()
            for e in (self.auth_allowed_extra_emails or "").split(",")
            if e.strip()
        )

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


def require_jwt_secret(secret: str) -> str:
    """Exige SECRET_KEY ou JWT_SECRET forte — sem default de desenvolvimento."""
    key = (secret or "").strip()
    if key.lower() in _WEAK_JWT_SECRETS or len(key) < 32:
        raise RuntimeError(
            "SECRET_KEY ou JWT_SECRET obrigatória no ambiente: mínimo 32 caracteres, "
            "sem valores de desenvolvimento (ex.: dev-secret-change-me)."
        )
    return key


@lru_cache
def get_settings() -> Settings:
    """Retorna instância cacheada das configurações."""
    settings = Settings()
    key = (settings.secret_key or "").strip()
    if not key:
        raise RuntimeError(
            "SECRET_KEY ou JWT_SECRET obrigatória no ambiente (mínimo 32 caracteres)."
        )
    try:
        require_jwt_secret(key)
    except RuntimeError as exc:
        # Não derruba o processo: um SECRET_KEY antigo no Render ainda sobe a API.
        print(f"[config] aviso: {exc}")
    return settings
