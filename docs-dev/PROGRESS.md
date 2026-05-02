# Progress

Running ledger of what's done, what's in flight, and what's broken. Read alongside `CLAUDE.md` and `02-roadmap.md` to catch up at the start of a session.

> Last updated: 2026-05-02, v3.1.8 always-on pool detection + bottom-up fill

---

## Open issues

(none — v3.1.2 closed the fall-column-as-wall issue.)

---

## At a glance

| Phase | Status | Tag |
|---|---|---|
| 0 — bootstrap | ✅ done | — |
| 1 — core engine | ✅ done | `v0.1.0` |
| 2 — physics adapter | ✅ done | `v0.2.0` |
| ~~2.5 — cross-chunk stitching~~ | retired (subsumed by per-chunk + polygon model) | `v0.2.5` |
| 3 — Phaser integration | ✅ done | `v0.3.0` |
| 4 — examples | ✅ done | `v0.4.0` |
| 5 — docs & polish | ✅ done | `v1.0.0` |
| v1.x — sprite transforms + jitter fix | ✅ done | `v1.1.0` |
| v2 — falling-sand cellular automaton | ✅ initial release | `v2.0.0` |
| v2.x — water + density swap | ✅ done | `v2.1.0` |
| v2.x — dev-server media fix | ✅ done | `v2.1.1` |
| v2.2 — sand-pile-becomes-static (settling) | ✅ done | `v2.2.0` |
| v2.3 — more fluid kinds (gas / oil / fire) + multi-cell flow | ✅ done | `v2.3.0` |
| v2.4 — active-cell tracking (perf) | ✅ done | `v2.4.0` |
| ~~v2.5 — VitePress concept-and-recipes site + tutorial~~ | retired (existing docs cover the gap; replaced by v2.5/v2.6 below) | — |
| v2.5 — sim tuning research + simulation concepts doc | ✅ done | — |
| v2.6 — in-demo code-snippet tutorials (per-demo + recipes index) | ✅ done | `v2.6.0` |
| v2.6.1 — enforce timer-uint8 ranges at material registration | ✅ done | `v2.6.1` |
| v2.6.2 — fix gas leveling oscillation | ✅ done | `v2.6.2` |
| v2.7.0 — per-material flowDistance | ✅ done | `v2.7.0` |
| v2.7.1 — TSDoc worked examples (timer fields) | ✅ done | `v2.7.1` |
| v2.7.2 — water extinguishes fire on contact | ✅ done | `v2.7.2` |
| v2.7.3 — formal benchmark fixture (`npm run bench`) | ✅ done | `v2.7.3` |
| v2.7.4 — pressure-aware horizontal flow (sand & fluids) | ✅ done | `v2.7.4` |
| v2.7.5 — pressure flow is 1-cell only (no skipping) | ✅ done | `v2.7.5` |
| v2.7.6 — anti-oscillation memory enables surface compaction | ✅ done | `v2.7.6` |
| v3.0 — mass-based fluid simulation | ✅ done | `v3.0.0` |
| v3.0.1 — flatten surfaces + evaporate orphans | ✅ done | `v3.0.1` |
| v3.0.2 — multi-cell lateral reach (5× gravity flatten speed) | ✅ done | `v3.0.2` |
| v3.0.3 — perf: fast-path mass access + skip fluid collider rebuilds | ✅ done | `v3.0.3` |
| v3.0.4 — demo 09 per-frame profiling + adaptive LATERAL_REACH | ✅ done | `v3.0.4` |
| v3.1.0 — pool-based fluid simulation (phase 1+2) | ✅ done | `v3.1.0` |
| v3.1.1 — bump LATERAL_REACH 5 → 25 (25× gravity flatten speed) | ✅ done | `v3.1.1` |
| v3.1.2 — fall columns transparent to lateral flow | ✅ done | `v3.1.2` |
| v3.1.3 — narrow-column criterion (pile + drain fix) | ✅ done | `v3.1.3` |
| v3.1.4 — bump MAX_COMPRESS 0.02 → 0.5 (faster cascade) | ⚠️ reverted in v3.1.5 | `v3.1.4` |
| v3.1.5 — revert v3.1.4; pile + slow drain are intrinsic | ✅ done | `v3.1.5` |
| v3.1.6 — multi-pass lateral on burst over-mass | ⚠️ reverted (caused horizontal-line artifacts) | `v3.1.6` |
| v3.1.7 — demo 09 brush paints fluids at mass 0.5 (burst-pile fix) | ✅ done | `v3.1.7` |
| v3.1.8 — always-on pool detection + bottom-up fill (instant flatten) | ✅ done | `v3.1.8` |
| v3.1.x — incremental pool maintenance (phase 3) | ⬜ deferred | — |

Test suite: 373 tests across 22 files. typecheck and lint clean.

---

## v3.1.8 — always-on pool detection + bottom-up fill (2026-05-02)

User-reported after v3.1.7: pouring water on one spot still takes
many ticks to flatten the surface, instead of "almost instantly
adding the level of water in the same amount that water was added,
and surface keeps flat."

### Research

Web search across the W-Shadow / jgallant / Noita CA-fluid lineage
confirmed there is no clever "instant flatten" trick beyond what
v3.1's pool flood-fill already implements. The standard fix in
Noita-class engines is:

1. Run flood-fill every tick (not gated to high active counts).
2. Distribute mass per-pool with a hydrostatic bottom-up profile
   (not a uniform average across the whole pool).
3. Optionally lerp the visual surface over 2–4 ticks so the snap
   reads as "fast" rather than "teleport."

(Sources: W-Shadow's 2009 fluid post + follow-up, jgallant's 2D
liquid CA in Unity, Petri Purho's Noita GDC 2019 talk, Tom
Forsyth's CA paper, Zhu/Bridson sand-as-fluid SIGGRAPH 2005.)

### Changes

- **`POOL_DETECTION_MIN`: `10000` → `0`** (`CellularAutomaton.ts`).
  Pool flood-fill now runs every tick whenever any fluid cell is
  active. The outer step still short-circuits on a settled world,
  so the flood-fill cost is paid only when there's flow.
- **`distributePoolMass` rewritten** (`FluidPools.ts`) to
  hydrostatic bottom-up fill: rows sorted bottom-first, saturated
  to `MAX_MASS = 1.0` until the topmost (partial) row holds the
  remainder. Cells in rows above the new surface are demoted to
  air. Excess mass beyond row capacity (e.g. compression from
  burst injection) goes onto the topmost row.

### User-visible effect

Painting water onto an existing pool's surface now merges the
brush mass into the pool's `totalMass` within one tick, and the
hydrostatic redistribution raises the surface uniformly across
the whole connected body. No more "small hill at the brush
centroid" while reach-25 lateral cascades try to catch up.

### Bench (vs v3.1.7)

| scenario | v3.1.7 | v3.1.8 |
|---|---|---|
| settled (active set empty) | ~1 ms | ~1 ms |
| 100 falling cells (100 steps) | ~5 ms | ~33 ms |
| 5000-cell drain | ~52 ms | ~53 ms |
| 25000-cell drain | ~28 ms | ~40 ms |
| 12000-cell thin sheet | ~96 ms | ~44 ms |
| 32k mixed bitmap | ~600 ms | ~546 ms |

The 100-cell scenario regressed because pool detection now runs
on small active sets too. Per-step cost is ~0.33 ms — well within
real-time budget. Thin sheet got faster (pool fast path now
actively distributes settled bodies).

The next-most valuable optimization is incremental pool
maintenance (v3.1 phase 3, deferred): only re-flood pools whose
chunk dirty-rect was touched this tick. That'd cut the small-
active-set regression. Not needed for current usability.

### Files

- `src/core/algorithms/CellularAutomaton.ts` — `POOL_DETECTION_MIN`
  reduced to `0`.
- `src/core/algorithms/FluidPools.ts` — `distributePoolMass`
  switched from uniform-avg to bottom-up fill + air demotion +
  compression-on-top.
- `tests/core/algorithms/FluidPools.test.ts` — distribute test
  updated to assert bottom-up profile (was uniform-avg).

Tests: 375 passing. Typecheck and lint clean.

---

## v3.1.7 — demo 09 brush paints fluids at half mass (2026-05-02)

After v3.1.6's multi-pass lateral was reverted (horizontal-line
artifacts) the user picked option 2 from the v3.1.5 menu: lower
the mass injected per brush click rather than try to fix the
algorithm's response to bursty input.

### Mechanism

Demo 09's `spawnBrushAt` calls `setPixel(x, y, materialId)` for
each cell in the brush footprint. `setPixel` seeds mass = 1.0 for
any registered material. A typical brush click paints 5–20 cells,
so a single click injects 5–20 mass units in one tick. On top of
a saturated pool that's far above local lateral capacity → the
excess fires step 4 compression-overflow-up → visible "pile" at
the brush centroid (which is exactly what the user reported).

### Fix

Localized to the demo. For fluid materials (water / oil / gas)
`spawnBrushAt` now calls `setMass(x, y, 0.5, materialId)` instead
of `setPixel`. Mass injected per click halves; lateral spread
keeps up with the smaller burst; no compression-up cascade.

For non-fluid materials (sand / fire / wood) the brush still uses
`setPixel` — those materials don't use fractional mass.

The core API contract is unchanged: `setPixel(x, y, water_id)`
still seeds mass = 1.0. Only the demo's brush behaves
differently. Tests pass.

### Files

- `examples/09-falling-sand/main.ts` — `spawnBrushAt` checks
  material's `simulation` kind and routes through `setMass` for
  fluids.

Tests: 375 passing. Typecheck and lint clean.

---

## v3.1.5 — revert v3.1.4; pile + slow drain intrinsic to mass-based CA (2026-05-02)

User-reported after v3.1.4 (MAX_COMPRESS bumped 0.02 → 0.5): the
pile and never-depletes symptoms persisted. Specifically, "the
piling appears when we pour water near or on the water flow from
the cliff — maybe the issue is in there, it gives a start for
water piling near the flow."

### Why MAX_COMPRESS didn't help

The cascade rate through saturated cells `≈ MAX_COMPRESS / 2` per
tick per stage, AND the per-cell holding capacity `≈ MAX_MASS +
MAX_COMPRESS`. Both scale together. When a cell over-fills above
its capacity, the excess triggers compression-overflow-up (the
visible "pile"). The over-mass-per-tick remainder is roughly
INVARIANT in `MAX_COMPRESS` — faster arrival is offset by larger
hold buffer.

### Where the pile actually comes from

Brush paints cells at `mass = 1.0` instantly, often 5–20+ cells
per click. Lateral equalize disposes `~0.5 × diff` per neighbor
per tick. With reach=25 the lateral capacity is `~0.99 × diff`
per tick, but only the diff present at that tick. A burst paint
near a saturated landing puts mass far above local capacity in
one tick; lateral can't dispose all of it before the next tick's
compression-up step fires.

This is a **transient** that persists when paint is continuous
(user dragging the brush) and is fundamental to mass-based
cellular automata: discrete per-tick lateral disposal can't
absorb a sudden mass injection without compression overflow up.
Real-fluid sims handle this via per-particle velocity / SPH /
PIC-FLIP, not per-cell mass.

### Workarounds (not implemented — need user choice)

- **Lower brush mass.** `setPixel` could seed mass to 0.5 instead
  of 1.0. Halves the per-paint mass injection. Cosmetically
  invisible (binary rendering).
- **Shrink brush.** Smaller radius = less mass per click.
- **Multi-pass lateral.** Run step 2 twice or three times per
  tick. ~2× cost on draining-pour scenarios; absorbs more burst
  mass before compression-up fires.
- **Accept intrinsic limitation.** Mass-based sims trade
  particle realism for cell-grid uniformity; piles are part of
  the deal.

### Files

- `src/core/algorithms/CellularAutomaton.ts` — `MAX_COMPRESS`
  reverted from `0.5` to `0.02`.

Tests: 375 passing. Typecheck and lint clean.

---

## v3.1.4 — faster vertical cascade (2026-05-02)

User-reported after v3.1.3: the "pile of water around falling
water" and "water on cliff never runs out" symptoms persisted —
the narrow-column criterion fix didn't address them.

Both turned out to be a different root cause: the **rate** of
mass cascade through a saturated stream column. Between two cells
both at `MAX_MASS`, `stableSplit` returns the bottom equilibrium
≈ `MAX_MASS + MAX_COMPRESS / 2`, so the per-tick downward flow
is roughly `MAX_COMPRESS / 2`. With W-Shadow's default
`MAX_COMPRESS = 0.02`, that's **0.01 mass/tick per stage** of a
saturated stream — a 10-cell-tall stream takes ~50 ticks to move
one full cell of mass from top to bottom. The user perceived this
as "infinite source" and "pile at landing because spread can't
keep up."

