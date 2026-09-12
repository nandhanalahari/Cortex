"""Login system: email + password accounts, backed by TigerData.

Deliberately the OPPOSITE failure philosophy from memory_service.py. That
service degrades silently (a missing creative-memory match is invisible and
harmless). Auth must fail CLOSED: if TigerData is unreachable, signup/login
raise AuthUnavailable rather than falling back to an in-memory store that
would forget every account on restart and can never be treated as a real
system of record for who-is-who. There is no OFFLINE_MODE bypass here.

Sessions are opaque bearer tokens (not JWTs) stored in a `sessions` table, so
"log out everywhere" / revocation is a single DELETE - no signing-key or
stateless-invalidation machinery needed for a hackathon build.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt

from ..config import settings

SESSION_TTL = timedelta(days=settings.SESSION_TTL_DAYS)


class AuthError(Exception):
    """Base class for expected auth failures (safe to show to the client)."""


class AuthUnavailable(AuthError):
    """TigerData isn't configured or isn't reachable. Fail closed, not open."""


class EmailAlreadyRegistered(AuthError):
    pass


class InvalidCredentials(AuthError):
    pass


@dataclass
class User:
    id: int
    email: str
    created_at: datetime


def _connect():
    if not settings.TIGERDATA_CONNECTION_STRING:
        raise AuthUnavailable("TigerData is not configured (TIGER_DATABASE_URL unset).")
    try:
        import psycopg

        return psycopg.connect(settings.TIGERDATA_CONNECTION_STRING, connect_timeout=5)
    except Exception as exc:  # noqa: BLE001
        raise AuthUnavailable(f"Could not reach TigerData: {exc}") from exc


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def _verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))


def sign_up(email: str, password: str) -> tuple[User, str]:
    """Create an account and an initial session. Raises on any failure."""
    email = email.strip().lower()
    if "@" not in email or len(email) < 3:
        raise AuthError("Enter a valid email address.")
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters.")

    password_hash = _hash_password(password)
    with _connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if cur.fetchone() is not None:
            raise EmailAlreadyRegistered(f"{email} is already registered.")

        cur.execute(
            """
            INSERT INTO users (email, password_hash)
            VALUES (%s, %s)
            RETURNING id, email, created_at
            """,
            (email, password_hash),
        )
        row = cur.fetchone()
        user = User(id=row[0], email=row[1], created_at=row[2])
        token = _create_session(cur, user.id)
        conn.commit()
        return user, token


def log_in(email: str, password: str) -> tuple[User, str]:
    email = email.strip().lower()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = %s",
            (email,),
        )
        row = cur.fetchone()
        if row is None or not _verify_password(password, row[2]):
            raise InvalidCredentials("Incorrect email or password.")

        user = User(id=row[0], email=row[1], created_at=row[3])
        token = _create_session(cur, user.id)
        conn.commit()
        return user, token


def _create_session(cur, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + SESSION_TTL
    cur.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
        (token, user_id, expires_at),
    )
    return token


def get_user_by_token(token: str) -> Optional[User]:
    """Return the owning user for a valid, unexpired session token, else None."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.email, u.created_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > now()
            """,
            (token,),
        )
        row = cur.fetchone()
        return User(id=row[0], email=row[1], created_at=row[2]) if row else None


def log_out(token: str) -> None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM sessions WHERE token = %s", (token,))
        conn.commit()
