# 05 — Simulation concepts

Reference for the cellular-automaton fluid sim — *why* it's
shaped the way it is. Read this when extending it (new fluid
kinds, new interactions) or debugging surprising visuals.

> Companion: `04-tuning-research.md` covers parameter ranges
> and edge cases. This file covers design rationale.

---

## The bitmap is the only state

Every simulation step reads from and writes to one
`ChunkedBitmap`. There is no shadow buffer, no double-buffer
swap, no per-cell entity. A cell *is* its material id. State
that doesn't fit in 8 bits — fire timers, sand rest counters
— lives in a sidecar `Uint8Array(width × height)` (lazy-
allocated, auto-reset by `setPixel`).

The bitmap-as-truth invariant is what makes the sim, the
renderer, and the physics colliders all stay coherent: each
of them reads from the same `getPixel`. Fluid mutations
dirty their chunks, the renderer repaints, and physics
ignores them entirely (the contour extractor filters to
`'static'` materials only).

---

## Density ranks

```
gas (0) < air (1) < fire (2) < oil (3) < water (4) < sand (5)
```

Air is a hardcoded rank for cells with id `0`. All other
ranks come from the material's `simulation` field, looked
up at step time. Static materials return `Infinity` so they
never qualify for a swap regardless of direction; an
explicit `isStaticTarget` check short-circuits to make the
"static is immovable" rule unambiguous in the source.

A vertical swap happens when:

- **Down-moving** cell: `srcRank > targetRank` *and*
  target is not static.
- **Up-moving** cell: `srcRank < targetRank` *and* target
  is not static.

Diagonal slides and horizontal flow are **air-only** — they
don't follow density rules. The rationale: a true diagonal
density swap would move three cells (the slider, the
displaced cell, and what gets pushed sideways), which
would need careful bookkeeping to remain single-pass.
Restricting to air keeps the swap atomic.

---

## Bottom-up sweep, per-cell L/R preference

Two invariants govern within-tick correctness:

### 1. Process rows bottom-up

Iterating `y = H-1 → 0` ensures a cell that fell from row
`y` to row `y+1` doesn't get re-processed in the same tick
(row `y+1` was already visited). Without this, a sand grain
would fall multiple rows per tick and lose its
"one-cell-per-frame" feel.

For **upward-moving fluids** (gas), the same scan order is
*against* their motion: a gas cell at `y=5` rises to `y=4`,
then the loop continues to `y=4` (which is later in the
iteration since we go high→low) and would re-process the
same cell. Fix: when an upward swap completes, register
the destination index in `movedThisTick` so the not-yet-
visited row skips it.

### 2. Per-cell side preference

Within a row, fluids look left or right with preference
controlled by:

```ts
const xEven = (x & 1) === 0;
const preferRight = goRight === xEven;
```

Two interlocking biases:

- `goRight` flips per tick (`(tick & 1) === 0`), so the
  whole world's preference alternates each step.
- `xEven` makes adjacent cells in the same tick try
  *opposite* sides.

The combination is what stops a contiguous block of fluid
from shifting en masse to the preferred side. A pre-v2.3
implementation used per-tick uniform preference; the visible
symptom was "water piles like sand" during a continuous pour
— every cell tried to slide the same direction so the column
shifted instead of spreading.

### 3. `movedThisTick`

Per-tick `Set<number>` (cell indices) used three ways:

- **Rising tunnel guard** — gas's destination row.
- **Horizontal flow guard** — when a fluid spreads
  sideways within a row (`FLUID_FLOW_DIST > 0`), the
  destination cell must skip the rest of the row sweep so
  the same fluid doesn't tunnel further along the scan
  direction.
- **Fire ignition cascade guard** — when fire ignites a
  flammable neighbor, the freshly-lit cell is added to
  `movedThisTick` so the loop doesn't dispatch `stepFire`
  on it the same tick. Without this guard, fire walks an
  entire flammable line in one step instead of one cell
  per step.

`movedThisTick` is per-tick scratch and lives on the stack
of `step()`; not exposed.

---

## Pressure flow is always 1-cell (v2.7.5)

