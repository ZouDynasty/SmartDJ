# Mix transition labeling rubric

Rate how feasible it is to mix **from the seed track into the candidate**. You are labeling the *transition*, not whether the candidate is a good song.

Scores feed a LightGBM LambdaMART ranker. Be consistent. If you are unsure between two scores, pick the **lower** one.

## Scale

| Score | Name | Use when |
| --- | --- | --- |
| **0** | Hard clash / unmixable | You would not mix these. Phrase collision, incompatible energy, genre that would empty the floor, or a harmonic/BPM relationship that only looks legal on paper. |
| **1** | Technically compatible, but awkward | Camelot and BPM say it is legal, but the mix would feel forced: leftover vocal clash, energy jump that needs a long EQ fade, or a genre pivot that only works as a novelty. |
| **2** | Good standard blend | A mix you would actually do in a normal set. Clean harmonic move, BPM close enough to pitch-blend, energy and genre sit in the same story. Not a peak moment, just solid DJing. |
| **3** | Signature / peak transition | A mix you would save for a highlight: same or perfectly adjacent key, BPM lock (including exact half/double time), energy that lifts or settles on purpose, genre that continues or completes the phrase. |

## Commands

| Input | Meaning |
| --- | --- |
| `0` `1` `2` `3` | Save that relevance for this seed → candidate pair. Re-rating the same pair **replaces** the old score. |
| `s` | Skip the rest of this seed. Already-rated pairs this session stay in the open transaction. |
| `q` | Quit and **commit** the session. `Ctrl+C` rolls back uncommitted labels. |

## What you are shown

Each candidate includes:

- **BPM difference** — raw BPM delta and the normalized mix distance (0 is a lock; 1 is the edge of the 10% / half-time / double-time window).
- **Key difference** — Camelot move and normalized key distance (`0` = same key, `1/7` = one allowed step).
- **Energy difference** — candidate minus seed on the 0–10 scale (`n/a` if either track is missing energy).
- **Genre match** — same macro genre vs a shift. Missing tags are marked unknown.

The tool samples a **spread**, not only near-clones:

1. **Close harmonic** — same or adjacent Camelot, nearly exact BPM.
2. **Energy / genre shift** — same key, but a different macro genre or an energy gap of about 1.5+.
3. **Boundary** — near the 10% BPM limit or a ±1 Camelot step.

Rate the mix you hear in your head, not whether the sampler put the track in a clever bucket.

## Calibration examples

**0** — Same BPM window, but a full-vocal pop radio cut into a dark club groove; or keys that are “adjacent” while the basslines fight.

**1** — House into adjacent-key techno that works if you dump the lows and talk over it, but you would not trust it mid-set.

**2** — 8A 128 into 9A 126 of the same macro genre, energy within about a point. The bread-and-butter mix.

**3** — Locked BPM, same Camelot or relative major/minor, energy that rises into a drop, genre that stays in the lane. The mix you would clip for a demo.

## Consistency rules

- Label **seed → candidate** only. Do not reverse it in your head unless that is the pair on screen.
- Vocals vs instrumentals: two stacked full vocals are usually a 0 or 1 even when key/BPM are perfect.
- Half-time / double-time that *grooves* can still be a 2 or 3. Half-time that only matches on a spreadsheet is a 1.
- Missing energy or genre: ignore the missing field and score from BPM, key, and what you know of the tracks.
- Do not score a 3 because you like the candidate. Score the **blend**.
