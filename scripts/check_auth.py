from dotenv import load_dotenv

load_dotenv(".env", override=True)

from app.config import get_settings

get_settings.cache_clear()
s = get_settings()
print("bootstrap", s.auth_bootstrap_username, s.auth_bootstrap_password)

from sqlalchemy import text

from app.core.security import verify_password
from app.database import SessionLocal, engine
from app.models.user import User
from app.services.auth_service import authenticate, ensure_auth_ready

with engine.connect() as c:
    print("db", c.execute(text("select current_database()")).scalar())
    exists = c.execute(text("select to_regclass('public.users')")).scalar()
    print("users table", exists)

db = SessionLocal()
try:
    ensure_auth_ready(db)
    users = db.query(User).all()
    print("count", len(users))
    for u in users:
        print(u.id, u.username, u.is_active, u.hashed_password[:30])
        print("verify", verify_password("InfraGeo@2026", u.hashed_password))
    try:
        authenticate(db, "admin", "InfraGeo@2026")
        print("auth OK")
    except Exception as e:
        print("auth fail", type(e).__name__, e)
finally:
    db.close()
