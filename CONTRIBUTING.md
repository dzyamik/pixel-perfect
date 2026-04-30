# Contributing to pixel-perfect

Thanks for considering a contribution. The library is solo-maintained
right now, so the bar for changes is "does it move the project forward
without expanding the v1 scope," not "is it polished." Drafts and rough
patches are fine — we'll iterate.

## Running locally

```bash
npm install
npm run dev      # vite dev server, opens the demo landing at http://localhost:5173/
npm test         # vitest run, ~1.4 s
npm run typecheck
npm run lint
npm run build    # writes docs/ (committed, deployed as the demo site)
```

`npm run build` also regenerates the TypeDoc API reference at
`docs/api/`. Don't commit a stale build — the `docs/` folder is a
build artifact treated as source for GitHub Pages, so it should
match `src/` and `examples/`.

## Project layout

```
src/core/      # pure TypeScript algorithms — bitmap, contours, queries
src/physics/   # Box2D adapter on top of phaser-box2d
src/phaser/    # Phaser plugin, GameObjects, renderer
examples/      # runnable demos (Vite multi-entry)
tests/         # vitest unit + integration
docs-dev/      # planning docs, PROGRESS, architecture, roadmap
docs/          # built artifact: demo site + api reference (committed)
```

The dependency direction is strict: `phaser/` may import `physics/` and
`core/`, `physics/` may import `core/`, `core/` imports nothing of ours
and no npm runtime deps. See `CLAUDE.md` for the full set of project
rules and `docs-dev/01-architecture.md` for the design intent.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) — one of:

- `feat:` new public-API behavior
- `fix:` a bug fix
- `perf:` a performance improvement
- `refactor:` no behavior change
- `docs:` doc-only
- `test:` test-only
- `chore:` build / tooling
- `revert:` revert a previous commit

Keep the subject under ~70 characters; expand in the body. A good
example to copy is `git log --oneline -20`.

## Tests

- Every `src/core/` export has a unit test. New exports must follow
  suit (target ≥ 90 % coverage on core).
- `src/physics/` is exercised via integration tests in
  `tests/integration/`.
- `src/phaser/` has manual coverage via the demos. Pure helpers
  exposed from the Phaser layer (e.g. `paintChunkPixels`,
  `buildColorLut` in `TerrainRenderer.ts`) get unit tests in
  `tests/phaser/`.

If you change a hot path, include a representative micro-bench in the
PR description so reviewers can see the before/after.

## Filing issues

Use the bug / feature templates under `.github/ISSUE_TEMPLATE/`. The
maintainer is solo, so a clear, minimal repro is the single biggest
factor in turnaround time. Include:

- Phaser version
- `phaser-box2d` version
- Browser + OS
- Minimal scene that reproduces the bug
- What you expected vs what happened

## Code style

- TypeScript strict mode. No `any` without justification.
- One concept per file. Match the structure in
  `docs-dev/01-architecture.md`.
- TSDoc on every exported symbol.
- Pure functions where reasonable; classes for stateful subsystems
  (`ChunkedBitmap`, `Box2DAdapter`).

## License

By contributing you agree your work is licensed under the project's
[MIT license](LICENSE).
