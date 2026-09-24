"""API de sugestões e reclamações do agente InfraGeo."""

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, require_admin_user
from app.config import get_settings
from app.core.exceptions import WebGISException
from app.services import feedback_service
from app.services.auth_service import AuthPrincipal
from app.utils.file_utils import unique_filename
from pathlib import Path

router = APIRouter()


class FeedbackIn(BaseModel):
    kind: str = Field(default="sugestao")
    message: str = Field(min_length=1, max_length=2000)
    layer: str = ""
    layer_id: str = ""
    keyword: str = ""
    place: str = ""
    lat: float | None = None
    lng: float | None = None
    bbox: str = ""
    photo_url: str = ""


class FeedbackStatusIn(BaseModel):
    status: str


@router.get("")
def list_feedback(_admin: AuthPrincipal = Depends(require_admin_user)) -> dict:
    items = feedback_service.list_items()
    novas = sum(1 for i in items if i.get("status") == "nova")
    return {"items": items, "count": len(items), "novas": novas}


@router.post("")
def create_feedback(
    body: FeedbackIn,
    user: AuthPrincipal = Depends(get_current_user),
) -> dict:
    try:
        item = feedback_service.add_item(
            kind=body.kind,
            message=body.message,
            author=user.full_name or user.username or "Usuário",
            email=user.email or "",
            layer=body.layer,
            layer_id=body.layer_id,
            keyword=body.keyword,
            place=body.place,
            lat=body.lat,
            lng=body.lng,
            bbox=body.bbox,
            photo_url=body.photo_url,
        )
    except ValueError as exc:
        raise WebGISException(str(exc), status_code=400) from exc
    return item


@router.post("/photo")
async def upload_photo(
    file: UploadFile = File(...),
    _user: AuthPrincipal = Depends(get_current_user),
) -> dict:
    name = file.filename or "foto.jpg"
    ext = Path(name).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise WebGISException("Envie uma imagem (jpg, png, webp ou gif).", status_code=400)
    settings = get_settings()
    folder = Path(settings.upload_dir) / "feedback"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / unique_filename(name)
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise WebGISException("A foto deve ter no máximo 8 MB.", status_code=400)
    dest.write_bytes(content)
    return {"url": f"/uploads/feedback/{dest.name}"}


@router.patch("/{item_id}")
def patch_feedback(
    item_id: str,
    body: FeedbackStatusIn,
    _admin: AuthPrincipal = Depends(require_admin_user),
) -> dict:
    try:
        item = feedback_service.update_status(item_id, body.status)
    except ValueError as exc:
        raise WebGISException(str(exc), status_code=400) from exc
    if not item:
        raise WebGISException("Registro não encontrado", status_code=404)
    return item
