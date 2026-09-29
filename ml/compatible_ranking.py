from typing import Any

import config
from candidate_retriever import CandidateRetriver
from distance import (
    get_bpm_distance,
    get_energy_distance,
    get_genre_distance,
    get_key_distance,
)


class compatibility_ranking():
    def __init__(
        self,
        retriever: CandidateRetriver,
        current_id: int,
    ):
        self.retriever = retriever
        self.current_id = current_id

    def _distances(self, current: dict[str, Any], candidate: dict[str, Any]) -> dict[str, float]:
        """Per-dimension differences, each 0 (identical) to 1 (least compatible)."""
        bpm = min(get_bpm_distance(current["bpm"], candidate["bpm"]), 1.0)

        key = get_key_distance(current["camelot_key"], candidate["camelot_key"])
        key = min(key / config.RANK_KEY_DISTANCE_SCALE, 1.0)

        energy_a = current.get("energy_score")
        energy_b = candidate.get("energy_score")
        if energy_a is None or energy_b is None:
            energy = config.RANK_MISSING_ENERGY_DISTANCE
        else:
            energy = min(abs(get_energy_distance(energy_a, energy_b)), 1.0)

        genre = 1.0 - get_genre_distance(
            current.get("macro_genre"),
            candidate.get("macro_genre"),
        )

        return {"bpm": bpm, "key": key, "energy": energy, "genre": genre}

    def rank(self) -> list[dict[str, Any]]:
        """Key- and BPM-compatible tracks, most compatible first.

        ``compatibility`` is 1 minus the weighted distance, so 1.0 is a perfect match.
        Raises ``ValueError`` when the current track is missing a key or BPM.
        """
        current, candidates = self.retriever.retrieve_candidates(
            self.current_id,
            limit=config.RANK_CANDIDATE_LIMIT,
        )

        ranked = []
        for candidate in candidates:
            distances = self._distances(current, candidate)
            weighted = (
                config.RANK_BPM_WEIGHT * distances["bpm"]
                + config.RANK_KEY_WEIGHT * distances["key"]
                + config.RANK_ENERGY_WEIGHT * distances["energy"]
                + config.RANK_GENRE_WEIGHT * distances["genre"]
            )
            ranked.append({
                "id": candidate["id"],
                "compatibility": max(0.0, 1.0 - weighted),
                "bpm_distance": distances["bpm"],
                "key_distance": distances["key"],
                "energy_distance": distances["energy"],
                "genre_distance": distances["genre"],
            })

        ranked.sort(key=lambda row: (-row["compatibility"], row["id"]))
        return ranked
