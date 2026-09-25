"""Schemas de autenticação."""

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)


class RecoverPasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    nome: str = Field(..., min_length=2, max_length=200)
    new_password: str = Field(..., min_length=6, max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(..., min_length=6, max_length=200)


class UserPublic(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str] = None
    is_admin: bool = False
    can_upload: bool = False
    is_active: bool = True
    must_change_password: bool = False


class CreateUserRequest(BaseModel):
    nome: str = Field(..., min_length=2, max_length=200)
    email: str = Field(..., min_length=3, max_length=200)
    password: Optional[str] = Field(default=None, max_length=200)
    is_admin: bool = False
    can_upload: bool = True


class CreatedUserResponse(UserPublic):
    temporary_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=6, max_length=200)


class UpdateUserRequest(BaseModel):
    nome: Optional[str] = Field(default=None, min_length=2, max_length=200)
    email: Optional[str] = Field(default=None, min_length=3, max_length=200)
    password: Optional[str] = Field(default=None, min_length=6, max_length=200)
    is_admin: Optional[bool] = None
    can_upload: Optional[bool] = None
    is_active: Optional[bool] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
