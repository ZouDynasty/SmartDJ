from genre_similarity import MACRO_GENRES, GENRE_LOOKUP

def get_bpm_distance(bpm_a, bpm_b, max_tolerance = 0.10):
    direct_dist = abs(bpm_a - bpm_b) / bpm_a
    double_time_dist = abs(bpm_a - 2 * bpm_b) / bpm_a
    half_time_dist = abs(bpm_a - 0.5 * bpm_b) / bpm_a

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

    if (mode_a == mode_b):
        dist = min(abs(number_b - number_a), 12 - abs(number_b - number_a))
    else:
        dist = min(abs(number_b - number_a), 12 - abs(number_b - number_a)) + 1
    
    return dist / 7

def get_energy_distance(energy_a, energy_b):
    # energy_score spans 0-10, so the largest possible delta is 10.
    # Signed on purpose: the sign says whether the mix lifts or drops.
    return (energy_a - energy_b) / 10

def get_genre_distance(genre_a, genre_b):
    if (
        not genre_a
        or not genre_b
        or genre_a not in MACRO_GENRES
        or genre_b not in MACRO_GENRES
    ):
        return 0.5

    if (genre_a == genre_b):
        return 1.0

    return GENRE_LOOKUP[(genre_a, genre_b)]

BPM_WEIGHT = 0.5
ENERGY_WEIGHT = 0.3
GENRE_WEIGHT = 0.2


def overall_distance(track_a, track_b):
    bpm_cost = get_bpm_distance(track_a["bpm"], track_b["bpm"])

    energy_a = track_a.get("energy_score")
    energy_b = track_b.get("energy_score")
    if energy_a is None or energy_b is None:
        energy_cost = 0.0
    else:
        energy_cost = abs(get_energy_distance(energy_a, energy_b))

    genre_cost = 1.0 - get_genre_distance(
        track_a.get("macro_genre"),
        track_b.get("macro_genre"),
    )

    return (
        BPM_WEIGHT * bpm_cost
        + ENERGY_WEIGHT * energy_cost
        + GENRE_WEIGHT * genre_cost
    )

