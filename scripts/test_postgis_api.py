"""Testa health + catalog + um GeoJSON leve."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

# limpa cache de settings se já importado
from app import config

config.get_settings.cache_clear()

from app.services.postgis_service import PostGISService

svc = PostGISService()
print("=== HEALTH ===")
print(svc.health())
print("=== CATALOG ===")
cat = svc.catalog()
print("ok=", cat["ok"], "layers=", cat["layer_count"])
for g in cat["groups"]:
    print(f"  [{g['id']}] {g['name']} ({len(g['layers'])})")
    for ly in g["layers"][:3]:
        print(f"    - {ly['name']} defaultOn={ly['defaultOn']}")
    if len(g["layers"]) > 3:
        print(f"    ... +{len(g['layers']) - 3}")

print("=== GEOJSON LIMITE_ESTADUAL ===")
gj = svc.layer_geojson("LIMITE_ESTADUAL", "LIMITE_ESTADUAL_SEPLAN", simplify=0.001)
print("type=", gj.get("type"), "features=", len(gj.get("features") or []))
