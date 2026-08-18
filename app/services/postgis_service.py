"""Catálogo e exportação GeoJSON a partir dos schemas PostGIS do InfraGeo."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.config import get_settings
from app.core.exceptions import WebGISException
from app.database import engine

settings = get_settings()

# Grupos da sidebar → regras de encaixe por schema
GROUP_DEFS: list[dict[str, Any]] = [
    {
        "id": "oae_oac",
        "name": "OAE/OAC",
        "icon": "🌉",
        "iconClass": "layer-group__icon--teal",
        "match": (
            "PONTES_",
            "BUEIROS_",
            "JAZIDAS_",
            "IP4",
            "PRAD",
            "PCA_PRAD",
            "USINA_",
            "CANTEIRO_",
        ),
    },
    {
        "id": "br_am",
        "name": "BR-AM",
        "icon": "🛣️",
        "iconClass": "layer-group__icon--green",
        "match": ("BR_174", "BR_230", "BR_307", "BR_317", "BR_319"),
    },
    {
        "id": "aquaviario",
        "name": "Aquaviário",
        "icon": "🚢",
        "iconClass": "layer-group__icon--blue",
        "match": ("BALSA_", "HIDROVIA"),
    },
    {
        "id": "ucs",
        "name": "Unidades de Conservação",
        "icon": "🍃",
        "iconClass": "layer-group__icon--leaf",
        "match": ("UC_", "TI_AM", "ZA_UC"),
    },
    {
        "id": "limites_am",
        "name": "Limites AM",
        "icon": "🧭",
        "iconClass": "layer-group__icon--grid",
        "match": ("LIMITE_",),
    },
    {
        "id": "uploads",
        "name": "Uploads",
        "icon": "📤",
        "iconClass": "layer-group__icon--teal",
        "match": ("UPLOADS",),
    },
]

STYLE_BY_TYPE: dict[str, dict[str, Any]] = {
    "POINT": {"fillColor": "#14b8a6", "color": "#0f766e", "radius": 6, "fillOpacity": 0.85},
    "MULTIPOINT": {"fillColor": "#14b8a6", "color": "#0f766e", "radius": 6, "fillOpacity": 0.85},
    "LINESTRING": {"color": "#16a34a", "weight": 3, "opacity": 0.9},
    "MULTILINESTRING": {"color": "#16a34a", "weight": 3, "opacity": 0.9},
    "POLYGON": {
        "fillColor": "#34d399",
        "color": "#065f46",
        "weight": 1.5,
        "fillOpacity": 0.25,
        "opacity": 0.9,
    },
    "MULTIPOLYGON": {
        "fillColor": "#34d399",
        "color": "#065f46",
        "weight": 1.5,
        "fillOpacity": 0.25,
        "opacity": 0.9,
    },
}

LIMITE_STYLE = {
    "fillColor": "transparent",
    "color": "#111827",
    "weight": 2.5,
    "fillOpacity": 0,
    "opacity": 1,
}

IDENT_RE = re.compile(r"^[A-Za-z0-9_ À-ÿ\-—().]+$")

# Paleta distinta para BRs (sorteio estável por número da rodovia)
_BR_PALETTE: list[tuple[str, str]] = [
    ("#e11d48", "#fb7185"),  # rose
    ("#7c3aed", "#c4b5fd"),  # violet
    ("#0891b2", "#67e8f9"),  # cyan
    ("#ca8a04", "#fde047"),  # yellow
    ("#c026d3", "#f0abfc"),  # fuchsia
    ("#059669", "#6ee7b7"),  # emerald
    ("#ea580c", "#fdba74"),  # orange
    ("#2563eb", "#93c5fd"),  # blue
    ("#be123c", "#fda4af"),  # red
    ("#4f46e5", "#a5b4fc"),  # indigo
]


def _extract_br_num(schema: str, table: str = "") -> str | None:
    """Extrai o número da BR do schema/tabela (BR_319, BUEIROS_319, …)."""
    for text in (schema or "", table or ""):
        m = re.search(r"BR[_\-\s]*(\d{2,4})", text, re.I)
        if m:
            return m.group(1)
    s = (schema or "").upper()
    m = re.search(r"_(\d{2,4})$", s)
    if m and s.startswith(
        ("BR_", "BUEIROS", "PONTES", "JAZIDAS", "PRAD", "PCA")
    ):
        return m.group(1)
    return None


def _br_colors(br_num: str) -> tuple[str, str]:
    """Cor (traço, preenchimento) estável e distinta por BR."""
    key = str(br_num or "0")
    idx = int(hashlib.md5(f"infrageo-br-{key}".encode()).hexdigest(), 16) % len(
        _BR_PALETTE
    )
    return _BR_PALETTE[idx]


def _qi(name: str) -> str:
    """Quote identifier PostgreSQL."""
    return '"' + name.replace('"', '""') + '"'


def _group_for_schema(schema: str) -> dict[str, Any] | None:
    upper = schema.upper()
    for group in GROUP_DEFS:
        for prefix in group["match"]:
            if upper.startswith(prefix) or upper == prefix:
                return group
    return None


def _display_name(schema: str, table: str) -> str:
    """Nome amigável para a sidebar (sem SCHEMA · TABELA)."""
    s = (schema or "").upper()
    t = (table or "").strip()

    br = (
        re.search(r"BR[_\-\s]*(\d{2,4})", s)
        or re.search(r"BR[_\-\s]*(\d{2,4})", t, re.I)
        or re.search(r"_(\d{2,4})$", s)
    )
    br_num = br.group(1) if br else None

    if s.startswith("BR_") and br_num:
        return f"BR-{br_num}"
    if s.startswith("BUEIROS"):
        return f"Bueiros BR-{br_num}" if br_num else "Bueiros"
    if s.startswith("PONTES"):
        return f"Pontes BR-{br_num}" if br_num else "Pontes"
    if s.startswith("JAZIDAS"):
        return f"Jazidas BR-{br_num}" if br_num else "Jazidas"
    if s.startswith("USINA"):
        return f"Usina BR-{br_num}" if br_num else "Usina"
    if s.startswith("CANTEIRO"):
        return f"Canteiro BR-{br_num}" if br_num else "Canteiro"
    if s.startswith("PRAD"):
        # Mantém detalhe do segmento se houver
        seg = re.search(r"(Segmento\s+[A-Z]|Trecho[^)]*)", t, re.I)
        base = f"PRAD BR-{br_num}" if br_num else "PRAD"
        if "ponto" in t.lower():
            base += " (pontos)"
        if seg:
            return f"{base} — {seg.group(1).strip()}"
        return base
    if s.startswith("PCA_PRAD_CMM"):
        return f"PCA/PRAD CMM BR-{br_num}" if br_num else "PCA/PRAD CMM"
    if s.startswith("PCA_PRAD"):
        return f"PCA/PRAD BR-{br_num}" if br_num else "PCA/PRAD"
    if s == "IP4":
        return "IP4 Amazonas"
    if s.startswith("BALSA"):
        return "Balsa Igapó-Açu"
    if s.startswith("LIMITE_ESTADUAL"):
        return "Limite Estadual"
    if s.startswith("LIMITE_MUNICIPAL"):
        return "Limite Municipal"
    if s.startswith("UC_ESTADUAL"):
        return "UC Estadual"
    if s.startswith("UC_MUNICIPAL"):
        return "UC Municipal"
    if s.startswith("UC_FEDERAL"):
        return "UC Federal"
    if s.startswith("TI_AM"):
        return "Terras Indígenas"
    if s.startswith("ZA_UC"):
        return "Zona de Amortecimento UC"

    # fallback: título limpo
    nice = re.sub(r"[_\-]+", " ", t or schema).strip()
    nice = re.sub(r"\s+", " ", nice)
    return nice.title() if nice else schema


def _layer_id(schema: str, table: str) -> str:
    raw = f"{schema}__{table}"
    return re.sub(r"[^A-Za-z0-9_]+", "_", raw)


def _style_for(
    schema: str, geom_type: str, table: str = ""
) -> dict[str, Any]:
    s = schema.upper()
    br_num = _extract_br_num(schema, table)

    if s.startswith("LIMITE_"):
        return dict(LIMITE_STYLE)

    # BRs — cores aleatórias (estáveis) por rodovia
    if s.startswith("BR_"):
        stroke, _fill = _br_colors(br_num or "0")
        return {"color": stroke, "weight": 3.5, "opacity": 0.95}

    # UCs / TI / ZA — cores distintas por tipo
    if s.startswith("UC_FEDERAL"):
        return {
            "fillColor": "#ef4444",
            "color": "#b91c1c",
            "weight": 1.5,
            "fillOpacity": 0.35,
            "opacity": 0.95,
        }
    if s.startswith("UC_ESTADUAL"):
        return {
            "fillColor": "#22c55e",
            "color": "#15803d",
            "weight": 1.5,
            "fillOpacity": 0.35,
            "opacity": 0.95,
        }
    if s.startswith("UC_MUNICIPAL"):
        return {
            "fillColor": "#7dd3fc",
            "color": "#0284c7",
            "weight": 1.5,
            "fillOpacity": 0.35,
            "opacity": 0.95,
        }
    if s.startswith("TI_") or s.startswith("TI_AM"):
        return {
            "fillColor": "#eab308",
            "color": "#a16207",
            "weight": 1.5,
            "fillOpacity": 0.35,
            "opacity": 0.95,
        }
    if s.startswith("ZA_"):
        return {
            "fillColor": "#1e3a8a",
            "color": "#172554",
            "weight": 1.5,
            "fillOpacity": 0.4,
            "opacity": 0.95,
        }

    # PRADS / PCA-PRAD — laranja (mantém)
    if s.startswith(("PRAD", "PCA_PRAD", "PCA")):
        return {
            "fillColor": "#f97316",
            "color": "#c2410c",
            "radius": 6,
            "fillOpacity": 0.85,
            "weight": 2,
        }

    # OAE/OAC (pontes, bueiros, jazidas, usina, canteiro) — cor da BR
    if s.startswith(("PONTES_", "BUEIROS_", "JAZIDAS_", "USINA_", "CANTEIRO_")):
        if br_num:
            stroke, fill = _br_colors(br_num)
            return {
                "fillColor": fill,
                "color": stroke,
                "radius": 6,
                "fillOpacity": 0.85,
                "weight": 2,
            }
        return {
            "fillColor": "#14b8a6",
            "color": "#0f766e",
            "radius": 6,
            "fillOpacity": 0.85,
            "weight": 2,
        }

    if s.startswith("IP4"):
        return {
            "fillColor": "#14b8a6",
            "color": "#0f766e",
            "radius": 6,
            "fillOpacity": 0.85,
            "weight": 2,
        }

    if s.startswith("BALSA"):
        return {
            "fillColor": "#3b82f6",
            "color": "#1d4ed8",
            "radius": 7,
            "fillOpacity": 0.85,
            "weight": 2,
        }

    return dict(STYLE_BY_TYPE.get(geom_type.upper(), STYLE_BY_TYPE["POLYGON"]))


def _leaflet_type(geom_type: str) -> str:
    mapping = {
        "POINT": "Point",
        "MULTIPOINT": "MultiPoint",
        "LINESTRING": "LineString",
        "MULTILINESTRING": "MultiLineString",
        "POLYGON": "Polygon",
        "MULTIPOLYGON": "MultiPolygon",
    }
    return mapping.get(geom_type.upper(), "Geometry")


class PostGISService:
    """Lê o inventário geometry_columns e serve GeoJSON."""

    def __init__(self, db_engine: Engine | None = None) -> None:
        self.engine = db_engine or engine

    def health(self) -> dict[str, Any]:
        try:
            with self.engine.connect() as conn:
                version = conn.execute(text("SELECT PostGIS_Version()")).scalar()
                db = conn.execute(text("SELECT current_database()")).scalar()
                schemas = [
                    r[0]
                    for r in conn.execute(
                        text(
                            "SELECT schema_name FROM information_schema.schemata "
                            "WHERE schema_name NOT IN "
                            "('pg_catalog','information_schema','pg_toast','topology') "
                            "ORDER BY 1"
                        )
                    )
                ]
            return {
                "ok": True,
                "database": db,
                "postgis": version,
                "schemas": schemas,
                "schema_count": len(schemas),
            }
        except Exception as exc:  # noqa: BLE001
            raise WebGISException(
                f"Falha ao conectar no PostGIS: {exc}",
                status_code=503,
            ) from exc

    def list_geometry_tables(self) -> list[dict[str, Any]]:
        sql = text(
            """
            SELECT
              f_table_schema AS schema,
              f_table_name   AS table,
              f_geometry_column AS geom_column,
              type AS geom_type,
              srid
            FROM geometry_columns
            WHERE f_table_schema NOT IN ('topology', 'public')
            ORDER BY f_table_schema, f_table_name
            """
        )
        with self.engine.connect() as conn:
            rows = conn.execute(sql).mappings().all()
        return [dict(r) for r in rows]

    def catalog(self) -> dict[str, Any]:
        """Monta grupos da sidebar com camadas vindas do PostGIS."""
        tables = self.list_geometry_tables()
        groups: dict[str, dict[str, Any]] = {
            g["id"]: {
                "id": g["id"],
                "name": g["name"],
                "icon": g["icon"],
                "iconClass": g["iconClass"],
                "layers": [],
            }
            for g in GROUP_DEFS
        }
        other = {
            "id": "outros",
            "name": "Outros",
            "icon": "📦",
            "iconClass": "layer-group__icon--grid",
            "layers": [],
        }

        for row in tables:
            schema = row["schema"]
            table = row["table"]
            geom_type = row["geom_type"] or "GEOMETRY"
            group = _group_for_schema(schema)
            # Schemas de upload (nome do SHP) e demais não classificados → Uploads
            if group and group["id"] != "uploads":
                target = groups[group["id"]]
            elif "uploads" in groups:
                target = groups["uploads"]
            else:
                target = other

            layer_id = _layer_id(schema, table)
            default_on = (
                schema.upper() == "LIMITE_ESTADUAL"
                and "LIMITE_ESTADUAL" in table.upper()
            )
            target["layers"].append(
                {
                    "id": layer_id,
                    "name": _display_name(schema, table),
                    "schema": schema,
                    "table": table,
                    "geom_column": row["geom_column"],
                    "type": _leaflet_type(geom_type),
                    "srid": row["srid"],
                    "style": _style_for(schema, geom_type, table),
                    "defaultOn": default_on,
                    "url": (
                        "/api/postgis/geojson"
                        f"?schema={quote(schema, safe='')}"
                        f"&table={quote(table, safe='')}"
                        f"&simplify={settings.postgis_simplify_tolerance}"
                    ),
                }
            )

        result_groups = [groups[g["id"]] for g in GROUP_DEFS if groups[g["id"]]["layers"]]
        if other["layers"]:
            result_groups.append(other)

        return {
            "ok": True,
            "source": "postgis",
            "groups": result_groups,
            "layer_count": sum(len(g["layers"]) for g in result_groups),
        }

    def _resolve_table(self, schema: str, table: str) -> dict[str, Any]:
        for row in self.list_geometry_tables():
            if row["schema"] == schema and row["table"] == table:
                return row
        raise WebGISException(
            f"Camada não encontrada: {schema}.{table}",
            status_code=404,
        )

    def layer_geojson(
        self,
        schema: str,
        table: str,
        simplify: float | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Exporta tabela PostGIS como FeatureCollection (WGS84)."""
        meta = self._resolve_table(schema, table)
        geom_col = meta["geom_column"]
        tol = (
            settings.postgis_simplify_tolerance
            if simplify is None
            else float(simplify)
        )
        max_rows = settings.postgis_geojson_limit if limit is None else int(limit)

        schema_q = _qi(schema)
        table_q = _qi(table)
        geom_q = _qi(geom_col)

        # Transforma para 4326; simplifica polígonos/linhas grandes
        geom_expr = f"ST_Transform({geom_q}, 4326)"
        if tol and tol > 0:
            geom_expr = f"ST_SimplifyPreserveTopology({geom_expr}, :tol)"

        limit_sql = ""
        params: dict[str, Any] = {}
        if tol and tol > 0:
            params["tol"] = tol
        if max_rows and max_rows > 0:
            limit_sql = " LIMIT :lim"
            params["lim"] = max_rows

        sql = text(
            f"""
            SELECT jsonb_build_object(
              'type', 'FeatureCollection',
              'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
              SELECT jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON({geom_expr})::jsonb,
                'properties', to_jsonb(t) - '{geom_col}'
              ) AS feature
              FROM {schema_q}.{table_q} AS t
              WHERE {geom_q} IS NOT NULL
              {limit_sql}
            ) q
            """
        )

        try:
            with self.engine.connect() as conn:
                raw = conn.execute(sql, params).scalar()
        except Exception as exc:  # noqa: BLE001
            raise WebGISException(
                f"Erro ao ler {schema}.{table}: {exc}",
                status_code=500,
            ) from exc

        if isinstance(raw, str):
            return json.loads(raw)
        if isinstance(raw, dict):
            return raw
        return {"type": "FeatureCollection", "features": []}

    @staticmethod
    def _safe_table_name(name: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", (name or "").strip())
        cleaned = re.sub(r"_+", "_", cleaned).strip("_")
        if not cleaned:
            cleaned = "camada_upload"
        if cleaned[0].isdigit():
            cleaned = f"shp_{cleaned}"
        return cleaned[:60].upper()

    def import_shapefile(
        self,
        source_paths: list[Path],
        table_name: str | None = None,
        schema: str | None = None,
    ) -> dict[str, Any]:
        """
        Lê shapefile ou GeoJSON e grava no PostGIS.
        ZIP: somente componentes de SHP ou arquivos .geojson/.json.
        Cria schema com o nome do arquivo e tabela homônima.
        """
        import os

        try:
            import geopandas as gpd
        except ImportError as exc:
            raise WebGISException(
                "Servidor sem suporte a SHP/GeoJSON (geopandas não instalado). "
                "Redeploy da API com requirements atualizado.",
                status_code=500,
            ) from exc

        from app.utils.file_utils import (
            GEOJSON_EXTENSIONS,
            extract_vector_zip,
            validate_vector_zip,
        )

        # Permite ler .shp mesmo sem .shx (GDAL/pyogrio recria o índice)
        os.environ["SHAPE_RESTORE_SHX"] = "YES"

        if not source_paths:
            raise WebGISException("Nenhum arquivo enviado", status_code=400)

        work = Path(tempfile.mkdtemp(prefix="infrageo_shp_"))
        vector_path: Path | None = None
        preferred_name = table_name or schema
        kind = "shapefile"

        try:
            # Um único ZIP — valida conteúdo antes de extrair
            if len(source_paths) == 1 and source_paths[0].suffix.lower() == ".zip":
                kind = validate_vector_zip(source_paths[0])
                extract_vector_zip(source_paths[0], work)
                if kind == "shapefile":
                    shp_candidates = list(work.rglob("*.shp"))
                    if not shp_candidates:
                        raise WebGISException(
                            "O ZIP não contém arquivo .shp",
                            status_code=400,
                        )
                    vector_path = shp_candidates[0]
                else:
                    gj_candidates = [
                        p
                        for p in work.rglob("*")
                        if p.is_file() and p.suffix.lower() in GEOJSON_EXTENSIONS
                    ]
                    if not gj_candidates:
                        raise WebGISException(
                            "O ZIP não contém arquivo GeoJSON (.geojson/.json)",
                            status_code=400,
                        )
                    vector_path = gj_candidates[0]
                if not preferred_name:
                    preferred_name = vector_path.stem
            else:
                for src in source_paths:
                    dest = work / src.name
                    shutil.copy2(src, dest)
                    ext = src.suffix.lower()
                    if ext == ".shp":
                        vector_path = dest
                        kind = "shapefile"
                        if not preferred_name:
                            preferred_name = src.stem
                    elif ext in GEOJSON_EXTENSIONS and vector_path is None:
                        vector_path = dest
                        kind = "geojson"
                        if not preferred_name:
                            preferred_name = src.stem

                if vector_path is None:
                    found_shp = list(work.glob("*.shp"))
                    found_gj = [
                        p
                        for p in work.glob("*")
                        if p.suffix.lower() in GEOJSON_EXTENSIONS
                    ]
                    if found_shp:
                        vector_path = found_shp[0]
                        kind = "shapefile"
                    elif found_gj:
                        vector_path = found_gj[0]
                        kind = "geojson"
                    if vector_path and not preferred_name:
                        preferred_name = vector_path.stem

                if vector_path is None:
                    raise WebGISException(
                        "Envie um .zip (shapefile ou GeoJSON), "
                        "arquivos .shp/.shx/.dbf ou um .geojson",
                        status_code=400,
                    )

            try:
                gdf = gpd.read_file(vector_path)
            except Exception as exc:  # noqa: BLE001
                try:
                    gdf = gpd.read_file(vector_path, engine="fiona")
                except Exception as exc2:  # noqa: BLE001
                    label = "GeoJSON" if kind == "geojson" else "shapefile"
                    raise WebGISException(
                        f"Falha ao ler {label}: {exc2}. "
                        "Para SHP, envie o .zip completo (.shp, .shx, .dbf e .prj). "
                        "Para GeoJSON, use .geojson ou .json válido.",
                        status_code=400,
                    ) from exc2

            if gdf.empty:
                raise WebGISException("Arquivo sem feições", status_code=400)
            if "geometry" not in gdf.columns and gdf.geometry.name not in gdf.columns:
                raise WebGISException("Arquivo sem geometria", status_code=400)

            if gdf.crs is None:
                gdf = gdf.set_crs(4326)
            else:
                try:
                    epsg = gdf.crs.to_epsg()
                except Exception:  # noqa: BLE001
                    epsg = None
                if epsg != 4326:
                    gdf = gdf.to_crs(4326)

            rename = {}
            for col in gdf.columns:
                if col == gdf.geometry.name:
                    continue
                safe = re.sub(r"[^A-Za-z0-9_]+", "_", str(col)).strip("_").lower()
                if not safe:
                    safe = "attr"
                if safe[0].isdigit():
                    safe = f"c_{safe}"
                rename[col] = safe[:58]
            if rename:
                gdf = gdf.rename(columns=rename)

            # Schema e tabela = nome do arquivo no padrão das camadas existentes
            schema_name = self._safe_table_name(
                preferred_name or (vector_path.stem if vector_path else "camada")
            )
            table = schema_name

            # Não sobrescreve schemas do inventário oficial (OAE, BR, UC, etc.)
            protected = set()
            for row in self.list_geometry_tables():
                g = _group_for_schema(row["schema"])
                if g and g["id"] != "uploads":
                    protected.add(row["schema"].upper())
            if schema_name in protected:
                raise WebGISException(
                    f"O nome '{schema_name}' já existe no inventário. "
                    "Renomeie o arquivo e envie de novo.",
                    status_code=409,
                )

            with self.engine.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))

            try:
                gdf.to_postgis(
                    table,
                    self.engine,
                    schema=schema_name,
                    if_exists="replace",
                    index=False,
                )
            except Exception as exc:  # noqa: BLE001
                raise WebGISException(
                    f"Falha ao gravar no PostGIS: {exc}",
                    status_code=500,
                ) from exc

            layer_id = _layer_id(schema_name, table)
            return {
                "ok": True,
                "schema": schema_name,
                "table": table,
                "layer_id": layer_id,
                "feature_count": int(len(gdf)),
                "geom_type": str(gdf.geom_type.mode().iloc[0]) if len(gdf) else None,
                "format": kind,
                "name": _display_name(schema_name, table),
                "url": (
                    "/api/postgis/geojson"
                    f"?schema={quote(schema_name, safe='')}"
                    f"&table={quote(table, safe='')}"
                    f"&simplify={settings.postgis_simplify_tolerance}"
                ),
            }
        finally:
            shutil.rmtree(work, ignore_errors=True)
