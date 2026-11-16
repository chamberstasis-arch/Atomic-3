// combat/spawns/index.js
// Orquestador del sistema de spawns.
// - Loop de spawn con presupuesto global distribuido entre zonas activas.
// - Despawn agresivo: sin jugadores → sin mobs. Jugador se va → mobs desaparecen.
// - Areas reutilizables referenciadas por ID desde las zonas.

import { system, world } from "@minecraft/server";
import { randomPositionInArea, findValidYFromCandidate, normalizeArea } from "./validator.js";
import {
	countZoneMobs,
	countGlobalMobs,
	cleanupPopulation,
	removeAllSpawnedMobs,
	computeEffectiveBudget,
	computeZoneBudget,
	zoneTag,
} from "./population.js";
import {
	selectTemplate,
	spawnMobFromTemplate,
	buildTakeoverIndex,
	takeoverExistingEntities,
	setSpawnerDebug,
} from "./spawner.js";

let didInit = false;
let combatLevelObjectiveCache = null;

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function num(v, fallback) {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Distancia al cuadrado entre dos puntos.
 */
function distSq(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz;
}

/**
 * Centro de un bounding box.
 */
function areaCenter(area) {
	return {
		x: (area.min.x + area.max.x) / 2,
		y: (area.min.y + area.max.y) / 2,
		z: (area.min.z + area.max.z) / 2,
	};
}

/**
 * Resuelve el área de una zona: primero busca por areaId en el catálogo,
 * luego fallback a zone.area inline.
 */
function resolveArea(zone, areasCatalog) {
	let area = null;
	if (zone.areaId && areasCatalog && areasCatalog[zone.areaId]) {
		area = areasCatalog[zone.areaId];
	} else {
		area = zone.area ?? null;
	}
	return area ? normalizeArea(area) : null;
}

/**
 * Obtiene el nivel de combate de un jugador (scoreboard SkillLvlCombate).
 */
function getPlayerCombatLevel(player) {
	try {
		const obj = combatLevelObjectiveCache?.isValid
			? combatLevelObjectiveCache
			: world.scoreboard.getObjective("SkillLvlCombate");
		if (!obj) return 0;
		combatLevelObjectiveCache = obj;
		return obj.getScore(player) ?? 0;
	} catch (e) {
		void e;
		return 0;
	}
}

// ──────────────────────────────────────────────────────────
// Evaluación de condiciones
// ──────────────────────────────────────────────────────────

/**
 * Determina qué jugadores están "activando" una zona.
 * Retorna la lista de jugadores dentro del activationRadius del centro del área.
 * Si no hay ninguno → la zona se desactiva y sus mobs deben despawnearse.
 */
function getPlayersActivatingZone(zone, area, players, defaultActivationRadius) {
	const cond = zone.conditions ?? {};
	if (cond.requirePlayersNearby === false) return players; // Sin restricción

	const radius = num(cond.activationRadius, defaultActivationRadius);
	const rSq = radius * radius;
	const center = areaCenter(area);

	const activating = [];
	for (const p of players) {
		try {
			if (!p?.isValid) continue;
			const loc = p.location;
			if (!loc) continue;
			if (distSq(loc, center) <= rSq) activating.push(p);
		} catch (e) {
			void e;
		}
	}
	return activating;
}

/**
 * Evalúa condiciones secundarias de una zona (hora, nivel).
 * Se asume que ya hay jugadores activando la zona.
 */
function evaluateSecondaryConditions(zone, dimension, activatingPlayers) {
	const cond = zone.conditions ?? {};

	// Hora del día
	if (cond.timeOfDay && cond.timeOfDay !== "any") {
		try {
			const time = world.getTimeOfDay?.() ?? 0;
			const normalized = (time % 24000) / 24000;
			if (cond.timeOfDay === "night" && normalized < 0.5) return false;
			if (cond.timeOfDay === "day" && normalized >= 0.5) return false;
		} catch (e) {
			void e;
		}
	}

	// Nivel mínimo de combate
	if (typeof cond.minPlayerCombatLevel === "number" && cond.minPlayerCombatLevel > 0) {
		let anyQualifies = false;
		for (const p of activatingPlayers) {
			if (getPlayerCombatLevel(p) >= cond.minPlayerCombatLevel) {
				anyQualifies = true;
				break;
			}
		}
		if (!anyQualifies) return false;
	}

	return true;
}

// ──────────────────────────────────────────────────────────
// Spawn de una zona
// ──────────────────────────────────────────────────────────

/**
 * Intenta spawnear mobs en una zona.
 * @returns {number} cantidad de mobs spawneados
 */
function tickZone(dimension, zone, area, templates, activatingPlayers, current, zoneBudget, spawnCfg, debugEnabled, defaultScores, defaultEffectDuration) {
	const maxPop = num(zone.maxPopulation, 5);
	const room = Math.min(maxPop - current, zoneBudget);
	if (room <= 0) return 0;

	const batchSize = Math.min(num(zone.spawnBatchSize, 1), room);
	const maxAttempts = num(zone.maxAttemptsPerZone, num(spawnCfg.maxAttemptsPerZone, 6));
	const minDist = num(spawnCfg.minPlayerDistance, 16);
	const minDistSq = minDist * minDist;

	let spawned = 0;
	for (let attempt = 0; attempt < maxAttempts && spawned < batchSize; attempt++) {
		const templateId = selectTemplate(zone, templates);
		if (!templateId) break;
		const template = templates[templateId];
		if (!template) continue;

		const candidate = randomPositionInArea(area);
		const validPos = findValidYFromCandidate(dimension, candidate, area);
		if (!validPos) continue;

		// Verificar distancia mínima a jugadores (evitar pop-in)
		let tooClose = false;
		for (const p of activatingPlayers) {
			try {
				if (!p?.isValid) continue;
				const pLoc = p.location;
				if (!pLoc) continue;
				if (distSq(validPos, pLoc) < minDistSq) { tooClose = true; break; }
			} catch (e) {
				void e;
			}
		}
		if (tooClose) continue;

		const entity = spawnMobFromTemplate(dimension, templateId, template, validPos, zone.id, defaultScores, defaultEffectDuration);
		if (entity) {
			spawned++;
			if (debugEnabled) {
				try {
					world.sendMessage(`§8[Spawns] §aSpawned §f${templateId} §7at §e${Math.floor(validPos.x)},${Math.floor(validPos.y)},${Math.floor(validPos.z)} §7zone=§b${zone.id} §8(${current + spawned}/${maxPop})`);
				} catch (e) {
					void e;
				}
			}
		}
	}
	return spawned;
}

// ──────────────────────────────────────────────────────────
// Despawn de zonas inactivas
// ──────────────────────────────────────────────────────────

/**
 * Remueve todos los mobs de zonas que no tienen jugadores activándolas.
 */
function despawnInactiveZones(dimension, zones, areasCatalog, players, defaultActivationRadius, debugEnabled) {
	let removed = 0;
	for (const zone of zones) {
		if (zone.enabled === false) continue;
		const area = resolveArea(zone, areasCatalog);
		if (!area) continue;

		const activating = getPlayersActivatingZone(zone, area, players, defaultActivationRadius);
		if (activating.length > 0) continue; // Zona activa, no tocar

		// Sin jugadores → remover todos los mobs de esta zona
		try {
			const tag = zoneTag(zone.id);
			const mobs = dimension.getEntities({ tags: [tag] });
			for (const mob of mobs) {
				try {
					if (mob?.isValid) {
						if (typeof mob.hasTag === "function" && mob.hasTag("atomic_persistent")) continue;
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

	if (debugEnabled && removed > 0) {
		try {
			world.sendMessage(`§8[Spawns] §cInactive zone cleanup: §7removed §e${removed} §7mobs`);
		} catch (e) {
			void e;
		}
	}
	return removed;
}

// ──────────────────────────────────────────────────────────
// Inicialización
// ──────────────────────────────────────────────────────────

/**
 * Inicializa el sistema de spawns de combate.
 * @param {object} config - combatSkillConfig completo
 */
export function initCombatSpawns(config) {
	if (didInit) return;
	didInit = true;

	const spawnCfg = config?.spawns;
	if (!spawnCfg || spawnCfg.enabled === false) return;

	const zones = Array.isArray(spawnCfg.zones) ? spawnCfg.zones : [];
	if (zones.length === 0) return;

	const templates = config?.mobs?.templates ?? {};
	const areasCatalog = spawnCfg.areas ?? {};
	const dimensionId = spawnCfg.dimensionId ?? "minecraft:overworld";

	// Intervalos
	const spawnTickInterval = num(spawnCfg.spawnTickInterval, 60);
	const cleanupTickInterval = num(spawnCfg.cleanupTickInterval, 100);
	const fullDespawnTickInterval = num(spawnCfg.fullDespawnTickInterval, 200);

	// Caps
	const globalMaxMobs = num(spawnCfg.globalMaxMobs, 40);
	const budgetPerPlayer = num(spawnCfg.budgetPerPlayer, 12);
	const maxSpawnsPerTick = num(spawnCfg.maxSpawnsPerTick, 4);

	// Distancias
	const defaultActivationRadius = num(spawnCfg.activationRadius, 64);
	const despawnDistance = num(spawnCfg.despawnDistance, 96);
	const instantDespawnDistance = num(spawnCfg.instantDespawnDistance, 160);

	const debugEnabled = config?.debug?.enabled === true;

	// Activar debug en spawner.js
	setSpawnerDebug(debugEnabled);

	// Scores y efectos por defecto
	const defaultScores = spawnCfg.defaultScores ?? { H: 1 };
	const defaultEffectDuration = num(spawnCfg.defaultEffectDuration, 20000000);

	// ── Takeover de entidades existentes ──
	const takeoverCfg = spawnCfg.takeover ?? {};
	if (takeoverCfg.enabled !== false) {
		const takeoverIndex = buildTakeoverIndex(templates);
		if (takeoverIndex.size > 0) {
			const takeoverInterval = num(takeoverCfg.tickInterval, 100);
			const processedTag = takeoverCfg.processedTag ?? "atomic_takeover_done";
			system.runInterval(() => {
				try {
					const dimension = world.getDimension(dimensionId);
					if (!dimension) return;
					takeoverExistingEntities(dimension, takeoverIndex, processedTag, defaultScores, defaultEffectDuration, debugEnabled);
				} catch (e) {
					void e;
				}
			}, takeoverInterval);
		}
	}

	// ── Loop principal de spawn ──
	system.runInterval(() => {
		try {
			const dimension = world.getDimension(dimensionId);
			if (!dimension) return;

			let players;
			try { players = Array.from(world.getPlayers()); } catch (e) { void e; return; }

			// SIN JUGADORES → no spawnear nada
			if (players.length === 0) return;

			// Presupuesto global basado en jugadores
			const globalCurrent = countGlobalMobs(dimension);
			const effectiveBudget = computeEffectiveBudget(globalMaxMobs, budgetPerPlayer, players.length);
			const globalRemaining = Math.max(0, effectiveBudget - globalCurrent);
			if (globalRemaining <= 0) return;

			// Fase 1: determinar zonas activas (con jugadores cerca + condiciones OK)
			const activeZones = [];
			for (const zone of zones) {
				if (zone.enabled === false) continue;
				const area = resolveArea(zone, areasCatalog);
				if (!area || !area.min || !area.max) continue;

				const activating = getPlayersActivatingZone(zone, area, players, defaultActivationRadius);
				if (activating.length === 0) continue; // SIN jugadores = zona inactiva

				if (!evaluateSecondaryConditions(zone, dimension, activating)) continue;

				activeZones.push({ zone, area, activatingPlayers: activating });
			}
			if (activeZones.length === 0) return;

			// Fase 2: distribuir budget y spawnear
			let tickSpawnTotal = 0;
			let budgetLeft = globalRemaining;

			for (const entry of activeZones) {
				if (tickSpawnTotal >= maxSpawnsPerTick || budgetLeft <= 0) break;

				const zoneCurrent = countZoneMobs(dimension, entry.zone.id);
				const zoneBudget = computeZoneBudget(
					num(entry.zone.maxPopulation, 5),
					zoneCurrent,
					budgetLeft,
					activeZones.length
				);
				const effectiveZoneBudget = Math.min(zoneBudget, maxSpawnsPerTick - tickSpawnTotal);
				if (effectiveZoneBudget <= 0) continue;

				const spawned = tickZone(
					dimension, entry.zone, entry.area, templates,
					entry.activatingPlayers, zoneCurrent, effectiveZoneBudget, spawnCfg, debugEnabled,
					defaultScores, defaultEffectDuration
				);
				tickSpawnTotal += spawned;
				budgetLeft -= spawned;
			}

			if (debugEnabled && tickSpawnTotal > 0) {
				try {
					world.sendMessage(`§8[Spawns] §7Tick total: §a+${tickSpawnTotal} §8(budget left: ${budgetLeft}, global: ${globalCurrent + tickSpawnTotal}/${effectiveBudget})`);
				} catch (e) {
					void e;
				}
			}
		} catch (e) {
			void e;
		}
	}, spawnTickInterval);

	// ── Loop de cleanup por distancia ──
	system.runInterval(() => {
		try {
			const dimension = world.getDimension(dimensionId);
			if (!dimension) return;
			const result = cleanupPopulation(dimension, zones, despawnDistance, instantDespawnDistance);
			if (debugEnabled && result.removed > 0) {
				try {
					world.sendMessage(`§8[Spawns] §cDistance cleanup: §7removed §e${result.removed} §7mobs`);
				} catch (e) {
					void e;
				}
			}
		} catch (e) {
			void e;
		}
	}, cleanupTickInterval);

	// ── Loop de despawn completo de zonas inactivas ──
	system.runInterval(() => {
		try {
			const dimension = world.getDimension(dimensionId);
			if (!dimension) return;

			let players;
			try { players = Array.from(world.getPlayers()); } catch (e) { void e; return; }

			// Sin jugadores → limpiar TODO
			if (players.length === 0) {
				const result = removeAllSpawnedMobs(dimension, zones);
				if (debugEnabled && result.removed > 0) {
					try {
						world.sendMessage(`§8[Spawns] §4No players online: §7removed ALL §e${result.removed} §7mobs`);
					} catch (e) {
						void e;
					}
				}
				return;
			}

			// Despawnear zonas sin jugadores cerca
			despawnInactiveZones(dimension, zones, areasCatalog, players, defaultActivationRadius, debugEnabled);
		} catch (e) {
			void e;
		}
	}, fullDespawnTickInterval);

	// ── Script event: debug ──
	try {
		system.afterEvents.scriptEventReceive.subscribe((ev) => {
			try {
				if (ev.id !== "atomic:spawns_debug") return;
				const dimension = world.getDimension(dimensionId);
				if (!dimension) return;

				let players;
				try { players = Array.from(world.getPlayers()); } catch (e) { void e; players = []; }

				const globalCount = countGlobalMobs(dimension);
				const budget = computeEffectiveBudget(globalMaxMobs, budgetPerPlayer, players.length);
				const lines = [
					`§8[Spawns Debug]`,
					`  §7Players: §f${players.length} §8| Budget: §e${globalCount}/${budget} §8(global cap: ${globalMaxMobs}, per-player: ${budgetPerPlayer})`,
					`  §7Zones: §f${zones.length}`,
				];

				for (const zone of zones) {
					const area = resolveArea(zone, areasCatalog);
					const count = countZoneMobs(dimension, zone.id);
					const maxP = num(zone.maxPopulation, 5);
					const activating = area ? getPlayersActivatingZone(zone, area, players, defaultActivationRadius) : [];
					const status = zone.enabled === false ? "§8DISABLED" : activating.length > 0 ? "§aACTIVE" : "§cINACTIVE";
					lines.push(`  §f${zone.id}: §e${count}/${maxP} ${status} §8(players: ${activating.length}, area: ${zone.areaId ?? "inline"})`);
				}
				world.sendMessage(lines.join("\n"));
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}
}
