"""Login system routes: signup, login, me, logout.

Backend-only for this pass (no frontend login screen yet, per plan). Sessions
are opaque bearer tokens: `Authorization: Bearer <token>`.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from ..models import AuthResponse, LoginRequest, SignupRequest, UserOut
from ..services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(user: auth_service.User) -> UserOut:
    return UserOut(id=user.id, email=user.email, created_at=user.created_at.isoformat())


def get_current_user(authorization: Optional[str] = Header(None)) -> auth_service.User:
    """Required-auth dependency: 401s if there's no valid session."""
    user = get_optional_user(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Missing or invalid session token.")
    return user


def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[auth_service.User]:
    """Best-effort auth: returns None instead of 401ing when absent/invalid.

    Used on routes (redo/select) that must keep working for anonymous/demo
    traffic - a logged-in caller just gets their creative-memory rows tagged
    with their user_id for later aggregation.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        return auth_service.get_user_by_token(token)
    except auth_service.AuthUnavailable:
        return None


@router.post("/signup", response_model=AuthResponse)
def signup(req: SignupRequest) -> AuthResponse:
    try:
        user, token = auth_service.sign_up(req.email, req.password)
    except auth_service.EmailAlreadyRegistered as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except auth_service.AuthUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AuthResponse(token=token, user=_user_out(user))


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest) -> AuthResponse:
    try:
        user, token = auth_service.log_in(req.email, req.password)
    except auth_service.InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except auth_service.AuthUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return AuthResponse(token=token, user=_user_out(user))


@router.get("/me", response_model=UserOut)
def me(authorization: Optional[str] = Header(None)) -> UserOut:
    return _user_out(get_current_user(authorization))


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)) -> dict:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            auth_service.log_out(token)
        except auth_service.AuthUnavailable:
            pass  # already effectively logged out if TigerData is down
    return {"status": "ok"}
