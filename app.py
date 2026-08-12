"""
Atalho para subir o InfraGeo WebGIS.

Uso (na pasta do projeto):
  .\\.venv\\Scripts\\python.exe app.py
  # ou
  python app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    import os

    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("DEBUG", "true").lower() in {"1", "true", "yes"}
    print(f"InfraGeo AM -> http://{host}:{port}/")
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=[str(ROOT / "app"), str(ROOT / "templates"), str(ROOT / "static")]
        if reload
        else None,
    )


if __name__ == "__main__":
    main()
