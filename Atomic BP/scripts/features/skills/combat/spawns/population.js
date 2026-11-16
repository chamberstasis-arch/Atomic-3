// combat/spawns/population.js
// Control de población de mobs spawneados: conteo por zona, conteo global,
// despawn por distancia, despawn completo sin jugadores, enforcement de caps.

import { world } from "@minecraft/server";

const TAG_PREFIX = "atomic_spawned_";
const TAG_GLOBAL = "atomic_spawned";

/**
 * @param {string} zoneId
 * @returns {string}
 */
export function zoneTag(zoneId) {
	return `${TAG_PREFIX}${zoneId}`;
}

/**
 * Cuenta los mobs vivos asociados a una zona.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {string} zoneId
 * @returns {number}
 */
export function countZoneMobs(dimension, zoneId) {
	try {
		const tag = zoneTag(zoneId);
		const entities = dimension.getEntities({ tags: [tag] });
		let count = 0;
		for (const _ of entities) count++;
		return count;
	} catch (e) {
		void e;
		return 0;
	}
}

/**
 * Cuenta el total global de mobs custom spawneados.
 * @param {import("@minecraft/server").Dimension} dimension
 * @returns {number}
 */
export function countGlobalMobs(dimension) {
	try {
		const entities = dimension.getEntities({ tags: [TAG_GLOBAL] });
		let count = 0;
		for (const _ of entities) count++;
		return count;
	} catch (e) {
		void e;
		return 0;
	}
}

/**
 * Calcula el presupuesto efectivo de mobs según jugadores online.
 * budget = min(globalMaxMobs, players.length * budgetPerPlayer)
 *
 * @param {number} globalMaxMobs
 * @param {number} budgetPerPlayer
 * @param {number} playerCount
 * @returns {number}
 */
export function computeEffectiveBudget(globalMaxMobs, budgetPerPlayer, playerCount) {
	if (playerCount <= 0) return 0;
	const playerBased = playerCount * budgetPerPlayer;
	return Math.min(globalMaxMobs, playerBased);
}

/**
 * Calcula cuánto puede spawnear una zona, considerando:
 * - Su propio maxPopulation
 * - El budget global restante
 * - Distribución proporcional entre zonas activas
 *
 * @param {number} zoneMaxPop  - maxPopulation de la zona
 * @param {number} zoneCurrent - mobs actuales de la zona
 * @param {number} globalBudgetRemaining - presupuesto global restante
 * @param {number} activeZoneCount - cantidad de zonas activas en este tick
 * @returns {number} cuántos mobs PUEDE spawnear esta zona
 */
export function computeZoneBudget(zoneMaxPop, zoneCurrent, globalBudgetRemaining, activeZoneCount) {
	if (globalBudgetRemaining <= 0) return 0;
	const zoneRoom = Math.max(0, zoneMaxPop - zoneCurrent);
	if (zoneRoom <= 0) return 0;
	// Distribuir proporcionalmente entre zonas activas
	const fairShare = activeZoneCount > 0 ? Math.max(1, Math.floor(globalBudgetRemaining / activeZoneCount)) : globalBudgetRemaining;
	return Math.min(zoneRoom, fairShare);
}

/**
 * Distancia al cuadrado entre dos posiciones.
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 * @returns {number}
 */
function distSq(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz;
}

/**
 * Distancia mínima al cuadrado de un mob a cualquier jugador.
 * @param {import("@minecraft/server").Entity} entity
 * @param {import("@minecraft/server").Player[]} players
 * @returns {number} Infinity si no hay jugadores válidos
 */
function minPlayerDistSq(entity, players) {
	let minSq = Infinity;
	try {
		const pos = entity.location;
		if (!pos) return Infinity;
		for (const p of players) {
			try {
				if (!p?.isValid) continue;
				const pLoc = p.location;
				if (!pLoc) continue;
				const sq = distSq(pos, pLoc);
				if (sq < minSq) minSq = sq;
			} catch (e) {
				void e;
			}
		}
	} catch (e) {
		void e;
	}
	return minSq;
}

/**
 * Determina si un mob spawneado debe ser despawneado.
 * @param {import("@minecraft/server").Entity} entity
 * @param {import("@minecraft/server").Player[]} players
 * @param {number} despawnDistance
 * @param {number} instantDespawnDistance
 * @returns {"keep" | "despawn" | "instant"}
 */
export function shouldDespawn(entity, players, despawnDistance, instantDespawnDistance) {
	try {
		if (!entity?.isValid) return "instant";
		if (typeof entity.hasTag === "function" && entity.hasTag("atomic_persistent")) return "keep";

		if (players.length === 0) return "instant";

		const sq = minPlayerDistSq(entity, players);
		if (sq === Infinity) return "instant";

		const instantSq = instantDespawnDistance * instantDespawnDistance;
		if (sq > instantSq) return "instant";

		const despSq = despawnDistance * despawnDistance;
		if (sq > despSq) return "despawn";

		return "keep";
	} catch (e) {
		void e;
		return "instant";
	}
}

/**
 * Limpieza de población: despawnea mobs lejanos o inválidos de todas las zonas.
 * También elimina mobs si no hay jugadores en absoluto.
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{ id: string }[]} zones
 * @param {number} despawnDistance
 * @param {number} instantDespawnDistance
 * @returns {{ removed: number }}
 */
export function cleanupPopulation(dimension, zones, despawnDistance, instantDespawnDistance) {
	let removed = 0;
	let players;
	try {
		players = Array.from(world.getPlayers());
	} catch (e) {
		void e;
		players = [];
	}

	// Sin jugadores → remover TODO
	if (players.length === 0) {
		return removeAllSpawnedMobs(dimension, zones);
	}

	for (const zone of zones) {
		try {
			const tag = zoneTag(zone.id);
			const mobs = dimension.getEntities({ tags: [tag] });
			for (const mob of mobs) {
				try {
					if (!mob?.isValid) continue;
					const verdict = shouldDespawn(mob, players, despawnDistance, instantDespawnDistance);
					if (verdict !== "keep") {
						mob.remove();
						removed++;
					}
				} catch (e) {
					void e;
				}
			}
		} catch (e) {
			void e;
		}
	}
	return { removed };
}

/**
 * Despawn completo: remueve TODOS los mobs spawneados de zonas sin jugadores cerca.
 * Usado cuando un jugador se desconecta o se aleja de todas las zonas.
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{ id: string }[]} zones
 * @returns {{ removed: number }}
 */
export function removeAllSpawnedMobs(dimension, zones) {
	let removed = 0;
	for (const zone of zones) {
		try {
			const tag = zoneTag(zone.id);
			const mobs = dimension.getEntities({ tags: [tag] });
			for (const mob of mobs) {
				try {
					if (mob?.isValid) {
						mob.remove();
						removed++;
					}
				} catch (e) {
					void e;
				}
			}
		} catch (e) {
			void e;
		}
	}
	return { removed };
}