When the pressure rule fires (see below), the source moves to
the **nearest** air on its preferred side, not the farthest
reachable in `flowDist`. Multi-cell jumps under pressure would
skip intermediate cells, leaving them as internal gaps:

- A buried sand grain that jumps 2 cells leaves an air pocket
  inside the pile.
- A buried liquid cell that jumps 4 cells leaves visible holes
  in the floor row even after the column drains.

The 1-cell push always packs density-first: the source's old
position is filled by the column above (vertical density swap)
on the same tick, so the cluster shape stays solid.

## Surface compaction is a known limitation

Once a pour drains and surface cells no longer have a same-rank
cell above (no pressure), they can't bridge an air gap to merge
with another same-rank cell — the v2.6.2 oscillation guard
blocks the move. Local rules can't reliably distinguish "cluster
spreading into open space" (compaction OK) from "cluster chasing
a wall-anchored same-rank cell" (oscillation forever); the guard
is intentionally conservative.

In practice the surface IS flat — max height = 1 once the column
drains — but cells may be non-contiguous along the floor row.
A future improvement could add stochastic relaxation (small
chance per tick to merge across an air gap) or multi-pass
within-tick compaction, but neither is in scope for the v2.7.x
patches.

## Pressure-aware flow (v2.7.4)

The v2.6.2 same-rank-beyond guard prevents oscillation but is too
conservative for buried cells. A liquid cell at the bottom of a
tall column has same-rank cells on its sides AND above; the
pocket-dance oscillation problem doesn't apply because the cells
above are physically pressing it.

`stepFluid` checks for **pressure**: the cell directly opposite
the motion direction. For sinking fluids (water/oil) that's the
cell *above*; for rising gas, the cell *below*. If the pressure
cell is the same rank as the source, the source overrides the
oscillation guard and flows aggressively into the air past any
same-rank chain.

Result:

- Tall water columns drain in ~`colHeight` ticks (the leveling
  test asserts `≤ colHeight + 2`).
- Gas piling at a ceiling spreads under pressure from gas
  rising from below; once the column drains and individual
  cells have only walls or air below them, the v2.6.2 guard
  takes over and pockets pin to walls.
- Small isolated pockets (e.g. a single air gap between two
  same-rank fluid cells with no same-rank cell on the third
  side) still pin instead of oscillating — the pressure
  override only fires when there's actual pressure.

`stepSand` reuses the same idea via two module constants:

- `SAND_PRESSURE_THRESHOLD = 3` — minimum sand cells stacked
  directly above a grain before the pressure rule fires.
- `SAND_PRESSURE_FLOW_DIST = 2` — horizontal flow distance for
  buried grains. Smaller than fluid `flowDistance` because
  sand stays granular near the surface; the pressure rule is
  a release valve, not full liquefaction.

Visible effect: tall sand piles spread at the base
(`baseWidth ≥ pileHeight`) instead of forming the very-vertical
columns the strict 45° angle of repose would produce.

## Multi-cell horizontal flow (`FLUID_FLOW_DIST`)

A blocked fluid tries the diagonal-down path; if that
fails, it scans up to `FLUID_FLOW_DIST` cells in its
preferred horizontal direction and lands at the *farthest
reachable air cell*. The scan stops at the first non-air
cell, so flow never tunnels through other fluids — it
always settles next to its own column.

Default `FLUID_FLOW_DIST = 4`. The rationale is in
`04-tuning-research.md`: with a 1-cell-per-tick spread,
pour rate trivially exceeds spread rate and water visibly
piles. With 4-per-tick, leveling roughly tracks column
height up to ~20 cells.

`FLUID_FLOW_DIST` is module-private and applies to all
fluids and gas uniformly. Sand uses `flowDist=0` (no
horizontal flow) — sand is granular, not a fluid.

---

## Active-cell tracking (v2.4)

`step()` doesn't scan the whole bitmap. It iterates a
sparse `Set<number>` on the bitmap of cells that *might*
need processing this tick. The set is maintained
automatically:

- **First call** — `enableActiveCellTracking()` does a
  one-time scan and seeds the set with every non-air,
  non-static cell. Every later call is sparse.
- **`setPixel` auto-mark** — each mutation adds the
  changed cell *and its 8-cell Moore neighborhood* to the
  set. External carve / deposit / paint and the sim's own
  swaps both flow through `setPixel`, so activation
  propagates without additional plumbing.
