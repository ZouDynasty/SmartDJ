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


