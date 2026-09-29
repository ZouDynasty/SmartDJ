"""Tunable parameters for SmartDJ's ml algorithms."""

# --- Candidate retrieval (candidate_retriever.py) ---------------------------

CANDIDATE_LIMIT = 100               # max candidates returned per track
MAX_BPM_TOLERANCE = 0.10            # allowed BPM difference (±10%)
MAX_NORMALIZED_BPM_DISTANCE = 1.0   # 1.0 = anywhere within the BPM tolerance

# --- Distance functions (distance.py) ---------------------------------------

DOUBLE_TIME_RATIO = 2.0             # match tracks at double tempo
HALF_TIME_RATIO = 0.5               # match tracks at half tempo
CAMELOT_WHEEL_SIZE = 12             # positions on the Camelot wheel
KEY_MODE_CHANGE_PENALTY = 1         # extra step for switching minor/major
KEY_DISTANCE_NORMALIZER = 7         # largest key distance in steps; scales it to 0-1
KEY_STEP = 1.0 / KEY_DISTANCE_NORMALIZER  # key distance of one Camelot step
MAX_KEY_DISTANCE = KEY_STEP         # candidates must be same key or one step away
ENERGY_SCALE = 10.0                 # energy_score range (0-10)
SAME_GENRE_SIMILARITY = 1.0         # similarity of identical genres
UNKNOWN_GENRE_SIMILARITY = 0.5      # similarity when a genre is missing

# --- Transition cost (distance.overall_distance) ----------------------------

BPM_WEIGHT = 0.4                    # weight of tempo difference
ENERGY_WEIGHT = 0.2                 # weight of energy difference
GENRE_WEIGHT = 0.4                  # weight of genre difference
MISSING_ENERGY_COST = 0.5           # energy cost when energy is unknown

# --- Shortest mixing path (nearest_path.py) ---------------------------------

PATH_CANDIDATE_LIMIT = 1000         # neighbours fetched per track in the search
PATH_MAX_HOPS = 30                  # default max transitions (the API sets its own)
TOWARD_GOAL_MULTIPLIER = 0.9        # cost discount for moving toward the goal
AWAY_FROM_GOAL_MULTIPLIER = 1 / TOWARD_GOAL_MULTIPLIER  # penalty for moving away

# --- Compatibility ranking (compatible_ranking.py) --------------------------

RANK_CANDIDATE_LIMIT = -1           # candidates to rank (-1 = all compatible)
RANK_BPM_WEIGHT = 0.2               # weight of tempo difference
RANK_KEY_WEIGHT = 0.3               # weight of key difference
RANK_ENERGY_WEIGHT = 0.2            # weight of energy difference
RANK_GENRE_WEIGHT = 0.3             # weight of genre difference
RANK_KEY_DISTANCE_SCALE = MAX_KEY_DISTANCE  # key distance that counts as fully different
RANK_MISSING_ENERGY_DISTANCE = 0.5  # energy difference assumed when energy is unknown

# --- Ranking features (features.py) -----------------------------------------

MISSING_ENERGY_FEATURE = 0.0        # energy feature when energy is unknown

# --- Transition labeler (labeling.py) ---------------------------------------

LABEL_TARGET_PER_BUCKET = 2         # candidates per bucket (close/shift/boundary)
LABEL_MIN_SAMPLE = 4                # skip seeds with fewer candidates
LABEL_MAX_SAMPLE = 6                # max candidates shown per seed
LABEL_EXACT_BPM_DISTANCE = 0.05     # BPM distance counted as "exact tempo"
LABEL_BOUNDARY_BPM_DISTANCE = 0.75  # BPM distance counted as "boundary"
LABEL_ENERGY_GAP = 1.4              # energy change counted as an "energy shift"
