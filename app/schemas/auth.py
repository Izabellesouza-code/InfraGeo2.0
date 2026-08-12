"""Schemas de autenticação."""

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=200)


class UserPublic(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str] = None
    is_admin: bool = False
    can_upload: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
