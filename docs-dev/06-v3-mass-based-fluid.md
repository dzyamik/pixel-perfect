# 06 — v3.0 mass-based fluid simulation (planning sketch)

> Drafted 2026-05-01 alongside the v2.7.6 anti-oscillation patch.
> Not yet implemented.

The v2.x cellular automaton uses **binary cell occupancy** —
each cell holds one material id. Liquids are either present or
absent. This is the model used by the basic falling-sand
articles (W-Shadow's "Falling Sand" tutorial, winter.dev) and
by Noita.

The user-reported "surfaces don't flatten" issue, plus the
v2.7.6 column-drain spread limitation, are both fundamental
properties of binary cell models. **Every fluid sim that
actually flattens uses a mass-based model**: each cell stores a
continuous mass (Float), and water transfers as a *quantity*
between neighbors, with overflow producing implicit pressure.

This file sketches the v3.0 design that adopts that model.

---

## What the canonical mass-based algorithm looks like

From W-Shadow ([Simple Fluid Simulation With Cellular Automata](
https://w-shadow.com/blog/2009/09/01/simple-fluid-simulation/))
and jgallant ([2D Liquid Simulator](
http://www.jgallant.com/2d-liquid-simulator-with-cellular-automaton-in-unity/)),
DwarfCorp ([How Water Works in DwarfCorp](
https://www.gamedeveloper.com/programming/how-water-works-in-dwarfcorp)).

Each cell stores a `Float32` **mass** in addition to (or in
place of) a material id. The update rule per tick runs four
sequential transfers per cell, each operating on a delta:

```
const MaxMass = 1.0       // standard cell capacity
const MaxCompress = 0.02  // bottom cells can hold a tiny bit more
const MinMass = 0.0001    // below this, cell is "dry"
const MaxFlow = 1.0       // per-tick flow cap (anti-tunneling)

for each cell (x, y) with mass > MinMass:
    remaining = mass[x, y]

    // 1. Vertical down: how much should the cell below hold,
    //    given the total mass between us and it?
    flow = stableSplit(remaining + mass[x, y+1]) - mass[x, y+1]
    flow = clamp(flow, 0, min(MaxFlow, remaining))
    mass[x, y]   -= flow
    mass[x, y+1] += flow
    remaining    -= flow

    // 2/3. Lateral left/right: equalize one quarter of the
    //      difference per tick (gentler than half — half causes
    //      visible jitter).
    if remaining > 0:
        flow = (remaining - mass[x-1, y]) / 4
        // clamp & transfer
    if remaining > 0:
        flow = (remaining - mass[x+1, y]) / 4
        // clamp & transfer

    // 4. Vertical up — only if compressed (remaining > MaxMass).
    if remaining > MaxMass:
        flow = compressedExcess(remaining + mass[x, y-1])
        // clamp & transfer up
```

**`stableSplit(total)`**: given two stacked cells with
combined mass `total`, returns how much should sit in the
*bottom* cell at equilibrium. For `total ≤ MaxMass`, all of it
goes below. For `total > MaxMass`, the bottom holds
`MaxMass + (total - MaxMass) × MaxCompress / 2` and the rest
sits in the upper cell. This is the implicit pressure model —
a tall column accumulates compression, which spills laterally
once equalized horizontally and vertically.

**Pressure isn't tracked**. It emerges because deeper cells
end up with more mass than shallower ones, and the lateral
quarter-equalization spreads that excess until the surface
flattens.

---

## What changes in our codebase

### Storage

`ChunkedBitmap.chunks[i].bitmap` becomes either:

- (a) Two parallel arrays per chunk: `Uint8Array` material id +
  `Float32Array` mass. Material id keeps the public API; mass
  is implementation detail.
- (b) A single `Uint16Array` packing material id (8 bits) +
  fixed-point mass (8 bits, scale `0..255 = 0..1`). Halves
  memory vs option (a) but loses precision for very-deep
  pressure stacks.

Recommend (a). Memory cost: `chunkSize²` Floats per chunk ≈
4× the current per-chunk byte count. For the demo (`512×256`
bitmap with 64-pixel chunks = 32 chunks × 4096 cells × 4 B =
512 KB extra). Acceptable.

### Public API

`ChunkedBitmap.getPixel(x, y)` → returns `materialId` (unchanged).

New `ChunkedBitmap.getMass(x, y)` → returns `Float` mass for
liquid cells, `1.0` for static/sand cells (still binary), `0`
for air.

`ChunkedBitmap.setPixel(x, y, id)` → sets material id, mass
becomes `1.0` (full cell). Backwards-compatible.

New `ChunkedBitmap.setMass(x, y, mass)` → sets mass; if mass
drops below `MinMass`, also resets material id to `0` (air).

### `CellularAutomaton.step` becomes "mass step"

Sand, fire, static still use the v2.x binary rules.

Water / oil / gas switch to the four-step mass transfer:

1. Vertical down: solve stable split with cell below.
2. Lateral left, right: quarter-equalize.
3. Vertical up: only fires when over-compressed.

Density-rank rules still apply (water sinks through oil)
but operate on *mass thresholds* — water with mass `1.0`
displaces oil with mass `0.5` rather than swap-or-not.

### Materials

`Material.flowDistance` becomes a flow-rate multiplier rather
than a cell count. `flowDistance: 1` = full quarter-equalize
(default water). `flowDistance: 0.25` = quarter of that
(viscous lava). `flowDistance: 4` = aggressive (the old
default's behavior, but kept as a cap).

`Material.simulation: 'sand' | 'fire' | 'static'` keep their
v2.x binary semantics. Only the four `'water' | 'oil' | 'gas'`
kinds switch to mass.

### Visual

The renderer uses the material id (unchanged). To visualize
pressure / mass, an optional shader-effect overlay could
brighten over-compressed cells; not required for correctness.

### Settling

The v2.2 sand-pile-becomes-static bridge stays unchanged (sand
is still binary). Settled-sand promotion fires on the standard
"didn't move N ticks" rule.

### Active-cell tracking

`activeCells` semantics change slightly: a fluid cell counts
as active if its mass changed by more than some epsilon. Cells
at full mass surrounded by full-mass neighbors and a static
floor below are inactive. The set is still O(moving cells).

### Deprecations / removals

- `Material.flowDistance` semantics change (now a multiplier).
  Existing values `0..16` keep working as integer
  multipliers — but `flowDistance: 4` no longer means
  "4-cell jump per tick" (it means "4× the default rate").
- `bitmap.horizFlowSource` is unused for liquids (mass-based
  doesn't oscillate). Stays for sand pressure flow.
- v2.7.4 pressure-mode 1-cell flow is unused for liquids
  (mass overflow handles pressure). Stays for sand.

### Migration path for game code

For most users: zero changes. `terrain.deposit.circle(x, y, r,
materialId)` still works — it sets mass to `1.0` for the
deposited cells. `bitmap.setPixel` still works.

For users who want partial-fill cells (e.g. a wet sponge or a
puddle that drains over time): use the new `setMass` API.

---

## Open questions before implementation

1. **Determinism**: floating-point arithmetic is deterministic
   per platform but not always cross-platform. The
   architecture doc's "best-effort determinism for replay
   debugging" stays best-effort. Document the change.

2. **Performance**: each step does 4 transfers per fluid cell
   (was 1 in v2.x). With float math instead of byte compares,
   per-cell cost roughly doubles. Bench expectation: full
   mixed bitmap goes from ~7 ms/step to ~12-15 ms/step. Still
   well under a 16ms frame budget. We'll need to verify.

3. **Tuning**: `MaxCompress = 0.02` is W-Shadow's default. May
   need adjustment for our chunk size and visual feel.
   `MinMass = 0.0001` controls when cells "dry up" — too low
   leaves invisible droplets that count as active; too high
   loses water mass. Tune empirically.

4. **Density mixing**: in mass-based, oil cell with mass `0.4`
   sitting above water cell with mass `0.8` — does the oil
   spill in? Real-world: yes (oil floats but the oil layer
   has less mass than the water). Need a careful density-
   weighted stable-split function.

5. **Demo migration**: demo 09 expects integer cell counts
   for its stats overlay. Switch to mass sums (sum of all
   water masses across the bitmap = liquid volume).

6. **Test migration**: existing CellularAutomaton.test.ts
   asserts exact cell positions. Mass-based gives smoother
   results; many tests will need to relax to "mass within
   epsilon of expected" or switch to integral-mass-conservation
   asserts.

---

## Estimated scope

- 1-2 days: write the mass-transfer rules + tune MaxCompress.
- 1 day: migrate water/oil/gas materials in demo 09 + visual
  verification.
- 0.5 day: update tests (relax exact-position asserts; add
  mass-conservation asserts).
- 0.5 day: bench, doc, ship.

Total: ~3-4 days of focused work. Significant but bounded.

If we ship this, the user-reported flatness issue is fully
resolved (the canonical fix), the v2.7.6 anti-oscillation
memory becomes optional/legacy for sand only, and the project
moves to a better-grade fluid sim that can support future
features (pressure-driven gameplay, partial-fill cells,
draining puddles, viscosity).
