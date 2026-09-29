import config
from genre_similarity import MACRO_GENRES, GENRE_LOOKUP

def get_bpm_distance(bpm_a, bpm_b, max_tolerance = config.MAX_BPM_TOLERANCE):
    direct_dist = abs(bpm_a - bpm_b) / bpm_a
    double_time_dist = abs(bpm_a - config.DOUBLE_TIME_RATIO * bpm_b) / bpm_a
    half_time_dist = abs(bpm_a - config.HALF_TIME_RATIO * bpm_b) / bpm_a

    best_delta = min(direct_dist, double_time_dist, half_time_dist)

    normalized_dist = best_delta / max_tolerance
    return normalized_dist

def get_key_distance(key_a, key_b):
    key_a = key_a.strip()
    key_b = key_b.strip()
    number_a = int(key_a[:-1])
    mode_a = key_a[-1].upper()

    number_b = int(key_b[:-1])
    mode_b = key_b[-1].upper()

    wheel = config.CAMELOT_WHEEL_SIZE
    if (mode_a == mode_b):
        dist = min(abs(number_b - number_a), wheel - abs(number_b - number_a))
    else:
        dist = min(abs(number_b - number_a), wheel - abs(number_b - number_a)) + config.KEY_MODE_CHANGE_PENALTY
    
    return dist / config.KEY_DISTANCE_NORMALIZER

def get_energy_distance(energy_a, energy_b):
    # Signed on purpose: the sign says whether the mix lifts or drops.
    return (energy_a - energy_b) / config.ENERGY_SCALE

def get_genre_distance(genre_a, genre_b):
    if (
        not genre_a
        or not genre_b
        or genre_a not in MACRO_GENRES
        or genre_b not in MACRO_GENRES
    ):
        return config.UNKNOWN_GENRE_SIMILARITY

    if (genre_a == genre_b):
        return config.SAME_GENRE_SIMILARITY

    return GENRE_LOOKUP[(genre_a, genre_b)]


def overall_distance(track_a, track_b):
    bpm_cost = get_bpm_distance(track_a["bpm"], track_b["bpm"])

    energy_a = track_a.get("energy_score")
    energy_b = track_b.get("energy_score")
    if energy_a is None or energy_b is None:
        energy_cost = config.MISSING_ENERGY_COST
    else:
        energy_cost = abs(get_energy_distance(energy_a, energy_b))

    genre_cost = 1.0 - get_genre_distance(
        track_a.get("macro_genre"),
        track_b.get("macro_genre"),
    )

    return (
        config.BPM_WEIGHT * bpm_cost
        + config.ENERGY_WEIGHT * energy_cost
        + config.GENRE_WEIGHT * genre_cost
    )
