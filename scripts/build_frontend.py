"""Gera o frontend estático para deploy na Vercel.

Uso:
  python scripts/build_frontend.py
  set INFRA_GEO_API_URL=https://sua-api.onrender.com

Saída: frontend/dist/ (index.html + static/)
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DIST = ROOT / "frontend" / "dist"


def main() -> None:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    api_url = (os.environ.get("INFRA_GEO_API_URL") or "").strip().rstrip("/")
    templates = Environment(
        loader=FileSystemLoader(str(ROOT / "templates")),
        autoescape=select_autoescape(["html", "xml"]),
    )
    html = templates.get_template("pages/mapa.html").render(
        app_name=os.environ.get("APP_NAME", "InfraGeo AM"),
        center_lat=float(os.environ.get("DEFAULT_MAP_CENTER_LAT", "-3.4653")),
        center_lon=float(os.environ.get("DEFAULT_MAP_CENTER_LON", "-62.2159")),
        zoom=int(os.environ.get("DEFAULT_MAP_ZOOM", "5")),
    )

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    (DIST / "index.html").write_text(html, encoding="utf-8")

    static_src = ROOT / "static"
    static_dst = DIST / "static"
    shutil.copytree(static_src, static_dst)

    runtime = DIST / "static" / "js" / "config" / "runtime.js"
    runtime.write_text(
        "/** Gerado por scripts/build_frontend.py — não edite à mão no dist. */\n"
        f'window.INFRA_GEO_API_URL = {api_url!r};\n',
        encoding="utf-8",
    )

    # SPA fallback: Vercel serve index em /
    (DIST / "404.html").write_text(html, encoding="utf-8")

    print(f"Frontend gerado em {DIST}")
    print(f"INFRA_GEO_API_URL={api_url or '(vazio — mesmo host)'}")


if __name__ == "__main__":
    main()
