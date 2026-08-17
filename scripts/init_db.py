"""Script de inicialização do banco PostGIS e dados de exemplo."""

from __future__ import annotations

import sys
from pathlib import Path

# Garante que a raiz do projeto esteja no PYTHONPATH
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select

from app.core.security import hash_password
from app.database import SessionLocal, init_db
from app.models.user import User
from app.schemas.feature import FeatureCreate
from app.schemas.layer import LayerCreate
from app.services.feature_service import FeatureService
from app.services.layer_service import LayerService


SAMPLE_POINTS = [
    {
        "name": "Brasília",
        "properties": {"uf": "DF", "tipo": "capital"},
        "geometry": {"type": "Point", "coordinates": [-47.9292, -15.7801]},
    },
    {
        "name": "São Paulo",
        "properties": {"uf": "SP", "tipo": "capital"},
        "geometry": {"type": "Point", "coordinates": [-46.6333, -23.5505]},
    },
    {
        "name": "Rio de Janeiro",
        "properties": {"uf": "RJ", "tipo": "capital"},
        "geometry": {"type": "Point", "coordinates": [-43.1729, -22.9068]},
    },
]


def seed() -> None:
    print("→ Criando extensões PostGIS e tabelas...")
    init_db()

    db = SessionLocal()
    try:
        layers = LayerService(db)
        features = FeatureService(db)

        if not layers.get_by_name("capitais"):
            print("→ Criando camada 'capitais'...")
            layer = layers.create_layer(
                LayerCreate(
                    name="capitais",
                    title="Capitais (amostra)",
                    description="Pontos de exemplo para demonstração do WebGIS",
                    geometry_type="Point",
                    style={"fillColor": "#f59e0b", "color": "#b45309"},
                )
            )
            for item in SAMPLE_POINTS:
                features.create_feature(
                    FeatureCreate(
                        layer_id=layer.id,
                        name=item["name"],
                        properties=item["properties"],
                        geometry=item["geometry"],
                    )
                )
            print(f"   Camada id={layer.id} com {len(SAMPLE_POINTS)} feições.")
        else:
            print("→ Camada 'capitais' já existe — pulando.")

        from app.config import get_settings

        settings = get_settings()
        admin = db.scalars(select(User).where(User.username == "admin")).first()
        if not admin:
            bootstrap_pwd = (settings.auth_bootstrap_password or "").strip()
            if not bootstrap_pwd:
                print(
                    "→ AUTH_BOOTSTRAP_PASSWORD não definido — "
                    "usuário admin não foi criado."
                )
            else:
                print(
                    f"→ Criando usuário {settings.auth_bootstrap_username} "
                    "(senha via AUTH_BOOTSTRAP_PASSWORD)..."
                )
                db.add(
                    User(
                        username=settings.auth_bootstrap_username or "admin",
                        email=settings.auth_bootstrap_email
                        or "admin@infrageo.local",
                        hashed_password=hash_password(bootstrap_pwd),
                        full_name="Administrador",
                        is_admin=True,
                    )
                )
                db.commit()
        else:
            print("→ Usuário admin já existe — pulando.")

        print("✓ Banco inicializado com sucesso.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