- **Snapshot + clear** — at the start of each step, the
  current set is copied to an array, sorted descending
  (= bottom-up rows), and the set is cleared. Mutations
  during the tick populate the now-empty set with *next
  tick's* candidates.
- **Self-marking** — fire and settling-sand cells call
  `markActive(x, y)` explicitly when their timer ticks
  but no `setPixel` happens. Plain stuck fluids drop out
  and re-enter only when a neighbor's mutation re-adds
  them.

Cost: `O(N log N)` per tick where `N` is active cells.
Settled worlds are effectively no-ops; busy demos scale
with moving cells, not world dimensions.

The 8-cell Moore neighborhood (rather than a 4-cell von
Neumann or just the changed cell) covers diagonal slides:
when a sand cell at `(x, y)` becomes air, the cells at
`(x-1, y-1)` and `(x+1, y-1)` may want to slide into the
gap.

---

## Per-cell timers

`ChunkedBitmap.cellTimers` is a lazy-allocated
`Uint8Array(width × height)`. Two consumers:

- **Settling sand** — counts consecutive stationary ticks;
  promotes to `settlesTo` when `current + 1 >= settleAfterTicks`.
- **Burning fire** — counts elapsed ticks; the cell turns
  to air when `current + 1 >= burnDuration`.

Auto-reset behavior: `setPixel` clears the timer for the
mutated cell because the new occupant doesn't inherit the
previous one's timer.

**Saturation hazard**: `Uint8Array` clamps at 255. The
threshold check `current + 1 >= duration` will never fire
if `duration > 256`. See `04-tuning-research.md`.

---

## Fire is not static

`Material.simulation === 'fire'` makes the cell
*non-translating* (doesn't initiate motion in
`stepFire`), but fire **is still subject to density
swaps** initiated by neighbors. Gas can rise through a
fire cell, water can sink into it. Fire is a rank-2
material that happens to also have ignition + burnout
mechanics.

If you need fire that can't be displaced (a magic flame),
combine fire's behavior with `'static'` simulation — but
that's a hypothetical material we don't ship; you'd
implement a custom kind. Alternatively, layer a `'static'`
"hearth" material *under* the fire so neighboring fluids
don't see fire as the closest density target.

---

## What the sim does NOT simulate

These are deliberate non-features as of v2.4:

- **Water doesn't extinguish fire.** Pure density swap.
  See `04-tuning-research.md` action item.
- **Fire doesn't spread by radiative heat** — only by
  direct adjacency to a `flammable` cell.
- **Surface tension, viscosity, evaporation, freezing** —
  none.
- **Conservation under aggressive carving** — a carve
  that overlaps fluid cells deletes them with no
  preservation.
- **Arbitrary chemistry** — material A + material B → C
  reactions are not supported. The dispatch in
  `CellularAutomaton.step` is a switch on
  `simulation`; adding a reaction would need a new
  helper and an extension to the registry.

Adding any of these is a feature, not a bug fix. Each
would need its own design pass; the active-cell tracking
infrastructure is the right hook (a reaction can mark
neighbors active when conditions change).

---

## Where the code lives

| Concept | File | Symbol |
|---|---|---|
| Public step entry point | `src/core/algorithms/CellularAutomaton.ts` | `step` |
| Density rank table | same file | `RANK_*` constants, `densityRank` |
| Generic fluid step (sand / water / oil / gas share) | same file | `stepFluid` |
| Sand-specific (no flow + settle hook) | same file | `stepSand` |
| Settle-timer logic | same file | `maybeSettle` |
| Fire ignition + burnout | same file | `stepFire` |
| Active-cell set | `src/core/ChunkedBitmap.ts` | `activeCells`, `enableActiveCellTracking`, `markActive`, `setPixel` auto-mark |
| Per-cell timer storage | same file | `cellTimers` |
| Material kinds + flags | `src/core/types.ts` | `SimulationKind`, `Material.flammable`, `Material.burnDuration`, `Material.settlesTo`, `Material.settleAfterTicks` |
| Demo materials & registration | `examples/09-falling-sand/main.ts` | top of file |
