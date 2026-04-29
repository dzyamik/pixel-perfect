# Progress

Running ledger of what's done, what's in flight, and what's broken. Read alongside `CLAUDE.md` and `02-roadmap.md` to catch up at the start of a session.

> Last updated: 2026-04-29, mid-Phase-3

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

Test suite: 201 tests across 17 files, ~1.3 s. typecheck and lint clean.

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
| 03 — physics colliders | Box2D world, drop balls, debug overlay | ✅ visually right *until the open issue* (see below) |
| 04 — falling debris | DebrisDetector + dynamic bodies, floating brick falls on load | ✅ debris pipeline works *until the open issue* (see below) |

Build / deploy: `npm run build` writes the demo bundle into `docs/` (committed). No CI; rebuild and commit when changing demos. `vite.config.ts` uses `base: './'` so the build works at any URL prefix.

---

## OPEN: dynamic bodies tunnel through terrain on continuous carving

**Status:** unresolved as of 2026-04-29. Two partial mitigations landed (see below); user still reports it on demos 03 and 04.

### Symptom

Drop a ball (demo 03) or let the floating brick settle (demo 04). Then start clicking or dragging the carve brush — anywhere, even on the opposite side of the world from the settled body. The settled body falls through the ground.

### Root cause

`b2ChainShape` is **one-sided** by design — collisions only register on the side the segment normal points to. The library's terrain colliders are chain shapes, normals oriented to the air side, which is correct for terrain.

When the bitmap mutates, `Box2DAdapter.rebuildChunk` destroys the old static body and creates a new one with new chain shapes. The mechanism that breaks:

1. Body destroyed → all contacts on it are destroyed. The dynamic body resting on it loses support.
2. Gravity acts on the dynamic body for the next step's `dt`.
3. New body created with new chains.
4. Next `world.Step` runs narrow-phase against the new chains. If the dynamic body's current position is on the *wrong* side of a chain (even by sub-pixel), the chain doesn't see it as a contact (one-sided), and the body keeps falling through the solid.

The continuous-drag form is worst: every frame's carve dirties the bitmap, every frame the body is destroyed/recreated, every frame a settled ball loses and reacquires support.

### What was tried (landed)

1. **Skip rebuild when contours are bit-identical to last frame** — `DeferredRebuildQueue.rebuildTerrain` calls `contoursEqual(chunk.contours, contours)` and bails out if true. `componentToContours` is deterministic, so any blob whose bitmap state didn't change produces a bit-identical contour list and is skipped entirely. This catches every blob unaffected by a given carve (e.g. shelves 2 and 3 in demo 04 while shelf 1 is being carved).
2. **Reorder demo update loop: rebuild before step** — both demo 03 and demo 04 now call `terrain.update()` *before* `b2.WorldStep`. The step always sees fresh static bodies. Architecture rule #3 ("no body create/destroy inside a physics step") is still satisfied since the rebuild runs at the start of the frame's update, not during the step.

### What was tried (reverted)

3. **Persistent body, swap chains only** — keep the chunk's `b2Body` alive across rebuilds, destroy individual chains via `b2DestroyChain`, and reattach new ones. **Reverted** because `phaser-box2d` 1.1's `b2DestroyChain` does *not* unlink the chain from the body's `headChainId` linked list. A subsequent `b2DestroyBody` (e.g. on dispose, or when the chunk's contours go to empty) walks the dangling list and double-frees from the chain pool, causing `RangeError: Invalid array length` deep inside `b2FreeId`. Reproducible by every existing rebuild test if we re-enable the path.

The fix is noted in a comment in `Box2DAdapter.rebuildChunk` so future maintainers don't re-attempt the same approach without addressing the underlying phaser-box2d bug.

### Why the landed mitigations don't fully fix it

