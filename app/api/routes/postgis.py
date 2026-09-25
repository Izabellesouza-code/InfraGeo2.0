"""Rotas de descoberta e GeoJSON do inventário PostGIS."""

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from app.api.deps import require_upload_user
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.services import audit_service
from app.services.auth_service import AuthPrincipal
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


@router.get("/upload-options")
def upload_options(_user: AuthPrincipal = Depends(require_upload_user)) -> dict[str, Any]:
    """Grupos da sidebar + camadas existentes para o modal de upload."""
    catalog = service.catalog()
    layers: list[dict[str, Any]] = []
    for group in catalog.get("groups") or []:
        for layer in group.get("layers") or []:
            layers.append(
                {
                    "id": layer.get("id"),
                    "name": layer.get("name"),
                    "schema": layer.get("schema"),
                    "table": layer.get("table"),
                    "group_id": group.get("id"),
                    "group_name": group.get("name"),
                }
            )
    layers.sort(key=lambda x: (x.get("group_name") or "", x.get("name") or ""))
    return {
        "ok": True,
        "groups": service.list_sidebar_groups(),
        "layers": layers,
    }


@router.post("/groups")
def create_group(
    request: Request,
    name: str = Form(...),
    user: AuthPrincipal = Depends(require_upload_user),
) -> dict[str, Any]:
    """Cria um grupo customizado na sidebar (sem redeploy)."""
    result = service.create_custom_group(name)
    audit_service.record(
        category="alteracao",
        action="grupo_criar",
        summary=f"Criou o grupo de camadas {name}",
        actor=user,
        target=name,
        request=request,
    )
    return result


@router.patch("/layers/meta")
def update_layer_meta(
    request: Request,
    layer_schema: str = Form(...),
    layer_table: str = Form(...),
    display_name: Optional[str] = Form(None),
    group_id: Optional[str] = Form(None),
    user: AuthPrincipal = Depends(require_upload_user),
) -> dict[str, Any]:
    """Renomeia (nome de exibição) e/ou move a camada de grupo."""
    result = service.update_layer_meta(
        layer_schema,
        layer_table,
        display_name=display_name,
        group_id=group_id,
    )
    label = display_name or f"{layer_schema}.{layer_table}"
    audit_service.record(
        category="alteracao",
        action="camada_renomear",
        summary=f"Alterou a camada {label}",
        actor=user,
        target=label,
        request=request,
    )
    return result


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
    request: Request,
    files: list[UploadFile] = File(...),
    name: Optional[str] = Form(None),
    display_name: Optional[str] = Form(None),
    destination: Optional[str] = Form("new"),
    target_schema: Optional[str] = Form(None),
    target_table: Optional[str] = Form(None),
    group_id: Optional[str] = Form(None),
    new_group_name: Optional[str] = Form(None),
    user: AuthPrincipal = Depends(require_upload_user),
) -> dict[str, Any]:
    """
    Recebe shapefile/GeoJSON e grava no PostGIS.
    destination=existing atualiza uma camada; destination=new cria no grupo.
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

        result = service.import_shapefile(
            saved,
            table_name=name,
            destination=destination or "new",
            target_schema=target_schema,
            target_table=target_table,
            group_id=group_id,
            display_name=display_name,
            new_group_name=new_group_name,
        )
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)

        label = (
            display_name
            or result.get("display_name")
            or result.get("name")
            or target_table
            or name
            or "camada"
        )
        dest_txt = "Atualizou" if (destination or "new") == "existing" else "Enviou"
        audit_service.record(
            category="alteracao",
            action="camada_upload",
            summary=f"{dest_txt} dados da camada {label}",
            actor=user,
            target=str(label),
            request=request,
        )

        try:
            from app.services.system_meta_service import touch_data_upload

            touch_engines = []
            try:
                from app.services.schema_sync_service import SchemaSyncService

                sync = SchemaSyncService()
                touch_engines.append(sync.neon_engine)
                if sync.can_mirror_to_source():
                    touch_engines.append(sync.source_engine)
            except Exception:  # noqa: BLE001
                pass
            touch_data_upload(
                result.get("name")
                or result.get("schema")
                or name
                or "",
                engines=touch_engines or None,
            )
        except Exception:  # noqa: BLE001
            pass

        if settings.upload_mirror_to_source and result.get("schema"):
            try:
                from app.services.schema_sync_service import SchemaSyncService

                sync = SchemaSyncService()
                result["mirror_local"] = sync.mirror_schema_to_source(
                    result["schema"],
                    actor=getattr(_user, "username", None) or "upload",
                )
            except Exception as exc:  # noqa: BLE001
                result["mirror_local"] = {
                    "ok": False,
                    "error": str(exc),
                    "note": (
                        "Upload no Neon OK. No PC local rode: "
                        "python scripts/sync_neon_to_local.py"
                    ),
                }
        return result
    except WebGISException:
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        import shutil

        shutil.rmtree(upload_dir, ignore_errors=True)
        raise WebGISException(f"Erro no upload: {exc}", status_code=500) from exc
