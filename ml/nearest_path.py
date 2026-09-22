from SmartDJ.ml import candidate_retriever
from SmartDJ.ml.distance import get_key_distance, overall_distance
from candidate_retriever import CandidateRetriver
import heapq


class Nearest_Path:
    def __init__(self, retriever: CandidateRetriver, start_id: int, goal_id: int, maximum_hops: int = 10):
        self.retriever = retriever
        self.start_id = start_id
        self.goal_id = goal_id
        self.maximum_hops = maximum_hops

        self.goal_key = self.retriever.get_track_by_id(self.goal_id)["camelot_key"]

        self.visited = set[int]()
        self.neighbors: dict[int, list[dict]] = {}
        self.best_cost: dict[int, float] = {start_id: 0.0}
        self.came_from: dict[int, int] = {}
        self.depth: dict[int, int] = {start_id: 0}


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
            candidates = self.retriever.retrieve_candidates(current_id)

            for candidate_track in candidates:
                candidate_id = candidate_track["id"]

                if candidate_id in self.visited:
                    continue

                distance = overall_distance(current_track, candidate_track)


                ## rewarding moving in direction of closer key
                current_key = current_track["camelot_key"]
                candidate_key = candidate_track["camelot_key"]

                current_key_distance = get_key_distance(current_key, self.goal_key)
                candidate_key_distance = get_key_distance(candidate_key, self.goal_key)

                if (candidate_key_distance < current_key_distance):
                    distance = 0.75 * distance
                elif(candidate_key_distance > current_key_distance):
                    distance = 1.33 * distance

                candidate_cost = cost + distance

                if candidate_cost < self.best_cost.get(candidate_id, float("inf")):
                    self.best_cost[candidate_id] = candidate_cost
                    self.came_from[candidate_id] = current_id

                    self.depth[candidate_id] = self.depth[current_id] + 1

                    neighbor = (candidate_cost, candidate_id)
                    heapq.heappush(min_heap, neighbor)
            
            
    def get_path(self):
        path = []   
        current_id = self.goal_id
        while(current_id in self.came_from):
            path.append(current_id)
            current_id = self.came_from[current_id]
        
        path.append(self.start_id)

        return path


        

    
