"""Exceções de domínio do WebGIS."""

from typing import Any, Optional


class WebGISException(Exception):
    """Exceção base da aplicação."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        details: Optional[Any] = None,
    ) -> None:
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class LayerNotFoundError(WebGISException):
    def __init__(self, layer_id: int) -> None:
        super().__init__(f"Camada {layer_id} não encontrada", status_code=404)


class FeatureNotFoundError(WebGISException):
    def __init__(self, feature_id: int) -> None:
        super().__init__(f"Feição {feature_id} não encontrada", status_code=404)


class InvalidGeometryError(WebGISException):
    def __init__(self, message: str = "Geometria inválida") -> None:
        super().__init__(message, status_code=422)


class UnsupportedFormatError(WebGISException):
    def __init__(self, fmt: str) -> None:
        super().__init__(f"Formato não suportado: {fmt}", status_code=415)


class SpatialOperationError(WebGISException):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)
