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
     * @throws If `material.id` is not an integer in `1..255`, or if a
     *         material with the same id is already registered.
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