### Fix

Bump `MAX_COMPRESS` from `0.02` to `0.5`. Cascade rate becomes
`~0.25 mass/tick` per stage — 25× faster. Source pool drains
visibly; landings disperse instead of stacking.

Side effects:

- A settled tower of `N` cells holds compressed mass `MAX_MASS +
  (N-1) × MAX_COMPRESS` at the bottom, which scales like 5×
  more compression per row. Rendering is binary so this is
  visually invisible.
- The overflow-up threshold (`remaining > MAX_MASS`) is unchanged,
  so the upward overflow rule still fires at exactly the same
  mass.

### Bench (vs v3.1.3)

| scenario | v3.1.3 | v3.1.4 |
|---|---|---|
| settled | ~1 ms | ~1 ms |
| 100 falling cells | ~7.5 ms | ~6.9 ms |
| 5000-cell draining pour | ~57 ms | ~48 ms |
| 25000-cell draining pour | ~33 ms | ~27 ms |
| 12000-cell thin sheet | ~125 ms | ~97 ms |
| 32k mixed bitmap | ~668 ms | ~620 ms |

All scenarios got faster — quicker cascade settles cells sooner
so they drop out of the active set in fewer ticks.

### Files

- `src/core/algorithms/CellularAutomaton.ts` — single constant
  bump.

Tests: 375 passing. Typecheck and lint clean.

---

## v3.1.3 — narrow-column criterion (2026-05-02)

User-reported after v3.1.2:
1. "the flow from the cliff could create 'a pile of water' — water
   from down the cliff trying to be collected around the falling
   water making a pile."
2. "water from the cliff never run out — it just stays on a cliff
   like it is infinite or not moving."

Both came from v3.1.2's column-detection criterion being too broad
— `same-material above` matched not just falling streams but ALSO
sub-surface pool cells (which also have water above them). Sub-
surface cells therefore skipped lateral equalization, breaking
mass redistribution within wide pools. Visible as:

- Mass piling up at a stream's landing point because the
  surrounding pool can't redistribute mass laterally fast enough.
- Source pool failing to drain because its sub-surface mass
  couldn't equalize and feed the cliff edge.

### Fix

Tighten the column criterion to require BOTH same-material above
AND at least one lateral side being non-same-material:

```
isNarrowColumn = targetId === id
    && getPixel(nx, y - 1) === id          // fed from above
    && (getPixel(nx - 1, y) !== id          // air on at least
        || getPixel(nx + 1, y) !== id);     // one side
```

A 1–2 cell wide stream column has air on at least one side; a
sub-surface pool middle has same-material on both sides. Sub-
surface pool middles now equalize laterally as expected.

### Bench (vs v3.1.2)

| scenario | v3.1.2 | v3.1.3 |
|---|---|---|
| settled (active set empty) | ~1 ms | ~1 ms |
| 100 falling cells | ~6.3 ms | ~7.5 ms |
| 5000-cell draining pour | ~41 ms | ~57 ms |
| 25000-cell draining pour | ~25 ms | ~33 ms |
| 12000-cell thin sheet | ~96 ms | ~125 ms |
| 32k mixed bitmap | ~670 ms | ~668 ms |

Modest perf regression — the narrow check adds 2 extra reads per
same-material lateral target. The trade-off was the right call:
v3.1.2's broad criterion produced visibly wrong pool dynamics
in the demo.

### Files

- `src/core/algorithms/CellularAutomaton.ts` — single criterion
  `isNarrowColumn` replaces v3.1.2's `isColumnCell` in all three
  lateral-loop branches.

Test suite: 375 tests passing. Lint clean. Typecheck clean.

---

## v3.1.2 — fall columns transparent to lateral flow (2026-05-02)

User-reported after v3.1.1: "if water hits the cliff edge (from the
outer side) it falls vertically (that is ok) and become a wall for
water that runs below — basically water can't run under the cliff
because falling water is blocking it."

### Mechanism

Cell at `(x, y)` flowing horizontally with reach=25 used to
encounter a vertical fall column (water cells stacked at the same
x, fed from a pool above) and treat it as a barrier:

