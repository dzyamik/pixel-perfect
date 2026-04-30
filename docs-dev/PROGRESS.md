# Progress

Running ledger of what's done, what's in flight, and what's broken. Read alongside `CLAUDE.md` and `02-roadmap.md` to catch up at the start of a session.

> Last updated: 2026-04-30, mid-Phase-3

---

## At a glance

| Phase | Status | Tag |
|---|---|---|
| 0 — bootstrap | ✅ done | — |
| 1 — core engine | ✅ done | `v0.1.0` |
| 2 — physics adapter | ✅ done | `v0.2.0` |
| 2.5 — cross-chunk stitching | ✅ done | `v0.2.5` |
| 3 — Phaser integration | 🟡 in flight | — |
| 4 — examples | (interleaved with Phase 3) | — |
| 5 — docs & polish | not started | — |

Test suite: 211 tests across 17 files, ~1.4 s. typecheck and lint clean.

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
| 03 — physics colliders | Box2D world, drop balls, debug overlay | ✅ tunneling fix landed 2026-04-30 (pending visual confirm) |
| 04 — falling debris | DebrisDetector + dynamic bodies, floating brick falls on load | ✅ tunneling + L-shape fix landed 2026-04-30 (pending visual confirm) |

Build / deploy: `npm run build` writes the demo bundle into `docs/` (committed). No CI; rebuild and commit when changing demos. `vite.config.ts` uses `base: './'` so the build works at any URL prefix.

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

## What's not yet started in Phase 3

- `PixelPerfectPlugin` — Phaser global plugin (architecture has it as the public entry point: `scene.pixelPerfect.terrain(...)`). Library currently exposes `DestructibleTerrain` directly; ergonomics work post-tunneling-fix.
- `PixelPerfectSprite` — alpha-aware sprite collision. Independent of the tunneling work; could be done in parallel by a fresh session.
- Cross-chunk stress test demo — a Worms-style scene with proper gameplay (character controller + grenades). Roadmap puts it as Phase 4 demo #2.
- Performance pass — chunk repaint uses per-pixel canvas writes; with the tunneling fix in flight we haven't profiled this yet.

---

## How to use this document

- Read top to bottom at the start of a Phase 3 session to catch up.
- When landing a fix or finishing an iteration, **update this file in the same commit** as the source change. Treat it like a CHANGELOG with one section per open or recently-resolved issue.
- Once an issue has been visually confirmed by the user *and* shipped in a tagged release, it's safe to prune from this file (the design rationale for the triangulation choice should move into `01-architecture.md` if it stays interesting beyond a few weeks).
