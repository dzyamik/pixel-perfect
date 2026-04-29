# 07 — Initial prompt

The first message to paste into Claude Code after Phase 0 bootstrap is complete. Designed to load context, verify understanding, and produce a Phase 1 plan before any code is written.

## When to use this prompt

After `06-bootstrap.md` Step 16. The repo exists, dependencies are installed, smoke tests pass. Open Claude Code from the repo root (`claude`) and paste the prompt below as your first message.

## The prompt

```
We're starting Phase 1 of the pixel-perfect project.

Before doing anything, please:

1. Read CLAUDE.md at the repo root.
2. Read docs-dev/01-architecture.md (full architecture).
3. Read docs-dev/02-roadmap.md, focusing on the Phase 1 section.
4. Read docs-dev/03-tooling.md to understand the toolchain conventions.
5. Read docs-dev/04-claude-code-setup.md to understand how we work together on this project.

Then, do the following before writing any code:

A. Summarize back to me, in your own words:
   - What this project is.
   - The three-layer architecture and the dependency direction between layers.
   - What "bitmap is the source of truth" means in practice.
   - The hard rules from CLAUDE.md.

B. Confirm that npm test currently passes by running it.

C. Propose a concrete plan for Phase 1, Week 1 (ChunkedBitmap + Materials):
   - The order in which you'll create files.
   - The order of tests vs implementation (TDD where it makes sense).
   - Any open questions or design decisions that need my input before you start.

Do not start implementing yet. Wait for my approval of your plan.

Constraints:
- Core layer (src/core/) must remain dependency-free. No imports from src/physics/ or src/phaser/. No npm dependencies.
- TypeScript strict mode. No `any` without explicit justification.
- Conventional Commits for commit messages.
- After significant changes: run `npm run typecheck && npm test && npm run lint`.
- One concept per file. Match the file structure described in 01-architecture.md.

Once you have my approval, we'll work in tight loops:
1. You write a small, focused chunk (one type, one function, or one set of tests).
2. We run tests.
3. We review and adjust.
4. Repeat.

Ready when you are.
```

## What a good response looks like

Claude should respond with:

1. A summary section that accurately reflects the architecture documents (three layers, bitmap-as-truth, deferred rebuilds, etc.). If the summary misses or distorts key points, ask Claude to re-read the relevant doc.

2. Confirmation that `npm test` runs (Claude Code can execute commands; let it).

3. A Phase 1 Week 1 plan, roughly:

   - Create `src/core/types.ts` first (foundational types).
   - Create `src/core/Materials.ts` and its tests.
   - Create `src/core/ChunkedBitmap.ts` and its tests.
   - Maybe propose a TDD order: write `types.ts`, then `Materials.test.ts` + `Materials.ts`, then `ChunkedBitmap.test.ts` + `ChunkedBitmap.ts`.

4. Open questions, possibly including:

   - Should `MaterialRegistry` be a class or a plain map?
   - How should out-of-bounds `getPixel` calls behave (return 0, throw, clamp)?
   - Should `ChunkedBitmap` be the only entry point, or should `Chunk` itself be a public type?

These are good questions. Discuss them, decide, then proceed.

## What a bad response looks like

If Claude Code does any of the following, course-correct before proceeding:

- **Starts writing code immediately** without summarizing or asking. Push back: "I asked for a plan first. Let's not implement yet."
- **Summarizes the architecture inaccurately.** Have it re-read the doc.
- **Proposes implementing all of Phase 1 in one pass.** This violates the "one concept per file, tight loops" working pattern. Ask for a smaller first chunk.
- **Adds dependencies to core.** Reject and remind it of the hard rule.
- **Ignores tests.** Ask for tests-first or tests-alongside, never tests-after-the-fact.

## Follow-up prompts (after the first plan is approved)

These are templates for subsequent sessions. Adjust as needed.

### Implementing the first module