- **Single-blob worlds (demo 03's hill)**: the equality skip never fires because every carve mutates *the* blob's bitmap state, so its contour list always changes. The body still gets destroyed every frame, contacts still die, balls still tunnel.
- **Multi-blob worlds (demo 04 with floating brick + shelves + ground)**: the equality skip *helps*, but the blob the user is currently carving — and any blob a settled body is resting on — both get rebuilt. So a debris piece resting on the ground while the user keeps carving the ground itself still loses support every frame.

The reorder fix shrinks the window from "two steps of free-fall" to "one step of free-fall" but doesn't eliminate it. Continuous drag still produces enough cumulative drift over many frames to push a body across the chain shape's seam onto the wrong side.

### What to try next

Listed roughly in order of likely-yield vs likely-effort:

#### A. Polygon decomposition (triangulation) instead of chain shapes

Replace per-blob chain colliders with a triangulated polygon collider per blob. `phaser-box2d` exposes `CreatePolygonFromEarcut` (uses the Earcut.js library). Each blob's contour becomes N-2 triangles; each triangle is a `b2PolygonShape` (two-sided collision). A body that ends up "inside" a polygon gets pushed out by penetration resolution regardless of which side it entered from.

Cost: more shapes per blob (~40 triangles for a typical destructible-terrain outline), but Box2D handles triangle counts in the thousands fine. The API change is local to `Box2DAdapter.rebuildChunk` and `ContourToBody`; users won't see it.

This is what most published destructible-terrain Box2D demos do. Probably the right answer.

#### B. Per-shape destruction via `b2DestroyShape`

`b2DestroyChain` is the buggy entry point in phaser-box2d 1.1, but `b2DestroyShape` (operating on individual chain segments) might unlink correctly. We'd need to enumerate the body's shapes (`b2Body_GetShapes`) and destroy each one individually, then reattach new chains. Worth a 10-minute spike to verify the chain-segment shapes can be destroyed cleanly without the `b2DestroyChain` bug.

If this works, it gives us the persistent-body benefit without rewriting collider semantics, and is the lightest-touch fix.

#### C. Position-snapshot bodies before rebuild, restore after

Walk all dynamic bodies whose AABB overlaps the rebuilding chunk's AABB, snapshot their `(position, velocity)`, do the rebuild, then call `b2Body_SetTransform` and `b2Body_SetLinearVelocity` to restore. Avoids the "free-fall during rebuild" window. Doesn't fix one-sided chain shapes intrinsically but eliminates the trigger.

Heavier than A or B; we'd own the body-tracking complexity.

#### D. Continuous collision detection on dynamic bodies

`b2BodyDef` has `isBullet: true` for high-speed CCD. Settled bodies aren't fast though, so this probably doesn't help — but worth checking once we've narrowed which step is the source of the tunneling.

### Repro recipe

1. `npm run dev`, open `http://localhost:5173/04-falling-debris/`.
2. Wait for the floating brick at the top to settle on the ground.
3. Start dragging the brush *anywhere*. The brick falls through the ground within ~1 second of dragging.
4. Same with demo 03: drop balls, let them settle, drag.

### Files involved

- `src/physics/Box2DAdapter.ts` — `rebuildChunk` is where the destroy/create happens. The comment block there notes the failed persistent-body attempt.
- `src/physics/DeferredRebuildQueue.ts` — `rebuildTerrain` does the global flood-fill rebuild and the `contoursEqual` skip.
- `src/physics/ContourToBody.ts` — `contourToChain` is what produces the chain shapes today; would gain a polygon path under approach A.
- `examples/03-physics/main.ts`, `examples/04-falling-debris/main.ts` — update loop ordering.

---

## What's not yet started in Phase 3

- `PixelPerfectPlugin` — Phaser global plugin (architecture has it as the public entry point: `scene.pixelPerfect.terrain(...)`). Library currently exposes `DestructibleTerrain` directly; ergonomics work post-tunneling-fix.
- `PixelPerfectSprite` — alpha-aware sprite collision. Independent of the tunneling work; could be done in parallel by a fresh session.
- Cross-chunk stress test demo — a Worms-style scene with proper gameplay (character controller + grenades). Roadmap puts it as Phase 4 demo #2.
- Performance pass — chunk repaint uses per-pixel canvas writes; with the tunneling fix in flight we haven't profiled this yet.

---

## How to use this document

- Read top to bottom at the start of a Phase 3 session to catch up.
- When opening a new session to continue the tunneling fix: jump to "What to try next" and pick A first unless approach B's spike has been done.
- When landing a fix or finishing an iteration, **update this file in the same commit** as the source change. Treat it like a CHANGELOG with one section per open issue rather than per release.