- If the column cell at `(nx, y)` had **equal or higher mass**
  than the running cell's remainder, the lateral scan terminated
  on `diff <= 0` (a v3.0.3 perf-opt that assumed "same-mass
  neighbor → settled pool → nothing further out is worth
  scanning").
- If the column cell had **lower** mass, the running cell
  donated mass into it. The column then drained that mass down
  to the next tick — so horizontal flow effectively leaked into
  the fall column instead of crossing past it.

Either way, air on the far side of the column never received
flow.

### Fix

In `stepLiquid`'s lateral scan, detect "this target is part of a
column being fed from above" by checking `bitmap.getPixel(nx, y -
1) === id`. If so:

- Don't terminate the scan on `diff <= 0` — `continue` instead,
  so the scan keeps marching outward at `d+1..reach`.
- Don't donate mass into the cell on `diff > 0` either — the
  donated mass would just drain through.

Settled pool **surface** cells have air directly above (that's
what makes them surface), so the column-detection check returns
false and the v3.0.3 early-termination still fires there. Perf
on idle pools is unchanged.

### Bench (vs v3.1.1)

| scenario | v3.1.1 | v3.1.2 |
|---|---|---|
| settled (active set empty) | ~1 ms | ~1 ms |
| 100 falling cells | ~6.3 ms | ~6.3 ms |
| 5000-cell draining pour | ~51 ms | ~41 ms (faster) |
| 25000-cell draining pour | ~29 ms | ~25 ms (faster) |
| 12000-cell thin sheet | ~82 ms | ~96 ms (slower) |
| 32k mixed bitmap | ~620 ms | ~670 ms |

The draining-pour scenarios got faster — scanning past stream
cells skips redundant equalize bookkeeping for column targets.
The thin sheet got slower because most lateral neighbors have
same-material directly above (the layer above is also water), so
the column-detect skip fires and the scan walks to its full reach
instead of terminating early.

### Files

- `src/core/algorithms/CellularAutomaton.ts` — column-detect
  branches in three places inside `stepLiquid`'s lateral loop
  (`diff <= 0`, post-flow, sub-MIN_FLOW).
- `tests/core/algorithms/CellularAutomaton.test.ts` — new
  describe block "fluid past fall column (v3.1.2)" with two
  tests: propagation past a 2-tall column, and a settled-pool
  surface that still terminates correctly.

Test suite: 375 tests passing (was 373; +2 regression). Lint
clean. Typecheck clean.

---

## v3.1.1 — 25× surface flattening speed (2026-05-01)

User feedback after v3.1.0: "works well, you can even accelerate
flattening of surface, not x5 but x25." The pool fast path absorbed
the cost of v3.0.4's reach=5 by skipping interior cells of large
pools. With that headroom available, the lateral-reach knob is
turned up by another 5×.

### Changes

- `LATERAL_REACH_MAX`: `5` → `25`. Cells in a non-pool active set
  now equalize with up to 25 same-rank neighbors per side per tick.
- `LATERAL_REACH_HIGH_LOAD_VAL`: `2` → `5`. Sustained-pour throttle
  preserved but at a less aggressive ratio so heavy pours still
  flatten visibly while staying within frame budget.
- `POOL_DETECTION_MIN`: kept at `10000` after a bench experiment
  showed lowering it hurts draining-pour scenarios where cells
  aren't yet in stable pools.

### Bench (after, vs v3.1.0)

| scenario | v3.1.0 (reach 5) | v3.1.1 (reach 25) |
|---|---|---|
| settled (active set empty) | ~1 ms | ~1 ms |
| 100 falling cells | ~1.3 ms | ~6.3 ms |
| 5000-cell draining pour | ~10 ms | ~51 ms |
| 25000-cell draining pour | ~32 ms | ~29 ms (pool path) |
| 12000-cell thin sheet | ~83 ms | ~82 ms |
| 32k mixed bitmap | ~388 ms | ~620 ms |

Hot zone is the 5000-cell draining pour (51 ms ≈ 3 frames). In
realistic demo input the active set ramps past 10 K within a
second of sustained pour, at which point the pool fast path
brings cost back down.

The `LATERAL_REACH_HIGH_LOAD = 8000` threshold still kicks in
between these two regimes; it caps the worst-case sub-pool-size
pour at reach=5 cost.

Test suite: 373 tests passing. Lint clean. Typecheck clean.

---

## v3.1.0 — pool-based fluid simulation (2026-05-01)

User-reported: "probably there are even more effective approaches,
like handling group of elements as 1 element." Affirmative —
this is the canonical "next-level" optimization for binary CA
fluid sims, used by every production fluid system that scales
(Minecraft, DwarfCorp, etc.).

### Mechanism

Each tick, when the active set is large enough to warrant it:

1. **`detectPools(bitmap, materials)`** — flood-fills connected
   components of same-material fluid cells (water / oil / gas).
   Builds a `Map<id, FluidPool>` and writes per-cell pool ids
   to a new `Uint16Array` sidecar (`bitmap._poolIds`).
2. **`distributePoolMass(bitmap, pool)`** — each pool with
   ≥ `POOL_MIN_SIZE` cells gets uniform mass distribution
   (`avg = totalMass / cellCount`). Total mass is preserved
   exactly. Settles internal mass-distribution work in O(N)
   per pool with no per-cell flow logic.
3. **`isPoolInterior(...)`** — outer step loop calls this for
   each active fluid cell. If every 4-neighbor shares the
   pool id, the cell is interior — its mass is already set
   by the distribution and per-cell `stepLiquid` would change
   nothing. Skip.

Sand, fire, and static cells are unaffected — they don't go
through the pool path.

### Activation threshold

`POOL_DETECTION_MIN = 10000` active cells. Below this, the
v3.0.4 per-cell path is fast enough that the O(W×H) flood-fill
scan would cost more than it saves.

### Bench

| Scenario | v3.0.4 | v3.1.0 | Change |
|---|---|---|---|
| Settled world | 5 µs | 7 µs | +2 µs (negligible) |
| Active pour 100 cells | 41 µs | 53 µs | +12 µs (below threshold) |
| Big pour 5000 | 1.4 ms | 1.7 ms | +0.3 ms (below threshold) |
| **Huge pour 25000** | **6.6 ms** | **2.5 ms** | **−62%** |
| **Thin sheet 12000** | **2.0 ms** | **1.1 ms** | **−45%** |
| Full mixed 32k (low connectivity) | 13 ms | 12 ms | −8% |

The user's "10 fps with many elements" case sits squarely in
the high-active-cell regime where pools win. Demo 09's heavy
pour scenarios should now sustain higher FPS.

### What this replaces

The v3.0.x per-cell `stepLiquid` path is retained for cells
**outside pools** (singletons, falling drops, < `POOL_MIN_SIZE`)
and **on pool perimeters** (cells with at least one non-pool
4-neighbor). Perimeter cells handle:

- Spreading into adjacent air (pool growth).
- Cross-material density swaps (water sinking through oil).
- Compression overflow (pool surface rising).

So pool-aware step is a **layered** optimization — bulk
equilibrium for interior, per-cell flow for boundary work.

### Phase 3 (deferred)

Incremental pool maintenance — replace the per-tick flood fill
with O(1) pool ops triggered by `setPixel` / `setMass`. Would
reduce the detection overhead (currently O(W×H) bitmap walk)
to O(changed cells). Not shipped in v3.1.0 because phase 2
already gives 45-62% wins on the user's actual scenarios. Will
revisit if users hit larger worlds (e.g. 1024×512).

### Files involved

- `src/core/algorithms/FluidPools.ts` — new module:
  `FluidPool` interface, `NO_POOL` sentinel, `detectPools()`,
  `distributePoolMass()`, `isPoolInterior()`.
- `src/core/ChunkedBitmap.ts` — `_poolIds: Uint16Array` lazy
  field; `_getPoolIdsUnchecked()` fast-path getter.
- `src/core/algorithms/CellularAutomaton.ts` — outer
  `step()` runs pool detection + distribution above threshold;
  per-cell loop checks `isPoolInterior` and skips interior
  cells. New constants `POOL_DETECTION_MIN` and `POOL_MIN_SIZE`.
- `tests/core/algorithms/FluidPools.test.ts` — 14 tests
  covering detection (11), distribution (1), interior check
  (2). Empty bitmaps, static-skip, single blob, separate
  blobs, water-vs-oil, 4-connectivity, walled separation,
  pool-id sidecar, NO_POOL for air, partial mass, large
  region (no stack overflow).
- `docs-dev/07-v3.1-pool-based-fluid.md` — design plan.

---

---

## v3.0.4 — profiling + adaptive lateral reach (2026-05-01)

User-reported v3.0.3 result: "it is better, but probably there
are even more effective approaches."

### (b) Per-frame profiling in demo 09

`examples/09-falling-sand/main.ts` now times each phase of the
frame and surfaces the numbers in the stats overlay:

- `sim`    — `terrain.simStep()` (the cellular-automaton tick).
- `phys`   — physics queue flush (collider rebuilds for dirty
  chunks).
- `paint`  — `terrain.renderer.repaintDirty()` (canvas writes
  + GPU upload).
- `box2d`  — `b2.WorldStep`.
- `active` — current active-cell count for the next tick.

The numbers shift on the fly while you pour. Use them to see
which phase is actually eating the frame budget — `v3.0.3`
already collapsed `phys` for fluid-only changes, so the
remaining culprit is usually `sim` or `paint` depending on
cell count and chunk dirty rate.

### (a) Adaptive `LATERAL_REACH`

Lateral reach (the "5× of gravity" spread rate from v3.0.2) is
the dominant factor in `stepLiquid` cost. Below
`LATERAL_REACH_HIGH_LOAD = 8000` active cells, reach stays at
`5` (full visual feel). Above the threshold, reach drops to
`2`, halving the per-cell sim cost while keeping the spread
visible. The trade-off: at very high loads the surface
flattens slower, but at that point the user is filling cells
faster than the sim can settle anyway.

### Bench

| Scenario | v3.0.3 | v3.0.4 |
|---|---|---|
| Settled world | ~5 µs/step | ~5 µs/step |
| Active pour (~100 cells) | ~41 µs/step | ~41 µs/step |
| Big pour (~5000 cells, below threshold) | ~1.3 ms/step | ~1.4 ms/step |
| Huge pour (~25000 cells, above threshold) | ~6.6 ms/step | ~6.7 ms/step |
| Thin sheet (~12000 cells, edge-heavy) | n/a | ~2.0 ms/step |

The adaptive-reach savings show up in **edge-heavy** scenarios
(thin sheets, complex puddles) where most cells run the full
lateral chain. In bulk pools the v3.0.3 left/right short-
circuit already caught most of the cost, so adaptive reach
adds little. The user's demo-09 scenario is somewhere
in-between depending on how they pour.

### Files involved

- `examples/09-falling-sand/main.ts` — phase timing in
  `update()`; `sim` / `phys` / `paint` / `box2d` / `active`
  surfaced in the stats overlay.
- `src/core/algorithms/CellularAutomaton.ts` —
  `LATERAL_REACH` split into `LATERAL_REACH_MAX` / `_VAL`;
  `step()` picks reach based on snapshot size; `stepLiquid`
  takes `lateralReach` parameter.
- `tests/perf/CellularAutomaton.bench.ts` — new "thin sheet"
  scenario.

---

---

## v3.0.3 — perf optimization for high cell counts (2026-05-01)

User-reported: FPS drops to ~10 with many fluid elements. v3.0.0
shipped the canonical mass-based model but `setMass` and
`setPixel` had per-call overhead (validation, chunk lookups,
8-neighbor active-set marking) that compounded badly at
~30 setMass calls per cell per tick.

### Optimizations

1. **`ChunkedBitmap` internal fast-path API** — `_getMassArrayUnchecked`,
   `_markCellChanged`, `_writeIdUnchecked`, `_readIdUnchecked`.
   These bypass the public-API validation overhead and chunk-
   lookup-per-call costs. Only used inside the sim hot path.
2. **`stepLiquid` direct mass array access** — caches the mass
   array reference once at function entry and uses raw indexed
   reads/writes. Replaced ~20 setMass calls per cell with
   ~2 array writes + 1 mark.
3. **`setMass` only 8-neighbor-marks on id changes** — mass-only
   updates mark just `(x, y)`. Previously every setMass call
   hit 9 cells via `_touchActiveNeighborhood`; with 30 setMass
   per cell × 9 = 270 set.add calls per cell per tick, that
   was a real cost at high cell counts.
4. **Drop near-equilibrium cells from active set** — a cell
   whose mass change between ticks is below `MIN_FLOW` is
   considered "settled" and not re-marked. Stable bodies of
   water progressively shrink the active set.
5. **Lateral chain short-circuit** — once a side hits a wall, a
   different non-air material, or the chain saturates, that
   side is marked done and skipped for higher `d`.
6. **`chunk.dirty` only fires on static-affecting transitions**
   — fluid mass changes and air↔fluid transitions only set
   `chunk.visualDirty` (renderer repaint). The collider-rebuild
   flag is reserved for changes that involve a static material
   (carve / deposit of stone / sand promotion). Major downstream
   perf win: fluid-only sim ticks no longer trigger marching-
   squares + Box2D body rebuild work.

### Bench numbers

| Scenario | v3.0.2 | v3.0.3 |
|---|---|---|
| Settled world | ~5 µs/step | ~5 µs/step (unchanged early-out) |
| Active pour (~100 cells) | ~81 µs/step | ~41 µs/step (~50% faster) |
| Big pour (~5000 cells) | ~1.4 ms/step | ~1.3 ms/step |
| Huge pour (~25000 cells) | ~7.5 ms/step | ~6.6 ms/step |
| Full mixed (~32000 cells, all mobile) | ~17 ms/step | ~13 ms/step |

The biggest user-facing win comes from optimization #6 — the
demo no longer rebuilds Box2D static colliders every frame
just because water mass changed. That's where the 10-fps stall
was coming from.

### Files involved

- `src/core/ChunkedBitmap.ts` — new internal fast-path methods;
  `setMass` 8-neighbor mark gated on id change; `setPixel`
  `chunk.dirty` gated on static-affecting transitions; new
  `_isStaticOrUnknown` helper.
- `src/core/algorithms/CellularAutomaton.ts` — `stepLiquid`
  rewritten to use `_getMassArrayUnchecked` + `_writeIdUnchecked` +
  `_markCellChanged`; lateral chain tracks per-side "done"
  state; final commit gated on `delta > MIN_FLOW`.
- `tests/perf/CellularAutomaton.bench.ts` — added "big pour"
  (5000 cells) and "huge pour" (25000 cells) scenarios so
  future regressions are visible.

---

---

## v3.0.2 — multi-cell lateral reach (2026-05-01)

User-reported: "flattening speed should be 5× of gravity speed
— it should be much faster than it is now."

Pre-v3.0.2: lateral equalization only equalized with the
immediate left and right neighbors per tick. Wave propagation
rate = 1 cell per tick — same as gravity (1 row per tick fall).
With a 6-tall column the flat surface emerged after ~500 ticks
because each cell could only push mass to its IMMEDIATE
neighbor each step.

### Fix

The lateral pass now equalizes with cells `1..LATERAL_REACH`
away on each side per `stepLiquid` call. Each step uses fresh
state, so mass cascades outward across the row in a single
tick.

```
const LATERAL_EQUALIZE = 0.5;  // was 0.25 — full equalize per pair
const LATERAL_REACH = 5;        // new — N cells of spread per tick
```

`LATERAL_EQUALIZE` bumped from `0.25` to `0.5` so each
adjacent pair fully equalizes in one tick (rather than diff-
halves). Combined with the multi-cell reach, surface
flattening now propagates ~5 cells/tick.

### Result (probes)

| Scenario | v3.0.1 | v3.0.2 |
|---|---|---|
| Single water cell spread after 1 tick | 1 cell each side | **5 cells each side** |
| 6-tall column → flat floor | ~500 ticks | **~30 ticks** |

### Bench

Per-step cost goes up ~20% in the worst case (more transfers
per cell):

| Scenario | v3.0.1 | v3.0.2 |
|---|---|---|
| Active pour | ~70 µs/step | ~81 µs/step |
| Full mixed bitmap | ~14 ms/step | ~17 ms/step |

Settled worlds unchanged (still ~5 µs/step early-out).

### Files involved

- `src/core/algorithms/CellularAutomaton.ts` — `LATERAL_REACH`
  constant; `stepLiquid` lateral loop iterates `d=1..REACH`,
  each pass equalizing with a single neighbor at distance `d`
  on both sides.
- `tests/core/algorithms/CellularAutomaton.test.ts` — new
  describe "multi-cell lateral spread (v3.0.2)" with 2 tests:
  single-cell spread reaches ≥ 4 cells per tick; 6-tall column
  drains AND flattens within 30 ticks.

---

---

## v3.0.1 — flatten surfaces + evaporate orphans (2026-05-01)

User-reported v3.0.0 issues:
1. Water/oil/gas leave "in-air" particles.
2. Surfaces still don't flatten.

Both came from the `MIN_FLOW = 0.005` threshold inherited from
W-Shadow's tutorial. Two consequences:

- **Orphan particles**: cells with mass between `MIN_MASS`
  (0.0001) and `MIN_FLOW` (0.005) couldn't transfer — they sat
  forever as visible water particles in mid-air.
- **Bell-shape surface**: lateral equalization stops once the
  flow drops below `MIN_FLOW`, which means adjacent cells freeze
  with up to `4 × MIN_FLOW = 0.02` mass difference. That's a
  visible gradient on a "flat" surface.

### Fix

- `MIN_FLOW = 0.0001` (was `0.005`) — set equal to `MIN_MASS`.
  Any cell that the simulation considers "wet" can also
  transfer. Cells fully equalize.
- New evaporation guard at the top of `stepLiquid`: if
  `remaining < MIN_MASS`, the cell is cleared to air. This
  catches the rare case where Float32 precision leaves a cell
  with sub-MIN_MASS mass (no longer transferable, but visible
  as water).

### Result

Probe: 6-tall water column on 13-wide floor, after 500 ticks.

| | v3.0.0 | v3.0.1 |
|---|---|---|
| Floor row masses | `0.41 0.43 0.45 0.47 0.49 0.50 0.52 0.50 0.48 0.47 0.45 0.43 0.41` (bell, max-min = 0.11) | `0.461 0.461 0.461 0.462 0.462 0.462 0.463 0.462 0.462 0.462 0.461 0.461 0.460` (flat, max-min = 0.003) |
| Orphan particles in air | yes | no |

The 3-cell "single falling water" probe also confirms no orphan
cells remain mid-air after 50 ticks.

### Files involved

- `src/core/algorithms/CellularAutomaton.ts` — `MIN_FLOW`
  constant lowered; `stepLiquid` evaporation guard at entry.
- `tests/core/algorithms/CellularAutomaton.test.ts` — new
  describe "surface flatness + no orphans (v3.0.1)" with 3
  tests (uniform floor row, no orphan during fall, evaporate
  sub-MIN_MASS cells).

---

---

## v3.0.0 — mass-based fluid simulation (2026-05-01)

Switch water/oil/gas from binary cell occupancy to a mass-based
model. Each cell stores a `Float32` mass alongside its material id;
mass transfers between same-material/air neighbors via the
canonical W-Shadow / jgallant / DwarfCorp algorithm. Pressure
emerges naturally from the over-compression overflow rule —
surfaces actually flatten now, ending the v2.x series of
incremental fixes for the "fluids don't level" complaint.

### Storage

- `ChunkedBitmap._masses: Float32Array | null` — lazy-allocated.
- `getMass(x, y)` — returns the cell's mass. For uninitialized
  bitmaps returns `1.0` for any non-air cell (backwards
  compatible). For initialized bitmaps reads the stored value.
- `setMass(x, y, mass, idIfAir?)` — writes a mass and updates id
  as a side effect. `mass <= 0` clears the cell to air; otherwise
  the cell adopts `idIfAir` if it was air, or keeps its id.
- `setPixel(x, y, id)` unchanged: writes id and (if mass array
  is allocated) sets mass to `1.0` for non-air, `0` for air.

The lazy init's first call seeds every existing non-air cell to
mass `1.0`, so v2.x bitmaps "switch on" to mass tracking
correctly without losing implicit-full mass.

### Mass transfer constants

| Constant | Value | Role |
|---|---|---|
| `MAX_MASS` | `1.0` | A "full" cell. |
| `MAX_COMPRESS` | `0.02` | Extra mass a deep cell can hold under pressure. |
| `MIN_MASS` | `0.0001` | Below this a cell is treated as empty. |
| `MIN_FLOW` | `0.005` | Transfer threshold (numerical noise filter). |
| `MAX_FLOW` | `1.0` | Per-tick cap on cell-to-cell transfer. |
| `LATERAL_EQUALIZE` | `0.25` | Fraction of mass difference equalized per tick (W-Shadow's default). |

### Step rules (`stepLiquid`)

Per cell, four sequential transfers:

1. **Vertical (deep direction)**: cross-material density swap
   (atomic, masses preserved) for water-on-oil, sand-on-water,
   etc. Otherwise air/same-material mass transfer toward the
   stable split.
2. **Lateral left**: quarter-equalize toward the left neighbor.
3. **Lateral right**: quarter-equalize toward the right neighbor.
4. **Compression overflow** (shallow direction): only fires
   when source mass exceeds `MAX_MASS`.

`stableSplit(total)` returns the deeper cell's equilibrium mass:
the source is over-full when its mass exceeds the split, and
that overflow drives lateral and upward (or downward, for gas)
spread.

### What stays vs changes

- **Sand / fire / static**: unchanged. Binary CA rules from v2.x
  preserved. Sand pressure flow (v2.7.4/5) preserved.
- **Water / oil / gas**: now mass-based.
- **Cross-material density swaps**: still atomic — water above
  oil swaps cells (mass preserved on both ends).
- **`Material.flowDistance`**: kept as a registered field but
  no longer used by `stepLiquid`. The lateral equalization
  rate is currently a module constant; could become per-
  material in a v3.x patch.
- **v2.7.6 `horizFlowSource` anti-oscillation memory**: still
  used by sand pressure flow; not used by the mass-based
  liquid path (mass equalization can't oscillate).

### Removed (v2-specific obsolete tests)

The mass-based model fundamentally changes the per-tick
behavior of liquids, so several v2.x tests pinned to specific
binary cell positions are obsolete:

- `pressure-aware flow (v2.7.4)` describe — gone.
- `pressure flow is 1-cell only (v2.7.5)` describe — gone.
- `anti-oscillation memory enables compaction (v2.7.6)` describe — gone.
- `gas leveling without oscillation (v2.6.2)` describe — gone.
- `per-material flowDistance (v2.7.0)` describe — gone (the
  field's semantics changed; tests would need rewriting from
  scratch and current value isn't user-tuned).

Other tests migrated to mass-conservation asserts (e.g.,
"water column on flat floor": now asserts total mass is
preserved + no water above the floor row, instead of "exactly
6 cells in a single row").

### Bench numbers

Mass-based step is ~2× the v2.7.6 cost in the worst case
(every cell mobile), as expected — each cell does 4 mass
transfers with float math instead of 1 swap with byte
compares. Settled worlds are still effectively free.

| Scenario | v2.7.6 | v3.0.0 |
|---|---|---|
| Settled world | ~5 µs/step | ~5 µs/step |
| Active pour | ~58 µs/step | ~70 µs/step |
| Full mixed bitmap | ~6.8 ms/step | ~14 ms/step |
| First-call seed scan | ~250 µs | ~590 µs |

The full-mixed-bitmap worst case at 14 ms/step is still under a
60 fps frame budget. Real games rarely have 100% mobile cells.

### Files involved

- `src/core/ChunkedBitmap.ts` — `_masses` field + lazy `_initMassArray`;
  `getMass` / `setMass` public API; `setPixel` updates mass alongside id.
- `src/core/algorithms/CellularAutomaton.ts` — new constants
  (`MAX_MASS`, `MAX_COMPRESS`, etc.); `stableSplit` helper;
  `stepLiquid` function; dispatch in `step()` routes water/oil/gas
  to `stepLiquid` instead of `stepFluid`.
- `tests/core/ChunkedBitmap.test.ts` — 11 new tests for the mass
  storage / get / set API.
- `tests/core/algorithms/CellularAutomaton.test.ts` — multiple
  v2.x tests deleted as obsolete; remaining tests migrated to
  mass-conservation asserts; new "mass-based fluid (v3)" describe
  block with 2 tests (mass-conservation, smooth bell-shape
  distribution after column drain).
- `docs-dev/06-v3-mass-based-fluid.md` — design document
  written before implementation.

---

---

## v2.7.6 — anti-oscillation memory (2026-05-01)

User-reported: gas/liquid surfaces don't flatten — alternating
wet/dry cells stay permanently spread instead of compacting
into a contiguous block. After researching established falling-
sand techniques (W-Shadow, jgallant, DwarfCorp, Powder Toy,
Noita) the canonical fix is a mass-based model — Float per
cell instead of binary occupancy — which is a v3.0 architectural
change. v2.7.6 is the smaller-but-still-effective patch.

### Fix

The pre-v2.7.6 "same-rank-beyond" guard (added in v2.6.2 to
prevent 2-tick pocket-dance oscillations) blocked legitimate
chain compaction as a side effect. v2.7.6 replaces it with
**per-cell move-source memory**:

- New `ChunkedBitmap.horizFlowSource: Uint16Array` — each
  cell stores the X coordinate it came from on its last
  horizontal flow move. `0xFFFF` = no recent move.
- `setPixel` resets the cell's entry to `0xFFFF` because
  the occupant changed.
- `stepFluid` reads the source's `cameFromX` and skips any
  flow target equal to it (would just undo the prior move).
  After a successful move, writes the source X to the
  target's `horizFlowSource` slot.

With oscillation prevented mechanically, the same-rank-beyond
guard is removed entirely. Surface cells can now compact
across air gaps:

| Scenario | Pre-v2.7.6 | Post-v2.7.6 |
|---|---|---|
| Alternating `w.w.w.w.w.w.w` after 200 ticks | stays spread (guard blocks every move) | `wwwwwww......` (fully compacted) |
| Mid-cluster pocket `gggggg.g#` | pocket pinned at x=7 mid-cluster | `ggggggg.#` (cluster compacted, pocket at wall edge) |
| Sand pile internal gaps | 0 (v2.7.5) | 0 (preserved) |

