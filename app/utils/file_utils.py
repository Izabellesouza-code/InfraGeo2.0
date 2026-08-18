"""Utilitários de arquivo (upload/export)."""

import shutil
import uuid
from pathlib import Path
from typing import Iterable

from fastapi import UploadFile

from app.config import get_settings
from app.core.exceptions import UnsupportedFormatError, WebGISException

settings = get_settings()

# Extensões aceitas no upload de camadas vetoriais
SHP_COMPONENT_EXTENSIONS = {
    ".shp",
    ".shx",
    ".dbf",
    ".prj",
    ".cpg",
    ".sbn",
    ".sbx",
}
GEOJSON_EXTENSIONS = {".geojson", ".json"}
UPLOAD_ALLOWED_EXTENSIONS = SHP_COMPONENT_EXTENSIONS | GEOJSON_EXTENSIONS | {".zip"}
# Dentro de um ZIP: componentes de SHP ou GeoJSON (os demais são ignorados)
ZIP_ALLOWED_EXTENSIONS = SHP_COMPONENT_EXTENSIONS | GEOJSON_EXTENSIONS

# Lixo comum do Windows / GIS — aceito no ZIP, mas filtrado (não usado)
ZIP_IGNORE_NAMES = {
    "desktop.ini",
    "thumbs.db",
    ".ds_store",
    "ehthumbs.db",
    "ehthumbs_vista.db",
}
ZIP_IGNORE_EXTENSIONS = {
    ".lock",
    ".xml",
    ".html",
    ".htm",
    ".txt",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".atx",
    ".ixs",
    ".mxs",
    ".qix",
    ".ain",
    ".aih",
    ".fbn",
    ".fbx",
    ".tin",
    ".tmp",
    ".bak",
    ".log",
}

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


def _zip_entry_basename(name: str) -> str | None:
    """Ignora pastas e __MACOSX; retorna só o nome do arquivo."""
    if not name or name.endswith("/"):
        return None
    normalized = name.replace("\\", "/")
    if normalized.startswith("__MACOSX/") or "/__MACOSX/" in normalized:
        return None
    base = Path(normalized).name
    if not base:
        return None
    return base


def _is_zip_noise(base: str) -> bool:
    """Arquivos de sistema/metadado: entram no ZIP, mas são barrados no processamento."""
    lower = base.lower()
    if lower in ZIP_IGNORE_NAMES or lower.startswith("~$"):
        return True
    # Ocultos tipo .DS_Store já cobertos; demais dotfiles
    if base.startswith("."):
        return True
    # Locks do ArcGIS: nome.shp.<id>.sr.lock
    if ".sr.lock" in lower or lower.endswith(".lock"):
        return True
    # Metadado .shp.xml etc.
    suffixes = Path(lower).suffixes
    if any(s in ZIP_IGNORE_EXTENSIONS for s in suffixes):
        return True
    if Path(lower).suffix in ZIP_IGNORE_EXTENSIONS:
        return True
    return False


def validate_vector_zip(zip_path: Path) -> str:
    """
    Garante que o ZIP contenha shapefile ou GeoJSON.
    Arquivos extras (desktop.ini, locks, xml…) são ignorados — não apaga o ZIP original.
    Retorna 'shapefile' ou 'geojson'.
    """
    import zipfile

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            entries: list[str] = []
            for info in zf.infolist():
                base = _zip_entry_basename(info.filename)
                if base is None:
                    continue
                # Bloqueia path traversal
                if ".." in Path(info.filename).parts:
                    raise WebGISException(
                        f"ZIP inválido (caminho suspeito): {info.filename}",
                        status_code=400,
                    )
                if _is_zip_noise(base):
                    continue
                ext = Path(base).suffix.lower()
                if ext not in ZIP_ALLOWED_EXTENSIONS:
                    # Outros extras: ignora (não rejeita o pacote inteiro)
                    continue
                entries.append(base)
    except zipfile.BadZipFile as exc:
        raise WebGISException("Arquivo ZIP inválido ou corrompido", status_code=400) from exc

    if not entries:
        raise WebGISException(
            "ZIP sem shapefile (.shp) ou GeoJSON — "
            "envie o pacote com os arquivos da camada.",
            status_code=400,
        )

    has_shp = any(Path(n).suffix.lower() == ".shp" for n in entries)
    has_geojson = any(Path(n).suffix.lower() in GEOJSON_EXTENSIONS for n in entries)

    if has_shp:
        return "shapefile"
    if has_geojson:
        return "geojson"

    raise WebGISException(
        "O ZIP não contém .shp nem .geojson/.json. "
        "Envie um pacote shapefile ou um arquivo GeoJSON.",
        status_code=400,
    )


def extract_vector_zip(zip_path: Path, dest: Path) -> None:
    """
    Extrai só componentes SHP/GeoJSON para dest.
    Ignora desktop.ini, locks, xml etc. Sem alterar o ZIP original do usuário.
    """
    import zipfile

    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if ".." in Path(info.filename).parts:
                continue
            base = _zip_entry_basename(info.filename)
            if base is None or _is_zip_noise(base):
                continue
            if Path(base).suffix.lower() not in ZIP_ALLOWED_EXTENSIONS:
                continue
            # Evita paths aninhados perigosos: grava só o basename
            target = dest / base
            with zf.open(info, "r") as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)


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
