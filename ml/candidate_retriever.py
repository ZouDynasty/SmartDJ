import sqlite3
from typing import Any, Optional

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
               "key", camelot_key, energy_score, genre as macro_genre
        FROM tracks
        WHERE id = ?
        """

        with self.get_connection() as conn:
            row = conn.execute(query, (track_id,)).fetchone()
            return dict(row) if row is not None else None

    def retrieve_candidates(self, track_id: int, limit = 100, max_bpm_tolerance = 0.10) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        current_track = self.get_track_by_id(track_id)
        if (not current_track):
            raise ValueError("track id does not exist")

        if (not current_track["camelot_key"]):
            raise ValueError("current track has no camelot key")
        if (not current_track["bpm"]):
            raise ValueError("current track has no bpm")

        current_key = current_track.get("camelot_key")
        current_bpm = current_track.get("bpm")

        conn = self.get_connection()

        try:
            conn.create_function("KEY_DISTANCE", 2, distance.get_key_distance)
            conn.create_function("BPM_DISTANCE", 3, distance.get_bpm_distance)

            query = """
            SELECT id, file_path, title, artist, duration, bpm,
                "key", camelot_key, energy_score, genre as macro_genre
            FROM tracks
            WHERE camelot_key IS NOT NULL
            AND trim(camelot_key) != ''
            AND bpm IS NOT NULL
            AND KEY_DISTANCE(?, camelot_key) <= 1.0/7.0
            AND BPM_DISTANCE(?, bpm, ?) <= 1
            AND id != ?
            LIMIT ?
            """

            candidates = conn.execute(query, (current_key, current_bpm, max_bpm_tolerance, current_track["id"], limit)).fetchall()
            candidate_list = [dict(row) for row in candidates]
            return (current_track, candidate_list)
        
        finally:
            conn.close()
        