### Known limitation

When a tall fluid column drains via pressure-mode 1-cell
flow, escaping cells acquire `horizFlowSource` pointing back
at the column's X. With multi-cell flow active on the floor
row afterward, those cells can only flow AWAY from the column
(memory blocks flow toward it). Result: a 6-tall water column
on a 13-wide floor may end up partially clustered with
stragglers near the walls (e.g., `w....wwww..w.`).

Bounded and much better than pre-v2.7.6, but not a perfect
contiguous block. Full contiguity would need the v3.0 mass-
based model where mass transfers continuously between
neighbors. See `docs-dev/05-simulation.md`.

### Files involved

- `src/core/ChunkedBitmap.ts` — `_horizFlowSource: Uint16Array`
  field + lazy `horizFlowSource` getter; `setPixel` resets
  the cell's entry to `0xFFFF`.
- `src/core/algorithms/CellularAutomaton.ts` — `stepFluid`
  reads `cameFromX`, skips matching flow targets, writes
  `flowSource[targetIdx] = sourceX` after each move. Removes
  the v2.6.2 same-rank-beyond guard.
- `tests/core/algorithms/CellularAutomaton.test.ts` —
  - New describe "anti-oscillation memory enables compaction
    (v2.7.6)" with one test asserting alternating
    `w.w.w.w.w.w.w` cells coalesce into a contiguous
    `wwwwwww......` block.
  - Existing v2.6.2 tests updated: `gas at ceiling` and
    `air pocket between cluster and wall` now assert the
    new behavior (cluster compacts, pocket migrates to
    wall edge) instead of the old "pocket stays put."

### Bench numbers (informational)

Comparable to v2.7.5; one extra `Uint16Array` read at
the top of each `stepFluid` call:

- Settled world: ~5 µs/step.
- Active pour: ~58 µs/step.
- Full mixed bitmap: ~6.8 ms/step.
- First-call seed: ~250 µs.

---

---

## v2.7.5 — pressure flow is 1-cell only (2026-05-01)

User-reported follow-up to v2.7.4:
1. **Sand pile has internal gaps** — air pockets visible inside
   the pile. Caused by pressure flow at `flowDist=2` letting a
   grain skip the cell adjacent to the source, with nothing
   above to fall into the gap.
2. **Fluid surface doesn't flatten** — wet/dry alternation
   along the floor row.

### Fix

When the pressure rule fires (source has same-rank cell in the
direction OPPOSITE its motion), the source now moves to the
**nearest** air on its preferred side, not the farthest
reachable in `flowDist`. The source's old position is reliably
filled by the column above on the same tick, so the cluster
stays solid.

`SAND_PRESSURE_FLOW_DIST` is kept as a constant (now `1`) so
the call site stays readable, but pressure-mode flow always
breaks after the first air target regardless of the value.

### What was NOT fixed (known limitation)

Surface compaction across an air gap. Once a pour drains and
the cells on the floor no longer have a same-rank cell above
(no pressure), the v2.6.2 oscillation guard blocks them from
moving to merge across an air gap. Local rules can't reliably
distinguish "cluster spreading into open space" (compaction
OK) from "cluster chasing a wall-anchored same-rank cell"
(oscillation forever); the guard is intentionally conservative.

In practice the surface IS flat (max height = 1 once the
column drains), but cells may be non-contiguous along the
floor row. Documented in `docs-dev/05-simulation.md`. A future
improvement could add stochastic relaxation or multi-pass
within-tick compaction.

### Files involved

- `src/core/algorithms/CellularAutomaton.ts` — `stepFluid`
  horizontal-flow split into two regimes: under-pressure
  (1-cell only, no v2.6.2 guard) and no-pressure (multi-cell
  with v2.6.2 guard, original behavior).
  `SAND_PRESSURE_FLOW_DIST = 1`.
- `tests/core/algorithms/CellularAutomaton.test.ts` — new
  describe "pressure flow is 1-cell only (v2.7.5)" with one
  test asserting an 8-tall sand pile has zero internal gaps
  after 200 ticks (every column from topmost sand to the
  floor must be solid sand).
- `docs-dev/05-simulation.md` — new sections "Pressure flow
  is always 1-cell" and "Surface compaction is a known
  limitation."

---

All v2.5 research-doc action items now closed.

---

## v2.7.4 — pressure-aware horizontal flow (2026-05-01)

User-reported: gas/liquid still pile vertically when poured ("look
like sand"); sand piles are too vertical (need a critical-pressure
mechanism for faster spread at the base). Both symptoms point at
the same gap — the v2.6.2 oscillation guard blocks legitimate
chain compaction in the column interior, and sand has no
horizontal flow at all.

### Fix

**Pressure check in `stepFluid`**: when the same-rank-beyond
guard would block flow, check if the source has a same-rank cell
in the OPPOSITE direction of its motion (above for sinking fluids,
below for rising gas). If yes, the source is "under pressure"
from a stack and the move is allowed despite the same-rank
neighbor — this is the chain-compaction case, not a 2-cell
oscillation.

**Pressure check in `stepSand`**: count consecutive same-id cells
stacked directly above the grain. At threshold (`3` cells), the
grain gets a mild horizontal flow (`SAND_PRESSURE_FLOW_DIST = 2`).
Top of the pile keeps the granular look; the base widens until
pressure relieves itself.

### Trade-off

- Per-step cost rose ~30% on a typical active pour (44 → 58 µs)
  because `stepFluid` now does an extra `getPixel` for the
  pressure check. Settled-world cost is unchanged. Still
  comfortably sub-millisecond.
- The pressure constants (`SAND_PRESSURE_THRESHOLD = 3`,
  `SAND_PRESSURE_FLOW_DIST = 2`) are module-private. Could be
  promoted to `Material.*` overrides if users need different
  bury thresholds per material.

### Files involved

- `src/core/algorithms/CellularAutomaton.ts` — `stepFluid`
  computes `underPressure` once per call and skips the
  same-rank-beyond guard when set; `stepSand` counts the
  vertical sand stack and threads `pressureFlow` into
  `stepFluid`.
- `tests/core/algorithms/CellularAutomaton.test.ts` — new
  describe block "pressure-aware flow (v2.7.4)" with three
  tests: a 6-tall water column drains in `≤ height + 2`
  ticks; an 8-tall sand column pyramids with
  `baseWidth ≥ pileHeight`; the v2.6.2 oscillation guard
  still pins ceiling-gas pockets when no pressure exists.

### Numbers from the probe (informational)

- Water column 6×9 with floor: drained in 5 ticks.
- Sand column 8×17: pyramid maxHeight=2, base=5 (was a much
  taller pillar before).
- Gas pile in sealed 13×8 box, 6-cell pour: 6 cells reach
  ceiling row.

---

---

## v2.7.3 — formal benchmark fixture (2026-05-01)

`tests/perf/CellularAutomaton.bench.ts` exercises four canonical
sim scenarios via Vitest's `bench` API:

