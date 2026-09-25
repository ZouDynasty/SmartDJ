import heapq
from collections.abc import Collection
from typing import Optional

from candidate_retriever import CandidateRetriver
from distance import get_genre_distance, get_key_distance, overall_distance

#: Labeling uses a tight LIMIT; the search needs the full compatible neighborhood
#: or the only bridge to the goal can be hidden.
CANDIDATE_LIMIT = 1000

#: Per-dimension multiplier for a hop that moves toward (or away from) the goal.
TOWARD_GOAL = 0.9
AWAY_FROM_GOAL = 1 / TOWARD_GOAL


def _steer(current_gap: Optional[float], candidate_gap: Optional[float]) -> float:
    if current_gap is None or candidate_gap is None:
        return 1.0
    if candidate_gap < current_gap:
        return TOWARD_GOAL
    if candidate_gap > current_gap:
        return AWAY_FROM_GOAL
    return 1.0


class Nearest_Path:
    def __init__(
        self,
        retriever: CandidateRetriver,
        start_id: int,
        goal_id: int,
        maximum_hops: int = 30,
        genres: Optional[Collection[str]] = None,
    ):
        self.retriever = retriever
        self.start_id = start_id
        self.goal_id = goal_id
        self.maximum_hops = maximum_hops
        #: Intermediate tracks must be in one of these macro genres; the goal is exempt.
        self.genres = set(genres) if genres else None

        goal_track = self.retriever.get_track_by_id(self.goal_id)
        self.goal_key = goal_track["camelot_key"]
        self.goal_energy = goal_track.get("energy_score")
        self.goal_genre = goal_track.get("macro_genre")

        self.visited = set[int]()
        self.neighbors: dict[int, list[dict]] = {}

        self.best_cost: dict[int, float] = {start_id: 0.0}
        self.came_from: dict[int, int] = {}
        self.depth: dict[int, int] = {start_id: 0}


    def _neighbors_of(self, track_id: int) -> list[dict]:
        cached = self.neighbors.get(track_id)
        if cached is not None:
            return cached

        try:
            _current, candidates = self.retriever.retrieve_candidates(
                track_id,
                limit=CANDIDATE_LIMIT,
                genres=self.genres,
                always_include=(self.goal_id,),
            )
        except ValueError:
            candidates = []

        self.neighbors[track_id] = candidates
        return candidates


    def _key_gap(self, track: dict) -> float:
        return get_key_distance(track["camelot_key"], self.goal_key)

    def _energy_gap(self, track: dict) -> Optional[float]:
        energy = track.get("energy_score")
        if energy is None or self.goal_energy is None:
            return None
        return abs(energy - self.goal_energy)

    def _genre_gap(self, track: dict) -> float:
        return 1.0 - get_genre_distance(track.get("macro_genre"), self.goal_genre)

    def _goal_bias(self, current_track: dict, candidate_track: dict) -> float:
        """Reward hops that move key, energy, and genre toward the goal track."""
        return (
            _steer(self._key_gap(current_track), self._key_gap(candidate_track))
            * _steer(self._energy_gap(current_track), self._energy_gap(candidate_track))
            * _steer(self._genre_gap(current_track), self._genre_gap(candidate_track))
        )


    def calculate_path(self):
        min_heap = [(0.0, self.start_id)]

        while min_heap:
            cost, current_id = heapq.heappop(min_heap)

            if current_id in self.visited:
                continue

            self.visited.add(current_id)

            if current_id == self.goal_id:
                break

            if self.depth[current_id] >= self.maximum_hops:
                continue

            current_track = self.retriever.get_track_by_id(current_id)
            if current_track is None:
                continue

            for candidate_track in self._neighbors_of(current_id):
                candidate_id = candidate_track["id"]

                if candidate_id in self.visited:
                    continue

                distance = overall_distance(current_track, candidate_track)
                distance *= self._goal_bias(current_track, candidate_track)

                candidate_cost = cost + distance

                if candidate_cost < self.best_cost.get(candidate_id, float("inf")):
                    self.best_cost[candidate_id] = candidate_cost
                    self.came_from[candidate_id] = current_id

                    self.depth[candidate_id] = self.depth[current_id] + 1

                    neighbor = (candidate_cost, candidate_id)
                    heapq.heappush(min_heap, neighbor)
            

    def get_path(self):
        if self.start_id == self.goal_id:
            return [self.start_id]

        if self.goal_id not in self.came_from:
            return []

        path = []
        current_id = self.goal_id
        while current_id in self.came_from:
            path.append(current_id)
            current_id = self.came_from[current_id]

        path.append(self.start_id)
        path.reverse()
        return path
