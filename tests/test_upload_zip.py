"""Testes de validação de ZIP de upload (SHP / GeoJSON)."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from app.core.exceptions import WebGISException
from app.utils.file_utils import validate_vector_zip


def _make_zip(path: Path, names: list[str], content: bytes = b"x") -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name in names:
            zf.writestr(name, content)
    return path


def test_zip_shapefile_ok(tmp_path: Path):
    z = _make_zip(
        tmp_path / "ok.zip",
        ["camada.shp", "camada.shx", "camada.dbf", "camada.prj"],
    )
    assert validate_vector_zip(z) == "shapefile"


def test_zip_geojson_ok(tmp_path: Path):
    z = _make_zip(tmp_path / "gj.zip", ["dados.geojson"])
    assert validate_vector_zip(z) == "geojson"


def test_zip_rejects_other_files(tmp_path: Path):
    z = _make_zip(tmp_path / "bad.zip", ["camada.shp", "foto.jpg"])
    with pytest.raises(WebGISException) as exc:
        validate_vector_zip(z)
    assert exc.value.status_code == 415


def test_zip_empty_of_vectors(tmp_path: Path):
    z = _make_zip(tmp_path / "only_prj.zip", ["camada.prj", "camada.dbf"])
    with pytest.raises(WebGISException) as exc:
        validate_vector_zip(z)
    assert exc.value.status_code == 400
