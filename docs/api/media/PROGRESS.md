# Progress

Running ledger of what's done, what's in flight, and what's broken. Read alongside `CLAUDE.md` and `02-roadmap.md` to catch up at the start of a session.

> Last updated: 2026-04-30, mid-Phase-3 (physics correctness done, plugin/sprite next)

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
| v2.4 — active-cell tracking (perf) | ⬜ planned | — |
| v2.5 — VitePress concept-and-recipes site + tutorial | ⬜ planned | — |

Test suite: 291 tests across 20 files, ~1.7 s. typecheck and lint clean.

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
