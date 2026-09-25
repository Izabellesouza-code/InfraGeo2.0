"""Migra public.usuarios -> usuarios.usuarios e lista o resultado."""

from dotenv import load_dotenv

load_dotenv(".env", override=True)

from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal, engine
from app.models.usuario import Usuario
from app.services.auth_service import ensure_auth_ready

get_settings.cache_clear()

db = SessionLocal()
try:
    ensure_auth_ready(db)
    users = db.query(Usuario).order_by(Usuario.id).all()
    print("usuarios.usuarios", len(users))
    for u in users:
        print(u.id, u.nome, u.email)
finally:
    db.close()

with engine.connect() as c:
    print("public.usuarios", c.execute(text("select to_regclass('public.usuarios')")).scalar())
    print("public.users", c.execute(text("select to_regclass('public.users')")).scalar())
