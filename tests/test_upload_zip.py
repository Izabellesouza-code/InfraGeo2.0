"""Testes de validação de ZIP de upload (SHP / GeoJSON)."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from app.core.exceptions import WebGISException
from app.utils.file_utils import extract_vector_zip, validate_vector_zip


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


def test_zip_ignores_desktop_ini_and_locks(tmp_path: Path):
    z = _make_zip(
        tmp_path / "win.zip",
        [
            "camada.shp",
            "camada.shx",
            "camada.dbf",
            "camada.prj",
            "desktop.ini",
            "camada.shp.abc123.sr.lock",
            "camada.shp.xml",
            "Thumbs.db",
        ],
    )
    assert validate_vector_zip(z) == "shapefile"


def test_zip_ignores_unrelated_extras(tmp_path: Path):
    z = _make_zip(tmp_path / "extra.zip", ["camada.shp", "camada.dbf", "foto.jpg"])
    assert validate_vector_zip(z) == "shapefile"


def test_zip_empty_of_vectors(tmp_path: Path):
    z = _make_zip(tmp_path / "only_noise.zip", ["desktop.ini", "camada.prj", "camada.dbf"])
    with pytest.raises(WebGISException) as exc:
        validate_vector_zip(z)
    assert exc.value.status_code == 400


def test_extract_skips_noise(tmp_path: Path):
    z = _make_zip(
        tmp_path / "pack.zip",
        ["camada.shp", "camada.shx", "desktop.ini", "nota.txt"],
    )
    out = tmp_path / "out"
    extract_vector_zip(z, out)
    names = {p.name for p in out.iterdir()}
    assert names == {"camada.shp", "camada.shx"}
