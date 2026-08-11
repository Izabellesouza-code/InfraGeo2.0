"""CRUD e consultas de camadas geográficas."""

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import LayerNotFoundError
from app.gis.styles import merge_style
from app.models.feature import Feature
from app.models.layer import Layer
from app.schemas.layer import LayerCreate, LayerUpdate


class LayerService:
    """Gerencia camadas temáticas do mapa."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_layers(self, only_visible: bool = False) -> list[Layer]:
        """Lista camadas, opcionalmente só as visíveis."""
        stmt = select(Layer).order_by(Layer.name)
        if only_visible:
            stmt = stmt.where(Layer.is_visible.is_(True))
        return list(self.db.scalars(stmt).all())

    def get_layer(self, layer_id: int) -> Layer:
        """Busca camada por ID ou levanta 404."""
        layer = self.db.get(Layer, layer_id)
        if not layer:
            raise LayerNotFoundError(layer_id)
        return layer

    def get_by_name(self, name: str) -> Optional[Layer]:
        """Busca camada pelo nome único."""
        stmt = select(Layer).where(Layer.name == name)
        return self.db.scalars(stmt).first()

    def create_layer(self, data: LayerCreate) -> Layer:
        """Cria nova camada com estilo padrão mesclado."""
        payload = data.model_dump()
        payload["style"] = merge_style(data.geometry_type, data.style)
        layer = Layer(**payload)
        self.db.add(layer)
        self.db.commit()
        self.db.refresh(layer)
        return layer

    def update_layer(self, layer_id: int, data: LayerUpdate) -> Layer:
        """Atualiza campos parciais da camada."""
        layer = self.get_layer(layer_id)
        updates = data.model_dump(exclude_unset=True)
        if "style" in updates and updates["style"] is not None:
            updates["style"] = merge_style(layer.geometry_type, updates["style"])
        for key, value in updates.items():
            setattr(layer, key, value)
        self.db.commit()
        self.db.refresh(layer)
        return layer

    def delete_layer(self, layer_id: int) -> None:
        """Remove camada e feições associadas (cascade)."""
        layer = self.get_layer(layer_id)
        self.db.delete(layer)
        self.db.commit()

    def feature_count(self, layer_id: int) -> int:
        """Conta feições de uma camada."""
        stmt = select(func.count()).select_from(Feature).where(Feature.layer_id == layer_id)
        return int(self.db.scalar(stmt) or 0)

    def to_read_dict(self, layer: Layer) -> dict:
        """Serializa camada incluindo contagem de feições."""
        return {
            "id": layer.id,
            "name": layer.name,
            "title": layer.title,
            "description": layer.description,
            "geometry_type": layer.geometry_type,
            "crs": layer.crs,
            "style": layer.style,
            "is_visible": layer.is_visible,
            "is_public": layer.is_public,
            "source": layer.source,
            "created_at": layer.created_at,
            "updated_at": layer.updated_at,
            "feature_count": self.feature_count(layer.id),
        }
