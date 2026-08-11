"""Modelo de feição geográfica (feature)."""

from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.layer import Layer


class Feature(Base):
    """Feição espacial associada a uma camada."""

    __tablename__ = "features"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    layer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("layers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    properties: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True, default=dict)
    # SRID 4326 = WGS84 (padrão WebGIS)
    geom = mapped_column(
        Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    layer: Mapped["Layer"] = relationship("Layer", back_populates="features")

    def __repr__(self) -> str:
        return f"<Feature id={self.id} layer_id={self.layer_id}>"
