"""CRUD e exportação de feições geográficas."""

from typing import Any, Optional

from geoalchemy2.functions import ST_Intersects, ST_MakeEnvelope
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import FeatureNotFoundError, LayerNotFoundError
from app.gis.geometry import ensure_geometry_type, geojson_to_shapely
from app.models.feature import Feature
from app.models.layer import Layer
from app.schemas.feature import FeatureCreate, FeatureUpdate
from app.schemas.geojson import FeatureCollection, GeoJSONFeature
from app.utils.geojson_utils import (
    build_feature_collection,
    feature_to_geojson,
    geojson_from_wkb,
    wkb_element_from_geojson,
)


class FeatureService:
    """Gerencia feições espaciais vinculadas a camadas."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def _get_layer(self, layer_id: int) -> Layer:
        layer = self.db.get(Layer, layer_id)
        if not layer:
            raise LayerNotFoundError(layer_id)
        return layer

    def get_feature(self, feature_id: int) -> Feature:
        feature = self.db.get(Feature, feature_id)
        if not feature:
            raise FeatureNotFoundError(feature_id)
        return feature

    def create_feature(self, data: FeatureCreate) -> Feature:
        """Insere feição validando tipo geométrico da camada."""
        layer = self._get_layer(data.layer_id)
        geom = geojson_to_shapely(data.geometry)
        ensure_geometry_type(geom, layer.geometry_type)

        feature = Feature(
            layer_id=data.layer_id,
            name=data.name,
            properties=data.properties or {},
            geom=wkb_element_from_geojson(data.geometry, srid=4326),
        )
        self.db.add(feature)
        self.db.commit()
        self.db.refresh(feature)
        return feature

    def update_feature(self, feature_id: int, data: FeatureUpdate) -> Feature:
        """Atualiza atributos e/ou geometria."""
        feature = self.get_feature(feature_id)
        layer = self._get_layer(feature.layer_id)
        updates = data.model_dump(exclude_unset=True)

        if "geometry" in updates and updates["geometry"] is not None:
            geom = geojson_to_shapely(updates["geometry"])
            ensure_geometry_type(geom, layer.geometry_type)
            feature.geom = wkb_element_from_geojson(updates["geometry"], srid=4326)
            updates.pop("geometry")

        for key, value in updates.items():
            setattr(feature, key, value)

        self.db.commit()
        self.db.refresh(feature)
        return feature

    def delete_feature(self, feature_id: int) -> None:
        feature = self.get_feature(feature_id)
        self.db.delete(feature)
        self.db.commit()

    def list_by_layer(self, layer_id: int) -> list[Feature]:
        self._get_layer(layer_id)
        stmt = select(Feature).where(Feature.layer_id == layer_id).order_by(Feature.id)
        return list(self.db.scalars(stmt).all())

    def to_read_dict(self, feature: Feature) -> dict[str, Any]:
        return {
            "id": feature.id,
            "layer_id": feature.layer_id,
            "name": feature.name,
            "properties": feature.properties or {},
            "geometry": geojson_from_wkb(feature.geom),
            "created_at": feature.created_at,
            "updated_at": feature.updated_at,
        }

    def layer_as_geojson(self, layer_id: int) -> FeatureCollection:
        """Exporta todas as feições da camada como FeatureCollection."""
        layer = self._get_layer(layer_id)
        features = self.list_by_layer(layer_id)
        geo_features = [
            feature_to_geojson(
                f.id,
                geojson_from_wkb(f.geom),
                properties={**(f.properties or {}), "layer": layer.name},
                name=f.name,
            )
            for f in features
        ]
        return build_feature_collection(
            geo_features,
            metadata={
                "layer_id": layer.id,
                "layer_name": layer.name,
                "title": layer.title,
                "style": layer.style,
                "crs": layer.crs,
            },
        )

    def query_by_bbox(
        self,
        bbox: list[float],
        layer_id: Optional[int] = None,
    ) -> FeatureCollection:
        """Consulta feições que intersectam um bounding box."""
        minx, miny, maxx, maxy = bbox
        envelope = ST_MakeEnvelope(minx, miny, maxx, maxy, 4326)
        stmt = select(Feature).where(ST_Intersects(Feature.geom, envelope))
        if layer_id is not None:
            self._get_layer(layer_id)
            stmt = stmt.where(Feature.layer_id == layer_id)

        rows = list(self.db.scalars(stmt).all())
        geo_features = [
            feature_to_geojson(
                f.id,
                geojson_from_wkb(f.geom),
                properties=f.properties or {},
                name=f.name,
            )
            for f in rows
        ]
        return build_feature_collection(
            geo_features,
            metadata={"bbox": bbox, "layer_id": layer_id, "count": len(geo_features)},
            bbox=bbox,
        )

    def import_geojson_features(
        self,
        layer_id: int,
        feature_collection: dict[str, Any],
    ) -> int:
        """Importa FeatureCollection GeoJSON para uma camada. Retorna quantidade inserida."""
        layer = self._get_layer(layer_id)
        features_data = feature_collection.get("features") or []
        count = 0
        for item in features_data:
            geometry = item.get("geometry")
            if not geometry:
                continue
            geom = geojson_to_shapely(geometry)
            ensure_geometry_type(geom, layer.geometry_type)
            props = item.get("properties") or {}
            name = props.get("name") or props.get("nome")
            feature = Feature(
                layer_id=layer_id,
                name=name,
                properties=props,
                geom=wkb_element_from_geojson(geometry, srid=4326),
            )
            self.db.add(feature)
            count += 1
        self.db.commit()
        return count