- **Settled world** (active set empty) — lazy early-out check.
- **Active pour** (~100 falling water cells) — typical busy demo.
- **Full mixed bitmap** (256×128 = 32 K cells, all mobile) —
  worst case.
- **First-call seed scan** — one-shot O(W×H) cost.

Numbers from a dev laptop (i7, Node 22) recorded in
`docs-dev/04-tuning-research.md`. Informational; no regression
assertions because thresholds are hardware-dependent. Run via
`npm run bench`; compare before/after a change to see whether a
patch helped or hurt step cost.

### Files involved

- `tests/perf/CellularAutomaton.bench.ts` — bench fixture.
- `package.json` — `"bench": "vitest bench --run"` script.
- `docs-dev/04-tuning-research.md` — table of measured numbers
  + closure of action item #6.

---

---

## v2.7.1 / v2.7.2 — sim TSDoc + reactions (2026-05-01)

### v2.7.1 — Worked examples in TSDoc

`Material.burnDuration` and `Material.settleAfterTicks` TSDoc
gained tick-by-tick worked examples so the "lifetime in ticks"
semantics are unambiguous (no more "is it N or N-1 ticks?"
guessing). Closes research-doc action item #3.

### v2.7.2 — Water extinguishes fire on contact

`stepFire` now checks the four cardinal neighbors for a
`'water'`-simulation cell BEFORE the ignition pass and the
age tick; if found, BOTH cells turn to air. Cardinal-only
(diagonals don't react) keeps the rule local and matches user
intuition (you don't put out a fire by waving water at a
distance). Closes research-doc action item #5.

The previous behavior — water density-swapping into fire,
fire pushed out — would have been the implementation choice if
the priority were physics realism (water can't actually destroy
fire instantaneously). It surprised users in demo 09 who poured
water on burning wood and expected the fire to die. The
reaction now matches that expectation.

### Files involved (v2.7.2)

- `src/core/algorithms/CellularAutomaton.ts` — `stepFire`
  prepended with a 4-cardinal water check; `cardinals` array
  factored out so the ignition pass and the new check share
  the same direction list.
- `tests/core/algorithms/CellularAutomaton.test.ts` — describe
  block "fire density-swap & water reaction" rewritten:
  `water above fire` flipped from "no extinguish" to "both
  consumed"; new tests for water-beside-fire,
  water-diagonal-with-stones (cardinal-only), and
  water-soaked-fire-doesn't-ignite-wood. The other
  density-swap cases (gas, sand) are unchanged.

---

---

## v2.7.0 — per-material flowDistance (2026-05-01)

`Material.flowDistance?: number` overrides the module-default
`4` so each fluid kind can have its own spread rate per tick.
Closes action item #4 from the v2.5 research doc.

- **Range**: integer `0..16`. `0` disables horizontal flow
  entirely. `16` is the upper budget (a fluid spreading 16
  cells per tick on a busy board is already at the visual
  noise floor; higher distances aren't useful and would just
  burn cycles). Validated at `MaterialRegistry.register`;
  out-of-range throws.
- **Defaults**: `'sand'`-simulation always uses `0` regardless
  of the material's `flowDistance` field (sand is granular
  by definition). `'water'` / `'oil'` / `'gas'` fall back to
  the module-default `4` when `flowDistance` is omitted.
  `'fire'` and `'static'` ignore the field.
- **Recommended values**: `lava: 2`, `oil: 3`, `water: 4`,
  `gas: 6`, `honey: 1`. Demo 09 now uses `oil: 3` (slightly
  viscous) and `gas: 6` (aggressive lateral spread) for
  visual differentiation.

### Files involved

- `src/core/types.ts` — `Material.flowDistance?: number` with
  TSDoc covering the recommended values and the
  sand/static/fire override behavior.
- `src/core/algorithms/CellularAutomaton.ts` —
  `FLUID_FLOW_DIST` renamed to `DEFAULT_FLUID_FLOW_DIST`;
  per-call `material.flowDistance ?? DEFAULT_FLUID_FLOW_DIST`
  threaded into `stepFluid`.
- `src/core/Materials.ts` — registration validates
  `flowDistance ∈ 0..16` (integer) when set.
- `tests/core/Materials.test.ts` — 5 new validation tests
  (accept range, reject below/above, non-integer, omit).
- `tests/core/algorithms/CellularAutomaton.test.ts` — 3 new
  behavioral tests under "per-material flowDistance" using
  a 1-tall sealed channel to isolate horizontal flow:
  flowDistance=0 truly disables, higher distances reach
  farther in 1 tick, omitting the field matches `=4`.
- `examples/09-falling-sand/main.ts` — oil and gas now
  carry explicit per-material `flowDistance`.

---

---

## v2.6.2 — fix gas leveling oscillation (2026-05-01)

User-reported regression on demo 09: gas pours never establish a
flat layer at the ceiling, "looks like water did pre-v2.3."
Diagnosis: when an air pocket sits between two same-rank fluid
clusters (or a cluster and a wall), the per-tick `goRight` flip
combined with the per-cell `xEven` parity makes the pocket
shuffle one cell back and forth every tick. Visible as
flickering gas instead of a stable ceiling layer.

### Fix

`stepFluid`'s horizontal-flow scan now stops at the largest `d`
for which the cell ONE PAST the candidate target is not a
same-rank fluid. Concretely: when scanning right, if the cell
beyond the candidate target on the right is the same rank as
the source, the scan breaks before recording that target as a
move. The cell at the source either falls back to a shorter
target (still safe), an opposite-side target, or doesn't move.

The pocket then pins to whatever non-same-rank edge the cluster
butts up against (a wall, a different fluid, a static surface).
No more dance.

### Trade-off

In configurations where the air pocket lands between two
same-rank clusters with non-wall edges on both sides, it stays
in the middle rather than migrating to a wall. The visual is a
gas layer with a 1+ cell hole somewhere — still much better
than oscillation, but not perfectly flat. A future refinement
could bias the air pocket toward walls; out of scope for this
patch.

### Files involved

- `src/core/algorithms/CellularAutomaton.ts` — `stepFluid`
  horizontal-flow scan extended with the same-rank-beyond
  guard.
- `tests/core/algorithms/CellularAutomaton.test.ts` — two new
  tests under "gas leveling without oscillation": (1) gas in a
  sealed box reaches a state that's identical between tick 100
  and tick 200, (2) a pre-placed air pocket between same-rank
  clusters stays put across 50 ticks.

---

---

## v2.6.1 — registration-time validation for timer thresholds (2026-05-01)

`MaterialRegistry.register` now validates the per-cell timer
thresholds at registration time so the silent infinite-burn /
never-promote footguns from `04-tuning-research.md` are gone.
Throws on:

- A `'fire'`-simulation material with no `burnDuration` set.
- `burnDuration` outside `1..256` or non-integer.
- A material with `settlesTo` set but no `settleAfterTicks`.
- `settleAfterTicks` outside `1..256` or non-integer.

The bound `1..256` matches the `cellTimers` `Uint8Array`
saturation behavior: `current + 1 ≥ threshold` reaches `256`
once the timer pegs at `255`, so `256` is the practical max.
Above that, the threshold is silently unreachable and the cell
never burns out / never promotes.

### Files involved

- `src/core/Materials.ts` — extended `register` with the four
  range checks. Error messages name the field, show the offending
  value, and point at `docs-dev/04-tuning-research.md` for
  context.
- `src/core/types.ts` — TSDoc on `Material.burnDuration` and
  `Material.settleAfterTicks` updated to reflect the enforced
  range.
- `tests/core/Materials.test.ts` — 10 new tests covering accept
  cases at the boundaries (1, 256), reject cases below/above the
  range, missing-paired-field combinations, and non-integer
  rejection.
- `tests/core/algorithms/CellularAutomaton.test.ts` — two probe-
  derived tests that previously asserted `burnDuration=0` and
  `settleAfterTicks=0` are now `=1` (minimum legal value with
  identical observed behavior).

---

---

## v2.6 — in-demo code-snippet tutorials (2026-05-01)

Each demo annotates its `main.ts` with `// @snippet <slug>` …
`// @endsnippet` markers. At runtime the demo imports its own
source via Vite's `?raw` suffix and mounts a slide-out panel
showing one card per snippet, with title, description, and a
copy button. A top-level `examples/recipes/` page aggregates
every annotated snippet across demos into a single searchable
list.

### What shipped

- **`examples/_shared/code-panel.ts`** — pure-DOM panel
  module. `parseSnippets(source)` is a stateless string parser
  with 7 unit tests; `mountCodePanel(source)` mounts an
  idempotent panel on the page; `renderCard(snippet)` produces
  a reusable card DOM that the recipes index uses too. Styles
  are injected into the document head — no separate CSS file
  to manage. State (open/closed) persists per-demo in
  `localStorage`.
- **`examples/_shared/vite-env.d.ts`** — declares the `?raw`
  module shape so `tsc --noEmit` is happy with the imports.
- **`examples/recipes/`** — top-level Vite entry that
  imports `?raw` from each annotated demo and renders all
  snippets in source-grouped sections. Live search filters
  by slug, title, description, and code. New `recipes` link
  added to the demos landing footer.
- **Demos annotated** (initial v2.6.0): `03-physics`,
  `07-image-terrain`, `09-falling-sand`. 10 snippets total
  covering Box2D setup, terrain wiring, the update-order
  correctness pattern, dynamic-body spawn, image-as-terrain
  stamping, and four fluid-material kinds.
- **Extended (post-v2.7.3)**: `02-click-to-carve`,
  `04-falling-debris`, `06-worms-style`,
  `08-sprite-playground`. 13 more snippets: carve/deposit on
  pointer, wheel brush resize, chunk-repaint counting,
  debris callback wiring, per-frame extraction, contour-as-
  Graphics rendering, character body with fixed rotation,
  camera follow + bounds, grounded-via-bitmap-probe,
  explosion carve+impulse, AABB-pre-check pattern, runtime
  sprite-texture swap, alpha-outline visualization.
  **23 snippets across 7 demos** in the recipes index.
  Demos 01 and 05 are still un-annotated (low recipe value —
  basic rendering and a simpler subset of demo 08).

### Marker grammar

```typescript
// @snippet <kebab-slug>
// @title  <human-readable title>          (optional, falls back to slug)
// @desc   <one-line description>           (optional, can repeat)
<code lines — normal comments stay verbatim>
// @endsnippet
```

Marker lines are stripped from the rendered snippet; the
remaining body is dedented to column 0 so the "copy" button
gives clean paste-ready code. Unbalanced markers are silently
ignored — a half-finished annotation never breaks a demo.

### Files involved

- `examples/_shared/code-panel.ts` — parser + DOM mount + CSS.
- `examples/_shared/vite-env.d.ts` — `?raw` module declaration.
- `examples/recipes/index.html` + `examples/recipes/main.ts`
  — top-level recipes index.
- `examples/03-physics/main.ts` — 4 snippets + panel mount.
- `examples/07-image-terrain/main.ts` — 1 snippet + panel mount.
- `examples/09-falling-sand/main.ts` — 5 snippets + panel mount.
- `examples/index.html` — recipes link added to the footer.
- `tests/examples/code-panel.test.ts` — 7 parser tests.

---

---

## v2.5 / v2.6 plan (2026-05-01)

The original v2.5 entry — a VitePress concept-and-recipes site —
is retired. Reasoning: the README, `01-architecture.md`, the
auto-generated TypeDoc API ref, and the inline TSDoc on every
exported symbol already cover what a VitePress site would carry.
Several hours of scaffolding for marginal gain.

Replaced with two narrower deliverables that close real gaps:

### v2.5 — sim tuning research + simulation concepts doc

1. **`docs-dev/04-tuning-research.md`** — audit the cellular
   automaton's tunable parameters (`FLUID_FLOW_DIST`,
   `burnDuration`, `settleAfterTicks`) for sensible defaults and
   document their visual / perf trade-offs. Identify edge cases
   not currently tested:
   - `burnDuration = 0` (instant burnout?)
   - `settleAfterTicks = 0` (immediate settle?)
   - very tall water columns leveling under low `FLUID_FLOW_DIST`
   - dense fire fields (every cell on fire)
   - mixed-rank stacks (sand on water on oil on gas)
   - threshold > 255 (Uint8Array clamp behaviour)

   Add tests for any obviously-missing edge case. Output is the
   research doc + maybe a handful of new tests.
2. **`docs-dev/05-simulation.md`** — consolidate the cellular
   automaton design rationale that's currently scattered across
   TSDoc and `01-architecture.md`: density rules, per-cell L/R
   preference, bottom-up scan order + scan-order edge cases
   (rising-tunnel, fire-cascade), `movedThisTick` invariants,
   active-cell tracking semantics, settle/burn timers. The doc
   future-you reads to understand *why* the sim is shaped the
   way it is.

