"""Testes de configuração e schemas."""

import pytest

from app.config import Settings, require_jwt_secret
from app.schemas.layer import LayerCreate


def test_settings_defaults():
    s = Settings(
        database_url="postgresql+psycopg2://u:p@localhost/db",
        auth_bootstrap_password="from-env-only",
        secret_key="test-secret-minimo-com-32-caracteres!!",
    )
    assert s.app_name
    assert s.default_crs == "EPSG:4326"
    assert s.max_upload_bytes > 0
    assert s.auth_bootstrap_password == "from-env-only"
    assert s.secret_key.startswith("test-secret")


def test_jwt_secret_rejects_dev_defaults():
    with pytest.raises(RuntimeError):
        require_jwt_secret("")
    with pytest.raises(RuntimeError):
        require_jwt_secret("dev-secret-change-me")
    with pytest.raises(RuntimeError):
        require_jwt_secret("curta")
    assert require_jwt_secret("a" * 32) == "a" * 32


def test_settings_no_hardcoded_bootstrap_password():
    s = Settings(_env_file=None)
    assert s.auth_bootstrap_password == ""
    assert s.database_url == ""


def test_layer_create_schema():
    layer = LayerCreate(
        name="rede_agua",
        title="Rede de Água",
        geometry_type="LineString",
    )
    assert layer.crs == "EPSG:4326"
    assert layer.is_visible is True
