// combat/spawns/validator.js
// Validación de posiciones de spawn: bloque sólido, espacio aéreo, dentro de área.
// Funciones puras sin side-effects.

const NON_SOLID_BLOCKS = new Set([
	"minecraft:air",
	"minecraft:cave_air",
	"minecraft:void_air",
	"minecraft:water",
	"minecraft:flowing_water",
	"minecraft:lava",
	"minecraft:flowing_lava",
	"minecraft:tallgrass",
	"minecraft:tall_grass",
	"minecraft:short_grass",
	"minecraft:deadbush",
	"minecraft:dead_bush",
	"minecraft:red_flower",
	"minecraft:yellow_flower",
	"minecraft:poppy",
	"minecraft:dandelion",
	"minecraft:brown_mushroom",
	"minecraft:red_mushroom",
	"minecraft:snow_layer",
	"minecraft:vine",
	"minecraft:web",
	"minecraft:cobweb",
	"minecraft:torch",
	"minecraft:soul_torch",
	"minecraft:fire",
	"minecraft:soul_fire",
	"minecraft:redstone_wire",
	"minecraft:rail",
	"minecraft:powered_rail",
	"minecraft:activator_rail",
	"minecraft:detector_rail",
]);

const LIQUID_BLOCKS = new Set([
	"minecraft:water",
	"minecraft:flowing_water",
	"minecraft:lava",
	"minecraft:flowing_lava",
]);

/**
 * @param {import("@minecraft/server").Block | null | undefined} block
 * @returns {boolean}
 */
export function isBlockSolid(block) {
	if (!block) return false;
	try {
		if (block.isSolid === true) return true;
		if (block.isSolid === false) return false;
	} catch (e) {
		void e;
	}
	const typeId = String(block.typeId ?? "").toLowerCase();
	return typeId.length > 0 && !NON_SOLID_BLOCKS.has(typeId);
}

/**
 * @param {import("@minecraft/server").Block | null | undefined} block
 * @returns {boolean}
 */
export function isBlockAir(block) {
	if (!block) return false;
	try {
		if (block.isAir === true) return true;
	} catch (e) {
		void e;
	}
	const typeId = String(block.typeId ?? "").toLowerCase();
	return typeId === "minecraft:air" || typeId === "minecraft:cave_air" || typeId === "minecraft:void_air";
}

/**
 * @param {import("@minecraft/server").Block | null | undefined} block
 * @returns {boolean}
 */
export function isBlockLiquid(block) {
	if (!block) return false;
	try {
		if (block.isLiquid === true) return true;
	} catch (e) {
		void e;
	}
	const typeId = String(block.typeId ?? "").toLowerCase();
	return LIQUID_BLOCKS.has(typeId);
}

/**
 * Normaliza un área para garantizar que min <= max en cada eje.
 * Esto permite definir áreas con esquinas en cualquier orden en la config.
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} area
 * @returns {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }}
 */
export function normalizeArea(area) {
	if (!area || !area.min || !area.max) return area;
	return {
		min: {
			x: Math.min(area.min.x, area.max.x),
			y: Math.min(area.min.y, area.max.y),
			z: Math.min(area.min.z, area.max.z),
		},
		max: {
			x: Math.max(area.min.x, area.max.x),
			y: Math.max(area.min.y, area.max.y),
			z: Math.max(area.min.z, area.max.z),
		},
	};
}

/**
 * Verifica si una posición está dentro de un bounding box de área.
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} area
 * @returns {boolean}
 */
export function isInsideArea(pos, area) {
	if (!pos || !area || !area.min || !area.max) return false;
	return (
		pos.x >= area.min.x && pos.x <= area.max.x &&
		pos.y >= area.min.y && pos.y <= area.max.y &&
		pos.z >= area.min.z && pos.z <= area.max.z
	);
}

/**
 * Valida que una posición sea apta para spawn de mob.
 * - Bloque sólido debajo (y-1)
 * - 4 bloques de aire desde la posición (y, y+1, y+2, y+3)
 * - No líquido debajo
 * - Dentro del área
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} area
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateSpawnPosition(dimension, pos, area) {
	if (!dimension || !pos) return { valid: false, reason: "no_dimension_or_pos" };
	if (!isInsideArea(pos, area)) return { valid: false, reason: "outside_area" };

	try {
		const below = dimension.getBlockFromRay(pos, { x: 0, y: 0, z: 0 }) ?? null;
		// Usar getBlock directamente
		const blockBelow = dimension.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) });
		if (!isBlockSolid(blockBelow)) return { valid: false, reason: "no_solid_below" };
		if (isBlockLiquid(blockBelow)) return { valid: false, reason: "liquid_below" };

		// 4 bloques de aire desde la posición de spawn
		const baseY = Math.floor(pos.y);
		const baseX = Math.floor(pos.x);
		const baseZ = Math.floor(pos.z);
		for (let dy = 0; dy < 4; dy++) {
			const block = dimension.getBlock({ x: baseX, y: baseY + dy, z: baseZ });
			if (!isBlockAir(block)) return { valid: false, reason: `not_air_at_y+${dy}` };
		}

		return { valid: true };
	} catch (e) {
		return { valid: false, reason: "exception" };
	}
}

/**
 * Genera una posición candidata aleatoria dentro de un área.
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} area
 * @returns {{ x: number, y: number, z: number }}
 */
export function randomPositionInArea(area) {
	const x = Math.floor(Math.random() * (area.max.x - area.min.x + 1)) + area.min.x;
	const z = Math.floor(Math.random() * (area.max.z - area.min.z + 1)) + area.min.z;
	const y = Math.floor(Math.random() * (area.max.y - area.min.y + 1)) + area.min.y;
	return { x: x + 0.5, y, z: z + 0.5 };
}

/**
 * Busca una Y válida para spawn partiendo de una posición candidata.
 * Escanea desde la Y dada hacia abajo buscando suelo sólido con aire encima.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{ x: number, y: number, z: number }} candidate
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} area
 * @param {number} [scanRange=16]
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function findValidYFromCandidate(dimension, candidate, area, scanRange = 16) {
	const baseX = Math.floor(candidate.x);
	const baseZ = Math.floor(candidate.z);
	const startY = Math.min(area.max.y, Math.floor(candidate.y));
	const endY = Math.max(area.min.y, startY - scanRange);

	for (let y = startY; y >= endY; y--) {
		try {
			const below = dimension.getBlock({ x: baseX, y: y - 1, z: baseZ });
			if (!isBlockSolid(below) || isBlockLiquid(below)) continue;

			let allAir = true;
			for (let dy = 0; dy < 4; dy++) {
				const block = dimension.getBlock({ x: baseX, y: y + dy, z: baseZ });
				if (!isBlockAir(block)) { allAir = false; break; }
			}
			if (!allAir) continue;

			const pos = { x: baseX + 0.5, y, z: baseZ + 0.5 };
			if (!isInsideArea(pos, area)) continue;
			return pos;
		} catch (e) {
			continue;
		}
	}
	return null;
}
