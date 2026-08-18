"""Rotas de descoberta e GeoJSON do inventário PostGIS."""

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.api.deps import require_upload_user
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.models.user import User
from app.services.postgis_service import PostGISService
from app.utils.file_utils import ensure_directories, unique_filename

router = APIRouter()
service = PostGISService()
settings = get_settings()


@router.get("/health")
def postgis_health() -> dict[str, Any]:
    """Testa conexão e lista schemas."""
    return service.health()


@router.get("/catalog")
def postgis_catalog() -> dict[str, Any]:
    """Catálogo de camadas agrupadas para a sidebar do mapa."""
    return service.catalog()


@router.get("/layers")
def list_layers() -> dict[str, Any]:
    """Lista crua de tabelas com geometria."""
    rows = service.list_geometry_tables()
    return {"count": len(rows), "layers": rows}


@router.get("/geojson")
def layer_geojson(
    schema: str = Query(..., min_length=1),
    table: str = Query(..., min_length=1),
    simplify: Optional[float] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=0),
) -> dict[str, Any]:
    """
    Retorna FeatureCollection GeoJSON de uma tabela PostGIS.
    Use query params para aceitar nomes com espaços/acentos.
    """
    return service.layer_geojson(schema, table, simplify=simplify, limit=limit)


@router.post("/upload")
async def upload_shapefile(
    files: list[UploadFile] = File(...),
    name: Optional[str] = Form(None),
    _user: User = Depends(require_upload_user),
) -> dict[str, Any]:
    """
    Recebe shapefile (.zip com .shp ou .shp+.shx+.dbf) ou GeoJSON
    (.geojson/.json ou .zip só com GeoJSON) e grava no PostGIS.
    ZIP com outros tipos de arquivo é rejeitado.
    """
    from app.utils.file_utils import UPLOAD_ALLOWED_EXTENSIONS

    if not files:
        raise WebGISException("Nenhum arquivo enviado", status_code=400)

    ensure_directories()
    upload_dir = Path(settings.upload_dir) / "shp" / unique_filename("batch.zip").replace(
        ".zip", ""
    )
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved: list[Path] = []
    total = 0
    try:
        for uf in files:
            if not uf.filename:
                continue
            ext = Path(uf.filename).suffix.lower()
            if ext not in UPLOAD_ALLOWED_EXTENSIONS:
                raise WebGISException(
                    f"Extensão não permitida: {ext or '(vazia)'}. "
                    "Use .zip (shapefile ou GeoJSON), .shp/.shx/.dbf ou .geojson.",
                    status_code=415,
                )
            # Mantém o nome original para o conjunto .shp/.shx/.dbf bater.
            safe_name = Path(uf.filename).name.replace("..", "_")
            dest = upload_dir / safe_name
            with dest.open("wb") as buffer:
                while True:
                    chunk = await uf.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > settings.max_upload_bytes:
                        raise WebGISException(
                            f"Arquivo excede o limite de {settings.max_upload_size_mb} MB",
                            status_code=413,
                        )
                    buffer.write(chunk)
            await uf.close()
            saved.append(dest)

        if not saved:
            raise WebGISException("Nenhum arquivo válido", status_code=400)

        result = service.import_shapefile(saved, table_name=name)
        # limpa pasta temporária do upload
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)
        return result
    except WebGISException:
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)
        raise WebGISException(f"Erro no upload: {exc}", status_code=500) from exc
