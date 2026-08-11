"""Testes de configuração e schemas."""

from app.config import Settings
from app.schemas.layer import LayerCreate


def test_settings_defaults():
    s = Settings(database_url="postgresql+psycopg2://u:p@localhost/db")
    assert s.app_name
    assert s.default_crs == "EPSG:4326"
    assert s.max_upload_bytes > 0


def test_layer_create_schema():
    layer = LayerCreate(
        name="rede_agua",
        title="Rede de Água",
        geometry_type="LineString",
    )
    assert layer.crs == "EPSG:4326"
    assert layer.is_visible is True
