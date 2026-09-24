"""Verifica auth usando apenas variáveis de ambiente (.env)."""

from dotenv import load_dotenv

load_dotenv(".env", override=True)

from app.config import get_settings

get_settings.cache_clear()
s = get_settings()

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.models.usuario import Usuario
from app.services.auth_service import ensure_auth_ready

with engine.connect() as c:
    print("db", c.execute(text("select current_database()")).scalar())
    exists = c.execute(text("select to_regclass('public.usuarios')")).scalar()
    print("usuarios table", exists)

db = SessionLocal()
try:
    ensure_auth_ready(db)
    users = db.query(Usuario).all()
    print("count", len(users))
    for u in users:
        print(u.id, u.nome, u.email, u.is_admin, u.can_upload, (u.senha_hash or "")[:7])
finally:
    db.close()