```
Plan approved. Let's start with src/core/types.ts.

Create the file with these exports:
- Point: { x: number; y: number }
- Material: as defined in 01-architecture.md (id, name, color, textureKey?, density, friction, restitution, destructible, destructionResistance)
- Chunk: as defined in 01-architecture.md (cx, cy, bitmap, dirty, visualDirty, contours, bodyIds)
- Contour: { points: Point[]; isHole: boolean }
- HitResult: { hit: boolean; x: number; y: number; material: number; distance: number } | null
- BodyId (opaque type for Box2D body identifiers)

All exports use TSDoc comments. Strict types, no `any`.

After you create the file, run `npm run typecheck` and report results.
```

### Implementing with tests-first

```
Now Materials.

Step 1: Write tests/core/Materials.test.ts.

Cover at minimum:
- Registering and retrieving materials by id.
- Throwing on duplicate id registration.
- get() returns undefined for unknown id.
- getOrThrow() throws clearly for unknown id.
- Air (id 0) is implicit / cannot be registered.

Run the tests; they should fail (no implementation yet).

Step 2 will follow after I review the test file.
```

```
Tests look good.

Step 2: Implement src/core/Materials.ts to make the tests pass.

Run `npm test` after implementation. Report which tests pass/fail.
```

### Reviewing before commit

```
Before we commit, summarize:
1. What changed in this session.
2. The output of `npm run typecheck`.
3. The output of `npm test`.
4. Any deviations from 01-architecture.md or 02-roadmap.md.
5. A proposed Conventional Commit message.

I'll review and then we commit.
```

### Recovering from a long session

When a Claude Code session has accumulated a lot of context and is starting to drift:

```
Let's checkpoint.

1. Summarize what's been completed since the start of this session.
2. List any TODO comments or unfinished work in the code.
3. List any architectural decisions made that aren't yet reflected in docs-dev/.
4. Confirm `npm run typecheck && npm test && npm run lint` all pass.

Then we'll commit and start fresh.
```

### When something is broken and you don't know why

```
Something is broken. Before suggesting fixes, please:
1. Run `npm test` and paste the failing output.
2. Run `npm run typecheck` and paste any errors.
3. Read the file(s) the failing test exercises.
4. Form a hypothesis. Don't fix yet.

Tell me your hypothesis. We'll discuss before changing code.
```

## Pacing guidance for Phase 1

A realistic first week:

- **Day 1-2:** types.ts, Materials.ts, ChunkedBitmap.ts (read/write, no operations).
- **Day 3-4:** Carve.ts (circle, polygon), Deposit.ts.
- **Day 5:** integration smoke test of the week's work.

If you find yourself ahead of this pace, that's fine — but don't push into Week 2 work without verifying coverage and hand-running the smoke tests on the Week 1 surface.

If you find yourself behind, that's also fine — Phase 1 has a 3-week budget for a reason. The marching squares + Douglas-Peucker work in Week 2 is the harder lift; underestimating it is the main risk.

## When to start a new Claude Code session

Start fresh when:

- The current session has been running 2+ hours.
- You've completed a logical unit of work and committed.
- The conversation is becoming repetitive or Claude is making small mistakes it didn't make earlier.
- You're switching to a different layer (core → physics, etc.).

Each new session: paste a context prompt referencing the relevant docs and the specific task. Don't expect Claude to remember previous sessions; treat each as a clean slate.

## A note on AI assistance for this project

The architecture documents in `docs-dev/` are the spine of this project. Claude Code is not a substitute for them; it's an executor that follows them. If you find yourself wanting Claude to "figure out the architecture as it goes," stop and update `docs-dev/01-architecture.md` first, then ask Claude to implement against the updated spec.

This discipline matters more for a foundational library like pixel-perfect than for an application. A library's architecture leaks into every consumer's code. Get it right on paper before getting it right in TypeScript.

## Done

You're now ready to start Phase 1. Open Claude Code, paste the prompt at the top of this document, and begin.

Good luck.
