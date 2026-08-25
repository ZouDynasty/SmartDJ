import numpy as np
from typing import Any

from distance import (
    get_bpm_distance,
    get_energy_distance,
    get_genre_distance,
    get_key_distance,
)

class Features:
    def __init__(self, feature_matrix: np.ndarray):
        self.feature_matrix = feature_matrix

    def getFeatureVector(self, candidates: tuple[dict[str, Any], list[dict[str, Any]]]) -> np.ndarray:
        current_track, candidate_list = candidates

        current_bpm = current_track["bpm"]
        current_key = current_track["camelot_key"]
        current_energy = current_track["energy_score"]
        current_genre = current_track["macro_genre"]

        num_candidates = len(candidate_list)
        feature_matrix = np.zeros((num_candidates, 4))

        i = 0;
        for row in candidate_list:
            candidate_bpm = row["bpm"]
            candidate_key = row["camelot_key"]
            candidate_energy = row["energy_score"]
            candidate_genre = row["macro_genre"]



            distance_score = get_bpm_distance(current_bpm, candidate_bpm)
            key_score = get_key_distance(current_key, candidate_key)
            
            if current_energy is None or candidate_energy is None:
                energy_score = 0.0
            else:
                energy_score = get_energy_distance(current_energy, candidate_energy)
            genre_score = get_genre_distance(current_genre, candidate_genre)

            feature_matrix[i] = np.array([distance_score, key_score, energy_score, genre_score])

            i += 1

        self.feature_matrix = feature_matrix
            