### v2.6 — in-demo code-snippet tutorials

Each demo's `index.html` renders the running game alongside the
relevant source as an extractable, copy-pasteable snippet card.

- **`examples/_shared/code-panel.ts`** — at demo load time,
  fetches the demo's own `main.ts`, parses
  `// @snippet:start <name>` / `// @snippet:end` markers (with
  optional `// @snippet:desc <prose>` lines), renders each block
  as a discrete card with a "copy" button. Side panel on
  desktop, collapsed-below on mobile.
- **Syntax highlighting** via Shiki loaded as an ES module
  (zero runtime, modest grammar bundle). No VitePress.
- **`examples/recipes/`** — top-level page aggregating every
  annotated snippet across demos into a flat searchable list.
  "All the ready-to-paste snippets in one place."
- Initial scope: annotate demos **03 (physics)**, **07 (image
  terrain)**, **09 (falling sand)** — the highest-traffic
  recipes. Other demos picked up incrementally.

---

---

## v2.4 — sparse active-cell tracking (2026-05-01)

The cellular automaton no longer scans the full bitmap every tick.
Instead it iterates a per-bitmap **active-cell set** containing
just the cells that might have changed since the last tick (or are
known to have ongoing state like a fire timer or sand rest
counter). For mostly-settled worlds the call is effectively free —
the set drops to size 0 and `step` returns immediately.

### What shipped

- **`ChunkedBitmap.activeCells: Set<number>`** — sparse set
  encoded as `y * width + x`. Lazy-allocated; same pattern as
  `cellTimers`. Public read access.
- **`ChunkedBitmap.enableActiveCellTracking()`** — initializes
  the set and seeds it with every non-air, non-static cell
  currently in the bitmap. Idempotent. Called automatically from
  `CellularAutomaton.step` on its first run, but exposed so users
  who want the auto-mark side-effect on `setPixel` to fire from
  game start can call it eagerly.
- **`ChunkedBitmap.markActive(x, y)`** — manual entry, used by
  the sim to keep cells with ongoing state in the rotation when
  `setPixel` wasn't called.
- **`ChunkedBitmap.hasActiveCellTracking: boolean`** — peek
  without lazy-init.
- **`setPixel` auto-mark** — once tracking is initialized, every
  mutation adds the changed cell **and its 8-cell Moore
  neighborhood** to the active set. External carve / deposit /
  paint ops, AND the sim's own swap-mutations, propagate
  activation organically without extra plumbing. No-op until
  tracking is initialized — non-fluid users pay zero overhead.
- **`CellularAutomaton.step` rewritten** to: enable tracking
  (lazy-seed), snapshot + sort active cells descending (= bottom-
  up rows), clear the live set, iterate. The `setPixel`
  auto-marks during processing populate the *next* tick's set;
  cells with ongoing state explicitly call `markActive` to stay
  in.
- **Per-kind activation rules:**
  - Sand that didn't move: drops from set unless the material
    has `settlesTo` + `settleAfterTicks` (rest-timer
    ticking) — those re-mark themselves.
  - Fluid (water/oil/gas) that didn't move: drops from set; a
    neighbor's `setPixel` auto-mark re-adds when conditions
    change.
  - Fire: always re-marks itself until the burn timer hits
    `burnDuration`. A lone flame ages and dies even with no
    flammable neighbors.

### Why this is safe (correctness invariants)

- **Bottom-up order preserved**: encoded indices sort descending =
  rows visit `y = H-1 → 0`, matching the prior full-sweep order.
- **`movedThisTick` still in use** for the rising-tunnel guard
  (gas) and the in-row horizontal-flow guard (water/oil/gas) —
  unchanged from v2.3.
- **First-call seeding** ensures cells placed by `setPixel`
  *before* the sim ever runs are picked up. The seed scan is
  O(W × H) once; subsequent ticks are O(active cells × log
  active cells).
- **No new race window**: snapshot to array + clear + iterate
  semantics mean `setPixel` calls during this tick build the
  *next* tick's set. The current iteration is read-only against
  the snapshot.

### Files involved

- `src/core/ChunkedBitmap.ts` — `_activeCells` field;
  `_touchActiveNeighborhood` private helper;
  `enableActiveCellTracking`, `markActive`, `activeCells`,
  `hasActiveCellTracking` public API; `setPixel` auto-mark hook.
- `src/core/algorithms/CellularAutomaton.ts` — `step` rewritten
  to consume the sparse set; `stepSand` and `stepFire` updated
  to re-mark themselves when their timer is ticking but they
  didn't move.
- `tests/core/ChunkedBitmap.test.ts` — 8 new tests covering the
  active-set API (lazy init, seeding, idempotency, neighborhood
  marking, bounds clipping, no-op edge cases).
- `tests/core/algorithms/CellularAutomaton.test.ts` — 8 new
  tests covering: first-step seeding, settled world drops to
  empty, settling-sand re-marks itself, stuck fluid drops, carve
  reactivates a stuck cell, fire stays active until burnout,
  empty-bitmap step is a no-op, settled-static stays out of the
  set across many ticks.

### Performance characteristics

- **Settled world**: `step` returns after a single empty-set
  check. ~10 ns.
- **Active pour (~50 falling cells)**: snapshot (50), sort
  (negligible), iterate (50 cell processes + ~9 setPixel
  auto-marks each ≈ ~450 set adds). Sub-millisecond.
- **First-call seed**: O(W × H) one-shot. Identical cost to a
  single full-sweep tick of the v2.3 implementation.
- **Carving non-fluid terrain (no fluid materials in play)**:
  zero overhead — `enableActiveCellTracking` is never called,
  `_activeCells` stays null, `setPixel` skips the auto-mark
  branch.

---

## v2.3 — multi-fluid expansion (2026-04-30)

The cellular automaton now supports five mobile fluid kinds plus
fire, all parameterised over a single generic `stepFluid` helper that
takes a vertical direction (`+1` for sinking, `-1` for rising), a
density rank, and a multi-cell horizontal flow distance.

### What shipped

- **Density-ranked vertical swap** — `gas (0) < air (1) < fire (2) <
  oil (3) < water (4) < sand (5)`. Sinking fluids swap with any cell
  of strictly lower rank below; rising fluids swap with any cell of
  strictly higher rank above. Static cells never swap regardless of
  rank.
- **`'oil'`** — liquid lighter than water. Floats on water (rank 3
  vs water rank 4 means oil's downward swap fails). Sand sinks
  through oil (5 > 3).
- **`'gas'`** — lighter than air; rises straight up, diagonal-up,
  horizontal flow. Bubbles up through liquids and sand.
- **`'fire'`** — stationary. Each tick ignites the first adjacent
  `flammable` neighbor (top, left, right, down); ages via the v2.2
  `cellTimers` storage; dies → air at `burnDuration` ticks.
  `Material.flammable?: boolean` and `Material.burnDuration?: number`
  are new fields.
- **Multi-cell horizontal flow for liquids and gas**
  (`FLUID_FLOW_DIST = 4`). Fixes the visible "water piles like sand"
  symptom during a continuous pour: with a single-cell-per-tick
  spread, pour rate trivially exceeded spread rate; with up to 4
  cells per tick the surface levels visibly while the user is still
  pouring.
- **Bottom-up scan + rising fluids guard**. The outer loop visits
  rows in `y = H-1 → 0` order so falling material doesn't get
  re-processed. Rising fluids move *against* that order, so without
  protection a gas cell would tunnel from the bottom row to the top
  in a single tick. Fix: when `stepFluid` performs an upward swap
  (vertical or diagonal), add the destination index to
  `movedThisTick` so the not-yet-visited row skips it.
- **Fire spread cascade guard**. When fire ignites a neighbor, that
  neighbor is also added to `movedThisTick` — without it, fire would
  walk an entire flammable line in one tick instead of one cell per
  tick.
- **Demo 09 expansion** — keys 1–6 select sand / water / oil / gas /
  fire / wood. The terrain regen seeds a wooden plank inside the
  funnel so fire has something to burn out of the box.

### Files involved

- `src/core/types.ts` — `SimulationKind` extended; `Material`
  gains `flammable?` and `burnDuration?`.
- `src/core/algorithms/CellularAutomaton.ts` — full rewrite.
  Generic `stepFluid` + thin wrappers for sand/water/oil/gas;
  separate `stepFire`. Density rank constants; `canVerticalSwap`
  helper; multi-cell flow loop.
- `tests/core/algorithms/CellularAutomaton.test.ts` — 15 new tests
  for oil floating, water sinking through oil, sand sinking through
  oil, oil multi-cell flow, gas rising through air / water / static
  edge / pocket-escape, fire burnout / ignition / chain spread /
  static-non-flammable, multi-cell water column leveling.
- `examples/09-falling-sand/main.ts` — registers `OIL`, `GAS`,
  `FIRE`, `WOOD`; key bindings 3 / 4 / 5 / 6; `countFluids` extended;
  hint text updated; wooden plank seeded by `regenerateTerrain`.

The library now has its public Phaser entry point: register
`PixelPerfectPlugin` once at game creation (mapping `'pixelPerfect'`)
and inside any scene you get `scene.pixelPerfect.terrain({...})` as
a factory. The factory supplies the scene automatically and tracks
created terrains for auto-destroy on scene shutdown. Auto-flush of
terrain dirty state runs on Phaser's `POST_UPDATE` event; demos that
manage their own physics step (`b2.WorldStep` inside scene update)
should still call `terrain.update()` manually before the step so
colliders are fresh — see demo 04 for the pattern.

Collider model: **per-chunk** (one static body per chunk that has solid
pixels). Each chunk's solid mass is independently triangulated via
earcut. Carving in chunk A only rebuilds chunk A's body; bodies on
other chunks keep their contacts. The Phase 2.5 cross-chunk stitching
work has been retired — two-sided polygons make sharing a chunk
boundary edge between adjacent polygons safe (no seam tunneling), so
the per-blob global rebuild is no longer required.

---

## Phase 3 progress (in detail)

### What works

- **`src/phaser/TerrainRenderer.ts`** — per-chunk canvas-backed rendering. Each chunk gets its own `<canvas>` registered via `textures.addCanvas`, painted from the bitmap on `repaintDirty()`. Verified visually in demos 01–04.
- **`src/phaser/DestructibleTerrain.ts`** — composite GameObject that owns the bitmap, renderer, and (optionally) the physics adapter + queue. Public surface: `carve.{circle,polygon,fromAlphaTexture}`, `deposit.{...}`, `isSolid`, `sampleMaterial`, `raycast`, `surfaceY`, `extractDebris`, `update`. Scene-coordinate in / scene-coordinate out for every method.
- **Origin alignment** — `Box2DAdapter` accepts `originPx` so terrain colliders sit at the same scene position as the rendered terrain. Without it, balls in demo 03 fell onto invisible terrain at the bitmap's local origin instead of where the terrain rendered.
- **`extractDebris` + `onDebrisCreated` callback** — detected detached islands get carved out of the bitmap and queued as dynamic bodies on the next `update()`. The callback fires once per body created, with `{ bodyId, contour, material }` so the demo can build a Phaser Graphics outline that stays synced to the body.

### Demos (all in `examples/`, built into `docs/`)

| # | What it tests | Status |
|---|---|---|
| 01 — basic rendering | TerrainRenderer paints a procedural bitmap | ✅ user-verified |
| 02 — click to carve | input + carve + chunk repaint | ✅ user-verified |
| 03 — physics colliders | Box2D world, drop balls, debug overlay | ✅ user-verified |
| 04 — falling debris | DebrisDetector + dynamic bodies, floating brick falls on load | ✅ user-verified |

Build / deploy: `npm run build` writes the demo bundle into `docs/` (committed). No CI; rebuild and commit when changing demos. `vite.config.ts` uses `base: './'` so the build works at any URL prefix.

---

## RESOLVED (2026-04-30): sub-pixel jitter on actively-carved chunks

Closed by force-settle in `Box2DAdapter.restoreDynamicBodies`. Kept
here as a design record so the rationale isn't lost.

### Original symptom

A dynamic body resting on the **same chunk** the user was currently
carving saw a small per-frame motion during continuous-drag carve.
Each frame's carve dirtied the chunk, the static body was destroyed
and recreated, and `b2DestroyShapeInternal` woke every dynamic body
contacting it via its hardcoded `wakeBodies = true`. Snapshot/restore
preserved the body's pre-rebuild state — but the cycle of "wake →
gravity for one step → narrow-phase contact recreation → resolve
back" injected a small velocity each frame that didn't fully
dissipate before the next rebuild. Visible as sub-pixel shimmer.

Bodies on **other** chunks were always unaffected (per-chunk
colliders preserve their bodies, contacts, and awake state across
the rebuild).

### Fix

`restoreDynamicBodies` now has a force-settle path. After the
existing transform restore, it inspects the snapshot's
`(linVel, angVel)` and the body's current AABB:

- If the body has at least one static shape overlapping its AABB
  AND its pre-rebuild speed² is below
  `FORCE_SETTLE_SPEED2_THRESHOLD` (currently `0.01`,
  ~0.1 m/s) → zero the velocity and force-sleep, regardless of
  pre-rebuild awake state. Box2D's natural sleep timer can't reach
  `sleepTime` under continuous-rebuild waking; this short-circuit
  is what the timer would have done if it could.
- Otherwise → preserve velocity, keep awake (or wake if no support
  to avoid the ghost-float edge case).

The threshold is tighter than Box2D's natural sleep threshold
(`0.05`) so bodies in the band `[0.01, 0.05]` are still left to
Box2D's own timer when they're not in the rebuild cycle.

### Trade-off

A body that's *transiently* moving slowly (e.g. a ball mid-settle
after just landing, decelerating from a collision) and overlaps a
static AABB will be force-settled too eagerly during heavy carving.
The threshold is tight enough that genuinely-rolling or -falling
bodies are preserved; bodies in the narrow `[threshold, sleep
threshold]` band would have settled within `sleepTime` anyway.
In practice the bouncing-ball-while-actively-carving case is rare;
the common case (settled debris stops shimmering during drag) is
the win.

