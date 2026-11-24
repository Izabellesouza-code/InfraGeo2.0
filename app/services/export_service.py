"""Exportação de camadas para arquivos (GeoJSON / GeoPackage / Shapefile)."""

import json
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import UnsupportedFormatError, WebGISException
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

    def export_geojson_shapefile(self, name: str, collection: dict[str, Any]) -> Path:
        """Gera um ZIP com shapefile a partir de um FeatureCollection."""
        ensure_directories()
        features = collection.get("features") if isinstance(collection, dict) else None
        if not features:
            raise WebGISException("Nenhuma feição selecionada para exportar.", status_code=400)
        try:
            import geopandas as gpd
            from shapely.geometry import shape
        except ImportError as exc:
            raise UnsupportedFormatError("shp (geopandas não instalado)") from exc

        rows = []
        for feat in features:
            geom = feat.get("geometry")
            if not geom:
                continue
            props = dict(feat.get("properties") or {})
            props.pop("_layerId", None)
            try:
                props["geometry"] = shape(geom)
            except Exception:  # noqa: BLE001
                continue
            rows.append(props)
        if not rows:
            raise WebGISException("A seleção não tem geometria válida.", status_code=400)

        gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
        types = gdf.geometry.geom_type.dropna()
        if types.empty:
            raise WebGISException("A seleção não tem geometria válida.", status_code=400)
        main_type = types.mode().iloc[0]
        gdf = gdf[gdf.geometry.geom_type == main_type].copy()

        stem = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "selecao").strip())[:40] or "selecao"
        with tempfile.TemporaryDirectory(prefix="infrageo_shp_") as tmp:
            folder = Path(tmp)
            shp_path = folder / f"{stem}.shp"
            gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="utf-8")
            zip_path = export_path(f"{stem}.zip")
            if zip_path.exists():
                zip_path.unlink()
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for child in folder.iterdir():
                    if child.is_file():
                        zf.write(child, child.name)
        return zip_path
