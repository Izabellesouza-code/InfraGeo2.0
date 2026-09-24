"""Dependências compartilhadas das rotas."""

from collections.abc import Generator

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import WebGISException
from app.core.security import decode_access_token
from app.database import get_db
from app.services import auth_service
from app.services.export_service import ExportService
from app.services.feature_service import FeatureService
from app.services.geocoding_service import GeocodingService
from app.services.layer_service import LayerService
from app.services.spatial_service import SpatialService

_bearer = HTTPBearer(auto_error=False)
SESSION_COOKIE = "infrageo_session"


def extract_access_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = None,
) -> str:
    if credentials and credentials.credentials:
        return credentials.credentials.strip()
    return (request.cookies.get(SESSION_COOKIE) or "").strip()


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
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> auth_service.AuthPrincipal:
    """Exige JWT válido (role Neon ou usuário da aplicação)."""
    token = extract_access_token(request, credentials)
    if not token:
        raise WebGISException("Faça login para continuar", status_code=401)
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        raise WebGISException("Sessão inválida ou expirada", status_code=401)
    user = auth_service.principal_from_token(payload, db)
    if not user or not user.is_active:
        raise WebGISException("Usuário não autorizado", status_code=401)
    return user


def require_upload_user(
    user: auth_service.AuthPrincipal = Depends(get_current_user),
) -> auth_service.AuthPrincipal:
    """Exige usuário ativo com permissão de upload no PostgreSQL."""
    if not auth_service.has_upload_permission(user):
        raise WebGISException(
            "Usuário sem permissão para upload de camadas",
            status_code=403,
        )
    return user


def require_admin_user(
    user: auth_service.AuthPrincipal = Depends(get_current_user),
) -> auth_service.AuthPrincipal:
    """Exige usuário administrador (is_admin)."""
    if not user or not user.is_active or not user.is_admin:
        raise WebGISException(
            "Apenas administradores podem executar esta ação",
            status_code=403,
        )
    return user
