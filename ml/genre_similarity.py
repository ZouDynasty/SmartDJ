MACRO_GENRES = [
    "Pop & Mainstream",
    "Hip Hop & Urban",
    "House & EDM",
    "Bass Music",
    "K-Pop & Asian",
    "Rock & Alternative",
    "Latin & Global",
    "Roots & Folk",
]

PAIRWISE_SIMILARITY: dict[tuple[str, str], float] = {

    ("Pop & Mainstream", "K-Pop & Asian"): 0.8,
    ("Pop & Mainstream", "House & EDM"): 0.6,
    ("Pop & Mainstream", "Hip Hop & Urban"): 0.5,
    ("Pop & Mainstream", "Latin & Global"): 0.5,
    ("Pop & Mainstream", "Rock & Alternative"): 0.4,
    ("Pop & Mainstream", "Bass Music"): 0.3,
    ("Pop & Mainstream", "Roots & Folk"): 0.3,

    ("Hip Hop & Urban", "Bass Music"): 0.5,
    ("Hip Hop & Urban", "Latin & Global"): 0.6,
    ("Hip Hop & Urban", "K-Pop & Asian"): 0.4,
    ("Hip Hop & Urban", "House & EDM"): 0.3,
    ("Hip Hop & Urban", "Rock & Alternative"): 0.3,
    ("Hip Hop & Urban", "Roots & Folk"): 0.2,

    ("House & EDM", "Bass Music"): 0.8,
    ("House & EDM", "K-Pop & Asian"): 0.5,
    ("House & EDM", "Latin & Global"): 0.4,
    ("House & EDM", "Rock & Alternative"): 0.2,
    ("House & EDM", "Roots & Folk"): 0.1,

    ("Bass Music", "K-Pop & Asian"): 0.4,
    ("Bass Music", "Latin & Global"): 0.4,
    ("Bass Music", "Rock & Alternative"): 0.3,
    ("Bass Music", "Roots & Folk"): 0.1,

    ("K-Pop & Asian", "Rock & Alternative"): 0.3,
    ("K-Pop & Asian", "Latin & Global"): 0.4,
    ("K-Pop & Asian", "Roots & Folk"): 0.2,

    ("Rock & Alternative", "Roots & Folk"): 0.5,
    ("Rock & Alternative", "Latin & Global"): 0.2,

    ("Latin & Global", "Roots & Folk"): 0.3,
}

def build_symmetric_lookup(pairs: dict[tuple[str, str], float],) -> dict[tuple[str, str], float]:
    lookup = {}
    for (g1, g2), score in pairs.items():
        lookup[(g1, g2)] = score
        lookup[(g2, g1)] = score
    return lookup

GENRE_LOOKUP = build_symmetric_lookup(PAIRWISE_SIMILARITY)
