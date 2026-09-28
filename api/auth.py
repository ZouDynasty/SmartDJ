"""Google sign-in (OpenID Connect authorization-code flow with PKCE).

Configure through ``.env`` at the project root (see ``.env.example``). In the
Google Cloud console the OAuth client must be a "Web application" with
``GOOGLE_REDIRECT_URI`` listed under Authorized redirect URIs.

Protect an endpoint with ``user: dict = Depends(require_user)``.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth, OAuthError
from dotenv import load_dotenv
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from api.db import (
    SESSION_DAYS,
    connect_app_db,
    create_session,
    delete_session,
    fetch_session_user,
    upsert_google_user,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback"
).strip()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")

#: Signs the short-lived cookie that carries OAuth state/nonce/PKCE between
#: the login redirect and the callback. A random fallback only breaks logins
#: that are mid-flight when the server restarts.
SESSION_SECRET = os.environ.get("SESSION_SECRET", "").strip() or secrets.token_urlsafe(32)

SESSION_COOKIE = "smartdj_session"
OAUTH_STATE_COOKIE = "smartdj_oauth"
COOKIE_SECURE = GOOGLE_REDIRECT_URI.startswith("https://")

GOOGLE_CONFIGURED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

oauth = OAuth()
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def get_app_connection() -> Iterator[sqlite3.Connection]:
    connection = connect_app_db()
    try:
        yield connection
    finally:
        connection.close()


def current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    connection: sqlite3.Connection = Depends(get_app_connection),
) -> dict[str, Any] | None:
    if not session_token:
        return None
    return fetch_session_user(connection, session_token)


def require_user(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def _require_configured() -> None:
    if not GOOGLE_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured: set GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET in .env and restart the API",
        )


def _frontend_redirect(**params: str) -> RedirectResponse:
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(f"{FRONTEND_URL}/{query}", status_code=303)


@router.get("/google/login")
async def google_login(request: Request) -> Response:
    """Send the browser to Google's consent screen."""
    _require_configured()
    return await oauth.google.authorize_redirect(
        request, GOOGLE_REDIRECT_URI, prompt="select_account"
    )


@router.get("/google/callback")
async def google_callback(
    request: Request,
    connection: sqlite3.Connection = Depends(get_app_connection),
) -> Response:
    """Exchange the code, verify the ID token, and start a session."""
    _require_configured()
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as error:
        return _frontend_redirect(auth_error=error.error or "oauth_failed")

    claims = token.get("userinfo")
    if not claims or not claims.get("sub"):
        return _frontend_redirect(auth_error="missing_id_token")

    user = upsert_google_user(connection, dict(claims))
    session_token = create_session(connection, user["id"])

    response = _frontend_redirect()
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/me")
def me(user: dict[str, Any] | None = Depends(current_user)) -> dict[str, Any]:
    """Signed-in user, or ``null``. Always 200 so the UI can render either state."""
    return {"configured": GOOGLE_CONFIGURED, "user": user}


@router.post("/logout", status_code=204)
def logout(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    connection: sqlite3.Connection = Depends(get_app_connection),
) -> Response:
    if session_token:
        delete_session(connection, session_token)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, samesite="lax")
    return response
