# 04 — Cellular automaton tuning research

> Captured 2026-05-01 against `v2.4.0`. Source probes:
> `tests/core/algorithms/CellularAutomaton.probe.test.ts`.

This doc records what each tunable parameter actually does at the
boundary, what the safe ranges are, and which interactions the
sim does NOT simulate (so users don't expect them).

---

## Tunable parameters

| Parameter | Type | Default in demo 09 | Safe range |
|---|---|---|---|
| `FLUID_FLOW_DIST` | module constant | `4` | `1..16` |
| `Material.burnDuration` | per-material | `40` | `2..256` |
| `Material.settleAfterTicks` | per-material | `30` | `1..256` |

`FLUID_FLOW_DIST` is currently a module-private constant in
`src/core/algorithms/CellularAutomaton.ts:138`. If users need
finer control (e.g. honey vs water), the cleanest extension is
to make it a per-`Material` override read by `stepFluid`.

---

## `burnDuration` boundary behavior

The condition that kills a fire cell each tick is:

```
if (current + 1 >= burnDuration) bitmap.setPixel(x, y, 0);
```

| `burnDuration` | What happens | Notes |
|---|---|---|
| `0` | Dies on step 0 | `0+1 >= 0` is `true` immediately. |
| `1` | Dies on step 0 | `0+1 >= 1` is `true`. |
| `2` | Dies on step 1 | One step of "alive after the tick." |
| `20` | Dies on step 19 | Lives 19 ticks post-tick (matches existing test). |
| `255` | Dies on step 254 | Last value before saturation kicks in. |
| `256` | Dies on step 255 | Timer saturates at 255; `255+1 >= 256` true. |
| **`257+`** | **Burns forever** ⚠️ | Timer saturates at 255; `255+1=256` is never `≥ 257`. |

### Recommendation

- **Users**: clamp `burnDuration ≤ 256` at registration time. The
  existing demo's `40` is well inside the safe band.
- **Library**: consider adding a runtime check in `MaterialRegistry.register`
  that throws if `burnDuration > 256`, OR clamps with a console
  warning. The current TSDoc on `burnDuration` mentions the cap
  but doesn't enforce it. **Action item**: enforce or warn.

### Off-by-one note

`burnDuration` reads as "lifetime in ticks" but the death step
is `burnDuration - 1` (the cell dies *during* that step, not
*after* it). For a fire that should be visibly alive for `N`
ticks, set `burnDuration = N + 1`. The TSDoc on
`Material.burnDuration` already says "Lifetime in ticks" — the
off-by-one isn't actively misleading, but a worked example in
the doc would help.

---

## `settleAfterTicks` boundary behavior

Identical condition shape and identical gotchas:

| `settleAfterTicks` | What happens |
|---|---|
| `0` | Promotes on first stationary tick (`0+1 >= 0`). |
| `1` | Promotes on first stationary tick. |
| `30` | Promotes after 30 stationary ticks (~0.5 s at 60 fps — the demo default). |
| `255` | Promotes on tick 254. |
| **`257+`** | **Never promotes** ⚠️ — same uint8 saturation. |

The same enforce-or-warn action item applies. Same off-by-one.

---

## Density-rank interactions: full cross-table

Vertical swap rule:

- **Down-moving** fluid swaps with target if `srcRank > targetRank`.
- **Up-moving** fluid swaps with target if `srcRank < targetRank`.
- **Static** targets reject regardless.

Ranks: `gas (0) < air (1) < fire (2) < oil (3) < water (4) < sand (5)`.

| Above (src) ↓ \ Below (target) → | air | gas | fire | oil | water | sand | static |
|---|---|---|---|---|---|---|---|
| **sand** (5, falls) | swap | swap | swap | swap | swap | — | reject |
| **water** (4, falls) | swap | swap | swap | swap | — | — | reject |
| **oil** (3, falls) | swap | swap | swap | — | — | — | reject |
| **gas** (0, rises) | — | — | rises into above (rank 1) | rises into above (rank 3) | rises into above (rank 4) | rises into above (rank 5) | reject |
| **fire** (2, no self-motion) | — | — | — | — | — | — | — |

Empty cells in the falls/rises rows = same rank or wrong direction:
no swap. The `—` for gas's "below" row reflects that gas only
ever attempts upward swaps; `stepFluid` with `yDir=-1` examines
the cell *above*, so the "below" axis here is read as "what's
between gas and the surface it's rising toward" — gas always
displaces lighter-or-equal cells **above** it.

### Documented (perhaps surprising) consequences

1. **Fire is displaceable.** Fire's `simulation` is `'fire'`, not
   `'static'`. Density swaps from neighboring fluids treat fire
   as a normal rank-2 cell and may push it around:
   - Gas below fire → gas rises *through* the fire cell, fire
     ends up one row lower.
   - Water above fire → water sinks *into* the fire cell, fire
     ends up one row higher.
   - Sand above fire → sand sinks into fire, fire pushed up.

   **No water-extinguishes-fire interaction.** That's a future
   feature if you want it; the current sim is purely density-
   ordered. (Implementation note: the cleanest place would be a
   new branch in `canVerticalSwap` or a post-swap hook —
   "displaced fire transitions to steam/air on contact with
   water/oil/sand.")

2. **Fire is flammable-only via the `flammable` flag**, not by
   simulation kind. A `'sand'`-simulation material with
   `flammable: true` can be ignited mid-fall — the resulting
   fire cell stays put because fire's simulation kind is
   `'fire'`, not `'sand'`. Surprising but probably what you'd
   want (a burning sand grain stops falling).

3. **Same-rank fluids never swap.** Water on water, oil on oil,
   sand on sand — all stable stacks. Mobile fluids sit on top
   of their own kind without any visible flow until something
   else (carve, density-different fluid, gas bubble) breaks
   the column.

---

## Multi-cell horizontal flow rate vs column height

`FLUID_FLOW_DIST = 4` produces this leveling profile (water
column poured onto a flat stone floor wide enough to fit the
whole column on one row):

| Column height | Floor width | Ticks to fully flatten |
|---|---|---|
| 5 | 41 | 4 |
| 10 | 41 | 9 |
| 20 | 41 | 19 |
| 40 | 41 | 54 |

Roughly linear up to ~20 cells, then super-linear because the
width-half (~20 cells from center) exceeds what one tick of
`FLUID_FLOW_DIST=4` can spread, so the leading edge of the
spreading puddle re-piles before the column fully drains.

### Recommendation

- For pools narrower than `2 × FLUID_FLOW_DIST × column_height`,
  expect leveling time roughly `column_height` ticks.
- For wider pools, leveling time grows non-linearly. If users
  are unhappy with the "puddle takes forever to flatten" feel
  on wide pools, expose `FLUID_FLOW_DIST` per-material and
  default specific liquids to higher values (e.g. `water=4`,
  `lava=2`, `oil=3`).

---

## Performance sanity checks (informal)

`v2.4` active-cell tracking changes step cost from
`O(W×H)` to `O(N log N)` where `N` is the number of cells in
the active set. Empirical observations from the probe runs
(measured implicitly by Vitest runtime — no formal benchmark):

- 1×1 fire cell with `burnDuration=300` ran 300 steps in <5 ms
  total. Effectively free.
- 5-fluid 6-cell stack reached equilibrium in ~30 steps; total
  test runtime <1 ms.
- 5×5 fire-on-wood (25 cells) consumed in 23 steps; total
  test runtime ~1 ms.
- 40-cell water column on a 41-wide world flattens in 54
  ticks with hundreds of moving cells; total test runtime
  ~10 ms (≈ 200 µs per step).

A formal benchmark fixture would help track regressions. Open
v2.4 follow-up: `tests/perf/CellularAutomaton.bench.ts` that
asserts upper bounds on step cost for canonical scenarios.

---

## Open action items

1. ✅ **Enforce `burnDuration ∈ [1, 256]`** at material registration
   — landed in v2.6.1. `MaterialRegistry.register` throws on
   out-of-range values, missing `burnDuration` for `'fire'`
   materials, and non-integer thresholds.
2. ✅ **Same for `settleAfterTicks`** — landed in v2.6.1. Throws
   when `settlesTo` is set without `settleAfterTicks`, or when
   the threshold is outside `1..256`.
3. **Worked example in TSDoc** for `burnDuration` and
   `settleAfterTicks` clarifying the off-by-one.
4. ✅ **Per-material `flowDistance`** — landed in v2.7.0.
   `Material.flowDistance?: number` (validated `0..16` at
   registration) overrides the module-default `4` so users
   can tune lava=2, water=4, gas=6, etc. independently. Sand
   still hard-codes `0` (no horizontal flow).
5. **Optional `'fire' + 'water' → 'air'` reaction** if the
   density-swap-only behavior surprises users. Pure feature, not
   a bug fix.
6. **Formal benchmark fixture** for v2.4 step cost.

Items 3, 5, 6 remain opt-in improvements; not v2.x blockers.