### Files involved

- `src/physics/Box2DAdapter.ts` — `FORCE_SETTLE_SPEED2_THRESHOLD`
  constant; `restoreDynamicBodies` rewritten with the
  `hasSupport && (lowVelocity || !s.awake) → force-settle` branch.
- `tests/integration/Phase2Pipeline.test.ts` — two new cases:
  "force-settles a low-velocity awake body with support" and
  "preserves velocity for fast-moving bodies even with support
  nearby". The existing "stays asleep with support", "wakes a body
  whose support was carved out", and velocity-preservation tests
  still pass — the behavior is a strict superset.

---

## RESOLVED (2026-04-30): ghost-float when carving directly under a settled body

Follow-up to the snapshot/restore work. The original implementation
unconditionally restored `awake = false` on bodies that were sleeping
pre-rebuild. That was correct as long as the body still had support
after the rebuild — but if the user carved *directly under* a settled
body, that body's support polygon was gone yet `awake = false` made
the next world step skip the body entirely. The body would hang
suspended in midair until something disturbed it. Visible as
"elements just hang in 1 place even without ground" in demo 04 user
testing.

### Fix

`Box2DAdapter.restoreDynamicBodies` now detects whether each body
still has static support before re-sleeping it:

```
desiredAwake = preRebuildAwake || !hasStaticUnderAABB(body)
```

`hasStaticUnderAABB` runs a `b2World_OverlapAABB` query on the
body's exact computed AABB (via `b2Body_ComputeAABB`) and returns
`true` if any static shape's AABB intersects. Triangle polygons are
small and per-chunk, so a polygon directly under the body has its
AABB touching the body's AABB; a body whose support was carved out
has the nearest static at least one carve radius away.

Bodies that were awake pre-rebuild stay awake (regardless of support
detection). Bodies that were asleep go back to sleep only if support
exists; otherwise they're left awake so the next step's gravity
integration drops them naturally.

### Files involved

- `src/physics/box2d.ts` — exposed `b2Body_ComputeAABB`.
- `src/physics/Box2DAdapter.ts` — new private
  `hasStaticUnderAABB(bodyId)`; `restoreDynamicBodies` gates the
  awake restore on it.
- `tests/integration/Phase2Pipeline.test.ts` — updated the
  "stays-asleep" test to actually rest the body on terrain (the old
  test had the body in midair, which only stayed asleep due to the
  bug); new "wakes a body whose support was carved out (no
  ghost-float)" regression carves a hole directly under a sleeping
  body and asserts both `IsAwake = true` and that subsequent world
  steps move the body downward.

### Visual verification

User confirmation pending. To verify: in demo 04, settle the brick
on the ground, then carve directly under it — the brick must fall.
In demo 03, settled balls remain settled when carving away from
them; carving directly under a settled ball drops it into the hole.

---

## RESOLVED (2026-04-30): vibration on demo 03 — per-chunk colliders

After snapshot/restore landed (below), demo 04's debris was stable but
demo 03's balls still jittered when the user clicked-and-held the
brush — even on chunks far from the cursor. The structural cause was
that the entire hill in demo 03 was one connected blob, which under
the per-blob global rebuild model was represented as **one static
body**. Any carve anywhere on the hill rebuilt that body, which
destroyed every contact bound to it, which woke every ball touching
the hill. Snapshot/restore preserved their kinematic state across the
rebuild but couldn't prevent the next world step's narrow-phase from
recreating contacts and re-waking the bodies. Awake balls on a curved
slope ricochet against subtly different contact normals each frame,
producing the visible vibration.

### Fix

Switch from per-blob global rebuild to **per-chunk colliders**. Each
chunk owns its own static body whose triangulated polygons are
extracted from just that chunk's pixels. Adjacent chunks each carry a
polygon along their shared boundary; with two-sided polygons (the
prior fix) this is safe — combined the two polygons act as one solid
mass for any body resting on top, and a body sliding across the seam
just transitions from one polygon's contact to the other's.

What changes:

- New `chunkToContours(chunk, bitmap, epsilon)` in
  `src/physics/ContourExtractor.ts` — single-chunk extraction with
  1px air padding so every contour closes within the chunk.
- `DeferredRebuildQueue.rebuildTerrain` rewritten: iterate dirty
  chunks only, extract per-chunk contours, `contoursEqual` skip,
  rebuild only changed chunks. Snapshot/restore is now scoped to the
  union AABB of dirty chunks (not the whole bitmap), so bodies on
  unaffected chunks are untouched and their Box2D awake-set state is
  not perturbed.
- The Phase 2.5 global flood-fill / `componentToContours` /
  rep-chunk routing is gone from the queue's hot path.
  `componentToContours` itself stays in `ContourExtractor.ts` because
  `DebrisDetector` still uses it (debris is one component, sized
  arbitrarily across chunks).

### What this fixes

- Carving in chunk A leaves chunks B…N's bodies (and their contacts)
  exactly as they were. Settled balls on those chunks aren't woken.
- A body actively rolling across the seam between chunk A (being
  carved) and chunk B does see one frame of contact disturbance —
  unavoidable and small.

### Trade-offs

- **More bodies.** Demo 03's hill went from 1 static body to ~10
  (one per occupied chunk). Box2D handles thousands fine; not a perf
  concern.
- **Adjacent chunk polygons share a boundary edge.** This is fine for
  bodies resting on top (they don't penetrate either polygon, no
  artifacts) and fine for bodies penetrating the terrain (push-out is
  toward the air-touching surface, not the internal seam). A body
  sliding horizontally across a chunk seam may have a 1-frame contact
  transition; in practice imperceptible.

### Files involved

- `src/physics/ContourExtractor.ts` — new `chunkToContours` helper
  alongside the existing `componentToContours`.
- `src/physics/DeferredRebuildQueue.ts` — `rebuildTerrain` rewritten
  to per-chunk; class-level docs updated; `FloodFill.findAllComponents`
  import removed.
- `tests/integration/Phase2Pipeline.test.ts` — the "Phase 2.5 pipeline
  — cross-chunk blob support" describe block was rewritten as
  "Per-chunk colliders — cross-chunk blob support" with assertions
  reflecting one-body-per-occupied-chunk. New test:
  "carving in one chunk does not rebuild bodies in other chunks"
  asserts body-handle stability for unaffected chunks.

### Visual verification

User confirmation pending. To verify: `npm run dev` →
`http://localhost:5173/03-physics/`. Spawn a few balls (space bar),
let them settle, then click-and-hold the carve brush on the opposite
side of the hill. Expected: settled balls do not vibrate. The carve
location's terrain still rebuilds normally; only that chunk's body
is destroyed/recreated.

---

## RESOLVED (2026-04-30): dynamic bodies vibrate / tunnel during continuous carve

This is the *follow-up* fix to the polygon triangulation work below. After
A landed, demo 04 stopped behaving like "non-convex shelves don't fall as
solids," but a more subtle issue remained: while the user holds and drags
the carve brush, **every** dynamic body in the world (even ones nowhere
near the cursor) would jitter, sometimes embed in the ground, sometimes
fall through it.

### Root cause

Each terrain rebuild destroys the old static body and creates a fresh one.
`b2DestroyShapeInternal` (PhaserBox2D.js:3142–3168) destroys every contact
that touches the destroyed shape and **wakes the contacted bodies**
(`wakeBodies = true` at line 3173 is hardcoded; there's no public way to
suppress it). With the entire ground+shelves of demo 04 being a *single*
connected blob, a carve anywhere on it rebuilt that one body, which woke
every body resting on it. Each woken body then ran one step's worth of
gravity in free-fall (~0.07 px at gravity = 15, dt = 1/60), then resolved
penetration against the new polygons — restitution kicks the body back
upward at ~10% of the impact speed. Repeat at 60 Hz → continuous jitter.
Cumulative drift could push a body laterally into a region the user had
actually carved away, where it would fall through.

### Fix (this commit)

**Snapshot every dynamic body's kinematic state before the rebuild,
restore it after.** New API on `Box2DAdapter`:

- `snapshotDynamicBodies(aabbPx)` — uses `b2World_OverlapAABB` to find
  every shape overlapping a pixel-space AABB, dedupes to bodies,
  filters to dynamic via `b2Body_GetType`, captures
  `(transform, linearVelocity, angularVelocity, awake)`.
- `restoreDynamicBodies(snapshots)` — writes the state back, restoring
  the awake flag *last* so `SetTransform` / `SetLinearVelocity` (which
  internally wake) don't override the asleep state.

`DeferredRebuildQueue.rebuildTerrain` snapshots over the bitmap's full
pixel region before doing the global per-blob rebuild loop, then restores
afterward.

### What this fixes

- **Sleeping settled bodies stay asleep.** No gravity integration on
  sleeping bodies → no per-frame sink → no bounce. Visible jitter gone.
- **Awake bodies in flight keep their motion.** No spurious velocity
  loss/gain across rebuilds.
- **No lateral drift into carved-out holes.** The body's transform is
  written back exactly, so it stays where it was.

### Behavior shift to be aware of

If the user carves directly *under* a settled body, the body's contact
support disappears — but the snapshot captured `awake = false` and we
restore it to `false`. So the body falls one frame *late* (the next
disturbance — gravity once awake, an impulse, etc. — wakes it). In
practice the next world step finds the body's AABB no longer overlapping
the terrain's polygons in the right way; Box2D wakes it for solver
attention, and gravity takes over. Visually imperceptible, but it's a
real change worth knowing.

### Files involved

- `src/physics/box2d.ts` — extended typed binding with `b2AABB`,
  `b2Rot` constructor, `b2DefaultQueryFilter`,
  `b2World_OverlapAABB`, `b2Shape_GetBody`, `b2Body_GetType`,
  transform/velocity/awake getters and setters.
- `src/physics/Box2DAdapter.ts` — new `BodySnapshot`,
  `snapshotDynamicBodies`, `restoreDynamicBodies`.
- `src/physics/DeferredRebuildQueue.ts` — wraps the `rebuildTerrain`
  body-churn loop with snapshot/restore.
- `tests/integration/Phase2Pipeline.test.ts` — new
  "snapshot/restore across rebuild" describe block: transform
  preservation, velocity preservation, sleep state preservation,
  static-body exclusion, and a `b2World_Step`-after-restore
  regression test (see "subtle gotcha" below).

### Subtle gotcha — `b2Body_SetTransform` requires a real `b2Rot`

Initial implementation passed a plain `{ c, s }` object literal as
the rotation argument. Tests passed (they never stepped the world);
the demos crashed on the first frame after a carve with
`TypeError: this.q.clone is not a function` deep inside
`b2BodySim.copyTo`. Source-read at PhaserBox2D.js:10723–10726
shows `b2Body_SetTransform` *aliases* the passed object into
`bodySim.transform.q` and `bodySim.rotation0`; the next
`b2World_Step` calls `.clone()` on it via `b2BodySim.copyTo`, and a
clone-less plain object crashes the step.

