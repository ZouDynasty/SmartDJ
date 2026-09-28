"""Read-write app database: Google accounts and login sessions.

Kept apart from ``library.sqlite``, which the API opens read-only and the
ingest scripts rebuild, so re-ingesting never signs anyone out.

Create the tables without starting the server::

    .venv/bin/python -m api.db
"""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_APP_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.sqlite"

APP_DB_PATH = Path(os.environ.get("SMARTDJ_APP_DB", DEFAULT_APP_DB_PATH)).expanduser()

SESSION_DAYS = 30

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub      TEXT    NOT NULL UNIQUE,
    email           TEXT    NOT NULL,
    email_verified  INTEGER NOT NULL DEFAULT 0,
    name            TEXT,
    picture_url     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
"""

USER_COLUMNS: tuple[str, ...] = (
    "id",
    "email",
    "email_verified",
    "name",
    "picture_url",
    "created_at",
    "last_login_at",
)


def connect_app_db(db_path: Path = APP_DB_PATH) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(db_path: Path = APP_DB_PATH) -> None:
    """Create the app tables if needed and drop expired sessions."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = connect_app_db(db_path)
    try:
        connection.executescript(SCHEMA)
        connection.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        connection.commit()
    finally:
        connection.close()


def clear_sessions(db_path: Path = APP_DB_PATH) -> None:
    """Sign every user out. Accounts are kept."""
    init_db(db_path)
    connection = connect_app_db(db_path)
    try:
        connection.execute("DELETE FROM sessions")
        connection.commit()
    finally:
        connection.close()


def _row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    user = dict(row)
    user["email_verified"] = bool(user["email_verified"])
    return user


def upsert_google_user(connection: sqlite3.Connection, claims: dict[str, Any]) -> dict[str, Any]:
    """Insert or refresh a user from verified Google ID-token claims.

    Accounts are keyed on ``sub``; Google lets people change their email, so
    email is profile data, not identity.
    """
    connection.execute(
        """
        INSERT INTO users (google_sub, email, email_verified, name, picture_url)
        VALUES (:sub, :email, :email_verified, :name, :picture)
        ON CONFLICT (google_sub) DO UPDATE SET
            email          = excluded.email,
            email_verified = excluded.email_verified,
            name           = excluded.name,
            picture_url    = excluded.picture_url,
            last_login_at  = datetime('now')
        """,
        {
            "sub": claims["sub"],
            "email": claims.get("email") or "",
            "email_verified": 1 if claims.get("email_verified") else 0,
            "name": claims.get("name"),
            "picture": claims.get("picture"),
        },
    )
    row = connection.execute(
        f"SELECT {', '.join(USER_COLUMNS)} FROM users WHERE google_sub = ?",
        (claims["sub"],),
    ).fetchone()
    connection.commit()
    return _row_to_user(row)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(connection: sqlite3.Connection, user_id: int) -> str:
    """Return a new session token. Only its hash is stored, so a leaked
    database cannot be replayed as cookies."""
    token = secrets.token_urlsafe(32)
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) "
        "VALUES (?, ?, datetime('now', ?))",
        (_hash_token(token), user_id, f"+{SESSION_DAYS} days"),
    )
    connection.commit()
    return token


def fetch_session_user(connection: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    row = connection.execute(
        f"SELECT {', '.join('u.' + column for column in USER_COLUMNS)} "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > datetime('now')",
        (_hash_token(token),),
    ).fetchone()
    return _row_to_user(row) if row is not None else None


def delete_session(connection: sqlite3.Connection, token: str) -> None:
    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
    connection.commit()


if __name__ == "__main__":
    init_db()
    print(f"Initialized {APP_DB_PATH}")
