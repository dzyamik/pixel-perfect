import type { Material } from './types.js';

/**
 * Registry mapping material ids to {@link Material} descriptions.
 *
 * Air (id `0`) is implicit and is never registered. Registered ids must be
 * integers in the range `1..255` so they fit in the one-byte cells of a
 * `ChunkedBitmap`.
 */
export class MaterialRegistry {
    private readonly byId = new Map<number, Material>();

    /**
     * @param materials Optional initial materials. Each must have a unique id
     *                  in the valid range.
     * @throws If any material has an invalid id or duplicates another id.
     */
    constructor(materials: readonly Material[] = []) {
        for (const material of materials) {
            this.register(material);
        }
    }

    /**
     * Registers a material so it can be sampled, rendered, and used by carve
     * and deposit operations.
     *
     * Per-cell timer thresholds (`burnDuration` for fire materials,
     * `settleAfterTicks` for materials with a `settlesTo` promotion target)
     * must be integers in `1..256` because the underlying timer is a
     * `Uint8Array` that saturates at 255 — a threshold above 256 means the
     * counter `current + 1` (max `256`) never reaches the threshold, so the
     * cell silently never burns out / never promotes. The check at
     * registration prevents that footgun. See
     * `docs-dev/04-tuning-research.md`.
     *
     * @throws If `material.id` is not an integer in `1..255`, or if a
     *         material with the same id is already registered. Also throws
     *         if `burnDuration` (for `simulation: 'fire'`) or
     *         `settleAfterTicks` (when `settlesTo` is set) is outside
     *         `1..256`.
     */
    register(material: Material): void {
        const { id } = material;
        if (!Number.isInteger(id) || id < 1 || id > 255) {
            throw new RangeError(
                `Material id must be an integer in 1..255 (id 0 is reserved for air); got ${id}`,
            );
        }
        if (this.byId.has(id)) {
            throw new Error(`Duplicate material id ${id}: cannot re-register`);
        }
        if (material.simulation === 'fire') {
            const d = material.burnDuration;
            if (d === undefined) {
                throw new Error(
                    `Material '${material.name}' (id ${id}) has simulation 'fire' but no burnDuration; ` +
                        `set burnDuration in 1..256 (Uint8Array timer cap)`,
                );
            }
            if (!Number.isInteger(d) || d < 1 || d > 256) {
                throw new RangeError(
                    `Material '${material.name}' (id ${id}) burnDuration must be an integer in 1..256; got ${d}. ` +
                        `Values > 256 burn forever (timer saturates at 255 < threshold). See docs-dev/04-tuning-research.md.`,
                );
            }
        }
        if (material.settlesTo !== undefined) {
            const t = material.settleAfterTicks;
            if (t === undefined) {
                throw new Error(
                    `Material '${material.name}' (id ${id}) has settlesTo=${material.settlesTo} but no settleAfterTicks; ` +
                        `set settleAfterTicks in 1..256 to enable settling`,
                );
            }
            if (!Number.isInteger(t) || t < 1 || t > 256) {
                throw new RangeError(
                    `Material '${material.name}' (id ${id}) settleAfterTicks must be an integer in 1..256; got ${t}. ` +
                        `Values > 256 never promote (timer saturates at 255 < threshold). See docs-dev/04-tuning-research.md.`,
                );
            }
        }
        if (material.flowDistance !== undefined) {
            const f = material.flowDistance;
            if (!Number.isInteger(f) || f < 0 || f > 16) {
                throw new RangeError(
                    `Material '${material.name}' (id ${id}) flowDistance must be an integer in 0..16; got ${f}. ` +
                        `0 disables horizontal flow; values > 16 hit a per-tick budget that's not worth the visual difference.`,
                );
            }
        }
        this.byId.set(id, material);
    }

    /**
     * Looks up a material by id. Returns `undefined` for unknown ids and for
     * id `0` (air is implicit).
     */
    get(id: number): Material | undefined {
        return this.byId.get(id);
    }

    /**
     * Looks up a material by id, throwing if it is not registered.
     *
     * @throws If `id` is not registered. Air (id `0`) always throws because
     *         air has no material entry.
     */
    getOrThrow(id: number): Material {
        const material = this.byId.get(id);
        if (material === undefined) {
            throw new Error(`Material id ${id} is not registered`);
        }
        return material;
    }
}
