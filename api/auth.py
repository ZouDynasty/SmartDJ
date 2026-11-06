"""Supabase sign-in for the local API.

The browser signs in with Supabase (Google) and sends its access token as
``Authorization: Bearer <token>``. The token is verified here against the
project's public signing keys, so the API holds no Supabase secret.

Configure ``SUPABASE_URL`` in ``.env`` at the project root (see ``.env.example``).

Protect an endpoint with ``Depends(require_user)``.
"""

from __future__ import annotations

import os
import secrets
import ssl
from pathlib import Path
from typing import Any

import certifi
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from itsdangerous import BadSignature, URLSafeTimedSerializer

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1"
SUPABASE_CONFIGURED = bool(SUPABASE_URL)

#: Downloaded on first use and cached, so most requests verify without a
#: network call. certifi supplies CA roots that macOS Pythons often lack.
_signing_keys = (
    jwt.PyJWKClient(
        f"{SUPABASE_ISSUER}/.well-known/jwks.json",
        ssl_context=ssl.create_default_context(cafile=certifi.where()),
    )
    if SUPABASE_CONFIGURED
    else None
)

#: Signs media tokens. A random fallback only invalidates audio and artwork
#: URLs when the server restarts; the page picks up a new one on reload.
MEDIA_TOKEN_SECRET = os.environ.get("MEDIA_TOKEN_SECRET", "").strip() or secrets.token_urlsafe(32)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _supabase_user(access_token: str) -> dict[str, Any] | None:
    """The user in a valid Supabase access token, or ``None`` if any check fails."""
    if _signing_keys is None:
        return None
    try:
        signing_key = _signing_keys.get_signing_key_from_jwt(access_token)
        claims = jwt.decode(
            access_token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=SUPABASE_ISSUER,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        return None
    metadata = claims.get("user_metadata") or {}
    return {
        "id": claims["sub"],
        "email": claims.get("email") or "",
        "name": metadata.get("full_name") or metadata.get("name"),
        "picture_url": metadata.get("avatar_url") or metadata.get("picture"),
    }


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any] | None:
    scheme, _, credentials = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not credentials:
        return None
    return _supabase_user(credentials)


def require_user(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


#: ``<audio>`` and ``<img>`` cannot send an Authorization header, so their URLs
#: carry a signed copy of the user instead. It is not revoked by signing out,
#: hence the short lifetime.
MEDIA_TOKEN_MAX_AGE = 12 * 60 * 60
_media_signer = URLSafeTimedSerializer(MEDIA_TOKEN_SECRET, salt="smartdj-media")


def require_media_user(
    token: str | None = Query(default=None),
    user: dict[str, Any] | None = Depends(current_user),
) -> dict[str, Any]:
    """Bearer token, or a ``?token=`` from ``/auth/me`` for media elements."""
    if user is not None:
        return user
    if token:
        try:
            token_user = _media_signer.loads(token, max_age=MEDIA_TOKEN_MAX_AGE)
        except BadSignature:
            token_user = None
        if isinstance(token_user, dict):
            return token_user
    raise HTTPException(status_code=401, detail="Sign in required")


@router.get("/me")
def me(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    """Signed-in user, or ``null``. Always 200 so the UI can render either state."""
    return {
        "configured": SUPABASE_CONFIGURED,
        "user": user,
        "media_token": _media_signer.dumps(user) if user else None,
    }