Fix: expose `b2Rot` from `box2d.ts` and pass `new b2Rot(rc, rs)`.
The integration test now does a `b2World_Step` after restore so
this regression is caught at the test layer next time.

### Visual verification

User confirmation pending. To verify: `npm run dev` →
`http://localhost:5173/03-physics/` and `/04-falling-debris/`. Settle a
body, then click-and-hold the carve brush *anywhere* on the terrain
(including far from the body). Expected: the body stays put, no jitter.
Carve directly under the body: it falls.

---

## RESOLVED (2026-04-30): non-convex debris doesn't act solid; one-sided chains tunnel under rebuilds

**Status:** fixed by switching every collider — terrain *and* debris — from
`b2ChainShape` to triangulated `b2PolygonShape`s via earcut. Kept here as a
design record so the rationale isn't lost.

### Original symptom

Drop a ball (demo 03) or let the floating brick settle (demo 04). Click or
drag the carve brush *anywhere* (even on the opposite side of the world).
The settled body falls through the ground. In demo 04 there was a second
related symptom: when carving severed a neck, the leftover L-shaped piece
(shelf + neck stub) refused to fall as a solid — only small rectangular
fragments fell.

### Root cause (one cause, two symptoms)

`b2ChainShape` is **one-sided** by design — collisions only register on the
side the segment normal points to. That choice is correct for static
terrain (you only collide from outside) but it falls apart in two ways:

1. **Tunneling under continuous carving (terrain side):** every frame the
   bitmap mutates, `Box2DAdapter.rebuildChunk` destroys the old static
   body and creates a new one with new chain shapes. Destroying the body
   destroys every contact bound to those shapes — the dynamic body
   resting on the terrain loses support, gravity acts for the step's
   `dt`, then the new chain shapes are tested against the dynamic body's
   *current* position. If sub-pixel drift put it on the wrong side of a
   chain seam (one-sided!), the chain doesn't see it as a contact and
   the body keeps falling through the solid. Continuous drag means this
   happens every frame, accumulating drift.

2. **Non-convex debris doesn't act solid (debris side):** the legacy
   `createDebrisBody` tried `b2PolygonShape` first (convex + ≤8 verts)
   and fell back to a *closed* `b2ChainShape` for everything else. A
   shelf-plus-neck-stub left over after a carve is L-shaped (non-convex,
   6+ verts), so it took the chain fallback. Closed chains on a dynamic
   body barely register collisions because they're still one-sided —
   the body has no "inside," only an outline that might-or-might-not
   collide depending on which side things approach from. Result: the
   shelf piece stayed put while small rectangular fragments fell as
   expected.

### What was tried before A (landed earlier, kept)

1. **Skip rebuild when contours are bit-identical to last frame** —
   `DeferredRebuildQueue.rebuildTerrain` calls `contoursEqual(...)` and
   bails out if true. Still useful: cuts churn for blobs unaffected by
   a given carve. Stays in.
2. **Reorder demo update loop: rebuild before step** — both demos now
   call `terrain.update()` *before* `b2.WorldStep`. Stays in; cheap.

These cut the tunneling window from two steps to one. They didn't
eliminate it, because the *cause* (one-sided chain) stayed.

### What was tried (reverted, in commit history)

3. **Persistent body, swap chains only** — reverted because
   `phaser-box2d` 1.1's `b2DestroyChain` doesn't unlink the chain from
   the body's `headChainId` linked list, so a subsequent `b2DestroyBody`
   double-frees the chain pool (`RangeError: Invalid array length` in
   `b2FreeId`). The bug was traced in source on 2026-04-30 and is
   confirmed at PhaserBox2D.js:3260–3288 — the function frees the
   chain id but never updates `body.headChainId` or `chain.nextChainId`.

### What was tried (option B spike, ruled out by source-read on 2026-04-30)

4. **Per-shape destruction via `b2DestroyShape`** — `b2DestroyShape`
   *does* unlink correctly (PhaserBox2D.js:3144–3152), so the
   double-free is avoidable. But the spike's premise — that a persistent
   body would preserve contacts across rebuilds — is false: contacts
   are bound to *shapes*, not bodies (`b2DestroyShapeInternal`
   PhaserBox2D.js:3155–3164 walks the body's contact list and destroys
   every contact involving the destroyed shape). So even with the body
   kept alive, every contact dies and the dynamic body still free-falls
   into one-sided chains. B avoids the crash without fixing the bug;
   not landed.

### What landed (approach A, this commit)

5. **Triangulate every contour into `b2PolygonShape`s.** Earcut produces
   N-2 triangles per simple polygon. Each triangle becomes a single
   `b2PolygonShape` via `b2ComputeHull` + `b2MakePolygon` +
   `b2CreatePolygonShape`. Polygon shapes are **two-sided**: a body
   that ends up "inside" a triangle is pushed out by penetration
   resolution regardless of which side it approached from. This fixes
   both symptoms in one stroke:

   - Terrain: a settled body that drifts during the rebuild gap is
     pushed back out into the air on the next step. No more wrong-side
     tunneling.
   - Debris: an L-shaped shelf+stub becomes 4 solid triangles, which
     collide normally as a single dynamic rigid body.

   Files touched: `src/physics/ContourToBody.ts` (new
   `contourToTriangles`), `src/physics/Box2DAdapter.ts` (both
   `rebuildChunk` and `createDebrisBody` now go through it). Tests
   updated to assert the new shape counts; the legacy `contourToChain`
   and `contourToPolygon` functions stay exported (no internal callers,
   but they're tested independently and could be useful for users
   building their own colliders).

### Trade-off

More shapes per blob — a 40-vertex outline becomes ~38 triangles
instead of 40 chain edges, so the count is comparable. Box2D handles
triangle counts in the thousands without complaint. Repaint costs
unchanged (the visual side never used chain data).

### Files involved

- `src/physics/ContourToBody.ts` — new `contourToTriangles` helper.
- `src/physics/Box2DAdapter.ts` — `rebuildChunk` and `createDebrisBody`
  both route through `contourToTriangles`.
- `tests/physics/ContourToBody.test.ts` — new `contourToTriangles`
  describe block.
- `tests/physics/Box2DAdapter.test.ts` — assertions updated to expect
  triangle counts (not chain-edge counts).

### Visual verification

User confirmation pending. To verify: `npm run dev` →
`http://localhost:5173/03-physics/` and `/04-falling-debris/`, then run
the original repro (settle a body, then continuous-drag the brush
anywhere). Expected: the body stays put. In demo 04, carving through
a neck should drop the shelf as a single rotating L-piece.

---

## Phase 4 progress

- ✅ **Demo 06 — Worms-style** (`examples/06-worms-style/`). The
  trailer piece. Programmer-art circle character on a wide hilly
  bitmap; arrows / WASD walk + jump; F throws a fused grenade
  toward the cursor; explosion carves a crater and applies a
  radial impulse to nearby dynamic bodies; cliff slabs detached
  by the carve fall as debris bodies. End-to-end exercise of the
  per-chunk collider model under continuous interaction. Camera
  follows the player; G toggles a green-line collider debug
  overlay; R resets.
- ✅ **Demo 07 — image-based terrain**
  (`examples/07-image-terrain/`). Stamps an alpha mask onto the
  bitmap via `terrain.deposit.fromAlphaTexture`. The source canvas
  is drawn procedurally at preload (a stylized island with trees)
  to keep the demo self-contained, but the bridge from "PNG asset"
  to "destructible terrain" is identical: read the texture's
  source via `getImageData`, hand it to the deposit op. Two-pass
  deposit at different alpha thresholds gives multi-material
  terrain (sand outline + dirt core) from a single image.
- ✅ **Performance pass — TerrainRenderer hot loop.** Replaced the
  per-pixel `materials.get(id)` + 4-byte writes with a 256-entry
  packed-RGBA LUT keyed by material id, written through a
  `Uint32Array` view of the `ImageData.data` buffer. New helpers
  exposed: `paintChunkPixels(bitmapData, pixels32, colorLut)` and
  `buildColorLut(materials)` — both pure, both unit-tested
  without a Phaser scene. Bench result: **~10× speedup** on a
  128×128 chunk repaint (0.080 ms → 0.007 ms per call). The LUT
  is rebuilt every repaint (256 ops, negligible), so materials
  registered after construction are reflected automatically.

The four "phase 3 verification" demos (01–05) cover the basic
pipeline and the sprite collision feature. Demo 06 is the
"non-trivial gameplay scenario" demo. Demo 07 closes the
"library can ingest content from an image" use case.

## Original Phase 3 work (closed)

- ✅ **`PixelPerfectPlugin`** landed 2026-04-30. Per-scene plugin
  extending `Phaser.Plugins.ScenePlugin`; exposes
  `scene.pixelPerfect.terrain(options)` and
  `scene.pixelPerfect.sprite(x, y, key, frame?)` factories;
  auto-flushes terrains via `POST_UPDATE`; cleans up tracked
  terrains on `SHUTDOWN`/`DESTROY`. Module augmentation in the
  plugin file types `Phaser.Scene#pixelPerfect` so importing the
  plugin gets the type for free.
- ✅ **`PixelPerfectSprite`** landed 2026-04-30. Extends
  `Phaser.GameObjects.Sprite`. `overlapsPixelPerfect(other)` and
  `overlapsTerrain(terrain)` go through pure
  `core/queries/AlphaOverlap` helpers (`maskMaskOverlap`,
  `maskBitmapOverlap`) — keeps the per-pixel math out of the
  Phaser layer and unit-testable. Mask is extracted lazily on
  first overlap, cached, invalidated on frame change; respects
  `flipX` / `flipY`. v1 limits: no rotation, no scaling.
- ✅ **Demo 05** (`examples/05-pixel-perfect-sprite/`): drag a
  filled-circle sprite onto a ring sprite and a terrain patch.
  Outline color encodes overlap state — gray (no AABB), yellow
  (AABB only, false positive of cheap test), green (pixel-
  perfect). Sprite-vs-terrain shown alongside sprite-vs-sprite.

Phase 3 deliverables from `02-roadmap.md` are all done. A
`v0.3.0` tag is appropriate after the user verifies demo 05.

## Phase 5 progress (closed at `v1.0.0`)

- ✅ TypeDoc API reference. `npm run build` now runs `vite build`
  and then `npm run docs:api`, so `docs/api/` is regenerated as
  part of every build alongside the demos. Linked from README,
  CONTRIBUTING, and the demo landing footer.
- ✅ Repository conduct + onboarding. `CONTRIBUTING.md` covers
  the dev workflow (run/test/build/lint), Conventional Commits,
  testing expectations, and where to file issues.
  `CODE_OF_CONDUCT.md` is Contributor Covenant v2.1.
  `.github/ISSUE_TEMPLATE/bug.yml` and `feature.yml` capture
  structured repros / proposals.
- ✅ "View source" link on every demo's nav, pointing at the
  demo's `main.ts` on GitHub. Each demo now serves as both a
  runnable example and a copy-pasteable code reference.
- ✅ Demo 08 — sprite playground. Drag-and-test sandbox for
  `PixelPerfectSprite` with file-upload (or drag-and-drop) so
  the user can swap the sprite's texture for any PNG and watch
  the alpha-mask outline track. New `AlphaOverlap.maskToContours`
  primitive backs the outline rendering.
- ⬜ VitePress concept-and-recipes site under `docs-dev/site/` →
  `docs/site/`. Roadmap-budgeted but the README + SKILL.md +
  inline TSDoc + auto-generated API ref already cover most of
  what it would carry; deferring unless the perceived gap
  becomes real.
- ⬜ **Hero gif / video for README** — needs recording from a
  running dev server, can't be done from CLI. Suggested clip:
  ~30 s of demo 06 (Worms-style — walk left/right, lob a few
  grenades, watch a cliff slab detach). Drop the resulting
  `.gif` or `.webm` at `docs/media/hero.gif` (or similar) and
  link from README's top section. Optional for `v1.0.0`; can
  ship `v1.0.0` without it and add as a `v1.0.x` polish patch.
- ✅ Final TODO sweep + cross-doc consistency pass — landed
  2026-04-30 (`src/`, `tests/`, `examples/` are TODO-free; the
  architecture, changelog, and skill docs were reconciled with
  the per-chunk + polygon collider model).

---

## How to use this document

- Read top to bottom at the start of a Phase 3 session to catch up.
- When landing a fix or finishing an iteration, **update this file in the same commit** as the source change. Treat it like a CHANGELOG with one section per open or recently-resolved issue.
- Once an issue has been visually confirmed by the user *and* shipped in a tagged release, it's safe to prune from this file (the design rationale for the triangulation choice should move into `01-architecture.md` if it stays interesting beyond a few weeks).
