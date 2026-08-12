"""Dependências compartilhadas das rotas."""

from collections.abc import Generator

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import WebGISException
from app.core.security import decode_access_token
from app.database import get_db
from app.models.user import User
from app.services import auth_service
from app.services.export_service import ExportService
from app.services.feature_service import FeatureService
from app.services.geocoding_service import GeocodingService
from app.services.layer_service import LayerService
from app.services.spatial_service import SpatialService

_bearer = HTTPBearer(auto_error=False)


def get_layer_service(db: Session = Depends(get_db)) -> LayerService:
    return LayerService(db)


def get_feature_service(db: Session = Depends(get_db)) -> FeatureService:
    return FeatureService(db)


def get_spatial_service() -> SpatialService:
    return SpatialService()


def get_geocoding_service() -> GeocodingService:
    return GeocodingService()


def get_export_service(db: Session = Depends(get_db)) -> ExportService:
    return ExportService(db)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Exige JWT válido de um usuário ativo no banco."""
    if not credentials or not credentials.credentials:
        raise WebGISException("Faça login para continuar", status_code=401)
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise WebGISException("Sessão inválida ou expirada", status_code=401)
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise WebGISException("Sessão inválida", status_code=401) from exc
    user = auth_service.get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise WebGISException("Usuário não autorizado", status_code=401)
    return user


def require_upload_user(user: User = Depends(get_current_user)) -> User:
    """Exige usuário ativo com permissão de upload no PostgreSQL."""
    if not auth_service.has_upload_permission(user):
        raise WebGISException(
            "Usuário sem permissão para upload de camadas",
            status_code=403,
        )
    return user
