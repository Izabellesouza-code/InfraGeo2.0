"""Cria ou atualiza um usuário com permissão de upload em public.users.

Uso:
  set PYTHONPATH=.
  .venv\\Scripts\\python scripts/create_upload_user.py izabelle "sua_senha"

Opções:
  --admin   também marca is_admin=True
"""

from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

load_dotenv(".env", override=True)

from app.config import get_settings
from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import User
from app.services.auth_service import ensure_auth_ready


def main() -> int:
    parser = argparse.ArgumentParser(description="Cria usuário de upload")
    parser.add_argument("username")
    parser.add_argument("password")
    parser.add_argument("--email", default="")
    parser.add_argument("--admin", action="store_true")
    args = parser.parse_args()

    get_settings.cache_clear()
    username = args.username.strip()
    password = args.password
    if not username or not password:
        print("username e password são obrigatórios", file=sys.stderr)
        return 1

    email = (args.email or f"{username}@infrageo.local").strip()
    db = SessionLocal()
    try:
        ensure_auth_ready(db)
        user = db.query(User).filter(User.username == username).first()
        if user:
            user.hashed_password = hash_password(password)
            user.email = email
            user.is_active = True
            user.can_upload = True
            if args.admin:
                user.is_admin = True
            action = "atualizado"
        else:
            user = User(
                username=username,
                email=email,
                hashed_password=hash_password(password),
                full_name=username,
                is_active=True,
                is_admin=bool(args.admin),
                can_upload=True,
            )
            db.add(user)
            action = "criado"
        db.commit()
        print(
            f"OK: usuário {username!r} {action} "
            f"(can_upload=True, is_admin={bool(user.is_admin)})"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
