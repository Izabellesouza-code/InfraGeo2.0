"""Utilitários de arquivo (upload/export)."""

import shutil
import uuid
from pathlib import Path
from typing import Iterable

from fastapi import UploadFile

from app.config import get_settings
from app.core.exceptions import UnsupportedFormatError, WebGISException

settings = get_settings()

ALLOWED_VECTOR_EXTENSIONS = {".geojson", ".json", ".zip", ".shp", ".gpkg", ".kml"}
ALLOWED_RASTER_EXTENSIONS = {".tif", ".tiff", ".geotiff"}


def ensure_directories() -> None:
    """Garante existência das pastas de upload e export."""
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.export_dir).mkdir(parents=True, exist_ok=True)


def unique_filename(original_name: str) -> str:
    """Gera nome único preservando extensão."""
    ext = Path(original_name).suffix.lower()
    return f"{uuid.uuid4().hex}{ext}"


def validate_extension(filename: str, allowed: Iterable[str] | None = None) -> str:
    """Valida extensão do arquivo e retorna a extensão."""
    ext = Path(filename).suffix.lower()
    allowed_set = set(allowed or (ALLOWED_VECTOR_EXTENSIONS | ALLOWED_RASTER_EXTENSIONS))
    if ext not in allowed_set:
        raise UnsupportedFormatError(ext or "(sem extensão)")
    return ext


async def save_upload(file: UploadFile, subfolder: str = "") -> Path:
    """Salva arquivo enviado no disco e retorna o caminho."""
    ensure_directories()
    if not file.filename:
        raise WebGISException("Nome de arquivo ausente", status_code=400)

    validate_extension(file.filename)

    target_dir = Path(settings.upload_dir) / subfolder
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / unique_filename(file.filename)

    size = 0
    with dest.open("wb") as buffer:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > settings.max_upload_bytes:
                buffer.close()
                dest.unlink(missing_ok=True)
                raise WebGISException(
                    f"Arquivo excede o limite de {settings.max_upload_size_mb} MB",
                    status_code=413,
                )
            buffer.write(chunk)

    await file.close()
    return dest


def export_path(filename: str) -> Path:
    """Retorna caminho absoluto em data/exports."""
    ensure_directories()
    return Path(settings.export_dir) / filename


def remove_path(path: Path) -> None:
    """Remove arquivo ou pasta com segurança."""
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink(missing_ok=True)
