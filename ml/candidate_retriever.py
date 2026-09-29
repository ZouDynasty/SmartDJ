import sqlite3
from collections.abc import Collection
from typing import Any, Optional

import config
import distance
 
class CandidateRetriver:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Access columns by name
        return conn

    def get_track_by_id(self, track_id: int) -> Optional[dict]:
        query = """
        SELECT id, file_path, title, artist, duration, bpm,
               "key", camelot_key, energy_score, macro_genre
        FROM tracks
        WHERE id = ?
        """

        with self.get_connection() as conn:
            row = conn.execute(query, (track_id,)).fetchone()
            return dict(row) if row is not None else None

    def retrieve_candidates(
        self,
        track_id: int,
        limit = config.CANDIDATE_LIMIT,
        max_bpm_tolerance = config.MAX_BPM_TOLERANCE,
        genres: Optional[Collection[str]] = None,
        always_include: Collection[int] = (),
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Mixable neighbours of ``track_id``.

        ``genres`` restricts candidates to those macro genres; ids in
        ``always_include`` bypass that filter (but not key / BPM compatibility).
        """
        current_track = self.get_track_by_id(track_id)
        if (not current_track):
            raise ValueError("track id does not exist")

        if (not current_track["camelot_key"]):
            raise ValueError("current track has no camelot key")
        if (not current_track["bpm"]):
            raise ValueError("current track has no bpm")

        current_key = current_track.get("camelot_key")
        current_bpm = current_track.get("bpm")

        genre_clause = ""
        genre_params: list[Any] = []
        if genres:
            genre_list = list(genres)
            include_list = list(always_include)
            genre_clause = f"AND (macro_genre IN ({','.join('?' * len(genre_list))})"
            if include_list:
                genre_clause += f" OR id IN ({','.join('?' * len(include_list))})"
            genre_clause += ")"
            genre_params = genre_list + include_list

        conn = self.get_connection()

        try:
            conn.create_function("KEY_DISTANCE", 2, distance.get_key_distance)
            conn.create_function("BPM_DISTANCE", 3, distance.get_bpm_distance)

            query = f"""
            SELECT id, file_path, title, artist, duration, bpm,
                "key", camelot_key, energy_score, macro_genre
            FROM tracks
            WHERE camelot_key IS NOT NULL
            AND trim(camelot_key) != ''
            AND bpm IS NOT NULL
            {genre_clause}
            AND KEY_DISTANCE(?, camelot_key) <= ?
            AND BPM_DISTANCE(?, bpm, ?) <= ?
            AND id != ?
            LIMIT ?
            """

            params = (
                *genre_params,
                current_key,
                config.MAX_KEY_DISTANCE,
                current_bpm,
                max_bpm_tolerance,
                config.MAX_NORMALIZED_BPM_DISTANCE,
                current_track["id"],
                limit,
            )
            candidates = conn.execute(query, params).fetchall()
            candidate_list = [dict(row) for row in candidates]
            return (current_track, candidate_list)
        
        finally:
            conn.close()
