"""Exportação de camadas para arquivos (GeoJSON / GeoPackage)."""

import json
from pathlib import Path
from typing import Literal

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import UnsupportedFormatError
from app.services.feature_service import FeatureService
from app.utils.file_utils import export_path, ensure_directories

settings = get_settings()
ExportFormat = Literal["geojson", "gpkg"]


class ExportService:
    """Exporta camadas para disco."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.features = FeatureService(db)

    def export_layer(self, layer_id: int, fmt: ExportFormat = "geojson") -> Path:
        """Exporta camada e retorna caminho do arquivo gerado."""
        ensure_directories()
        collection = self.features.layer_as_geojson(layer_id)
        layer_name = (collection.metadata or {}).get("layer_name", f"layer_{layer_id}")

        if fmt == "geojson":
            return self._export_geojson(layer_name, collection.model_dump())
        if fmt == "gpkg":
            return self._export_gpkg(layer_name, collection.model_dump())
        raise UnsupportedFormatError(fmt)

    def _export_geojson(self, layer_name: str, data: dict) -> Path:
        path = export_path(f"{layer_name}.geojson")
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _export_gpkg(self, layer_name: str, data: dict) -> Path:
        """Exporta via GeoPandas quando disponível."""
        try:
            import geopandas as gpd
            from shapely.geometry import shape
        except ImportError as exc:
            raise UnsupportedFormatError("gpkg (geopandas não instalado)") from exc

        rows = []
        for feat in data.get("features", []):
            props = dict(feat.get("properties") or {})
            props["geometry"] = shape(feat["geometry"])
            rows.append(props)

        gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
        path = export_path(f"{layer_name}.gpkg")
        gdf.to_file(path, driver="GPKG")
        return path
