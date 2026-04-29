cat > README.md << 'EOF'
# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

**Status:** alpha — under active development. Expect API churn before v1.0.0.

## What this is

A library for Phaser v4 games that need pixel-accurate world manipulation:

- Destructible terrain with proper Box2D colliders that follow the bitmap.
- Alpha-aware sprite-vs-sprite and sprite-vs-terrain collision.
- Procedural terrain generation from PNG masks.
- Spatial queries (raycast, surface-find, material sampling) directly on the bitmap.

## Why

Phaser v4 + Phaser Box2D are now both production-ready, but no maintained library exists for pixel-perfect spatial reasoning on this stack. This fills the gap.

## Quickstart

(Coming after Phase 3 of the roadmap.)

## Roadmap

See [`docs-dev/02-roadmap.md`](docs-dev/02-roadmap.md).

## Architecture

See [`docs-dev/01-architecture.md`](docs-dev/01-architecture.md).

## Documentation

Live docs (after Phase 5): https://dzyamik.github.io/pixel-perfect

## License

MIT
EOF