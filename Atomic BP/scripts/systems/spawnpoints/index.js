import { system, world } from "@minecraft/server";
import spawnpointsConfig from "./config.js";

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function getObjectiveCached(id) {
	if (objectiveCache.has(id)) return objectiveCache.get(id) ?? null;
	try {
		const obj = world.scoreboard.getObjective(id) ?? null;
		if (obj) objectiveCache.set(id, obj);
		return obj;
	} catch (e) {
		void e;
		return null;
	}
}

function getParticipant(entity) {
	try {
		return entity?.scoreboardIdentity ?? null;
	} catch (e) {
		void e;
		return null;
	}
}

function getScore(entity, objectiveId, defaultValue = 0) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return defaultValue;
		const p = getParticipant(entity);
		if (!p) return defaultValue;
		const v = obj.getScore(p);
		if (v === undefined || v === null) return defaultValue;
		const n = Math.trunc(Number(v));
		return Number.isFinite(n) ? n : defaultValue;
	} catch (e) {
		void e;
		return defaultValue;
	}
}

function setScore(entity, objectiveId, value) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return false;
		const p = getParticipant(entity);
		if (!p) return false;
		obj.setScore(p, Math.trunc(Number(value)));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function getPlayerKey(player) {
	try {
		const id = player?.id;
		if (id) return String(id);
	} catch (e) {
		void e;
	}
	try {
		return String(player?.name ?? "");
	} catch (e) {
		void e;
		return "";
	}
}

function resolveSpawnpointLocation(config, id) {
	const key = String(id ?? "");
	if (!key) return null;
	const entry = config?.spawnpoints?.[key];
	if (!entry) return null;
	const dimensionId = String(entry?.dimension ?? "");
	const x = Math.trunc(Number(entry?.x));
	const y = Math.trunc(Number(entry?.y));
	const z = Math.trunc(Number(entry?.z));
	if (!dimensionId) return null;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	try {
		const dimension = world.getDimension(dimensionId);
		if (!dimension) return null;
		return { dimension, x, y, z };
	} catch (e) {
		void e;
		return null;
	}
}

function setSpawnpointBestEffort(player, location) {
	try {
		if (location) {
			player?.setSpawnPoint?.(location);
		} else {
			player?.setSpawnPoint?.();
		}
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function debugLog(config, message) {
	if (!config?.debug) return;
	try {
		console.warn(`[spawnpoints] ${message}`);
	} catch (e) {
		void e;
	}
}

function applySpawnpointForPlayer(player, config, cache) {
	if (!player) return;

	const objectiveId = String(config?.objective ?? "spawnpoint");
	let score = getScore(player, objectiveId, undefined);
	if (!Number.isFinite(Number(score))) score = 0;

	let desiredId = null;
	if (score > 0) {
		desiredId = String(Math.trunc(Number(score)));
	} else if (config?.assignDefaultOnJoin) {
		const defId = String(config?.defaultSpawnpointId ?? "");
		if (defId && config?.spawnpoints?.[defId]) {
			const parsed = Math.trunc(Number(defId));
			if (Number.isFinite(parsed)) setScore(player, objectiveId, parsed);
			desiredId = defId;
		}
	}

	const key = getPlayerKey(player);
	if (!key) return;
	const lastAppliedId = cache.get(key);

	if (!desiredId) {
		if (lastAppliedId !== null) {
			setSpawnpointBestEffort(player, null);
			cache.set(key, null);
			debugLog(config, `${player.name ?? "?"} spawnpoint cleared`);
		}
		return;
	}

	const location = resolveSpawnpointLocation(config, desiredId);
	if (!location) {
		if (lastAppliedId !== null) {
			setSpawnpointBestEffort(player, null);
			cache.set(key, null);
			debugLog(config, `${player.name ?? "?"} spawnpoint invalid -> cleared (id=${desiredId})`);
		}
		return;
	}

	if (lastAppliedId === desiredId) return;

	setSpawnpointBestEffort(player, location);
	cache.set(key, desiredId);
	debugLog(config, `${player.name ?? "?"} spawnpoint applied id=${desiredId}`);
}

let didInit = false;

export function initSpawnpointsSystem(customConfig = undefined) {
	if (didInit) return;
	didInit = true;

	const config = customConfig != null ? customConfig : spawnpointsConfig;
	const cache = new Map();

	try {
		world.afterEvents.playerSpawn.subscribe((ev) => {
			try {
				const player = ev?.player;
				if (!player) return;
				applySpawnpointForPlayer(player, config, cache);
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}

	const every = Math.max(5, Math.trunc(Number(config?.applyEveryTicks ?? 40)));
	try {
		system.runInterval(() => {
			try {
				for (const player of world.getPlayers()) {
					applySpawnpointForPlayer(player, config, cache);
				}
			} catch (e) {
				void e;
			}
		}, every);
	} catch (e) {
		void e;
	}
}
