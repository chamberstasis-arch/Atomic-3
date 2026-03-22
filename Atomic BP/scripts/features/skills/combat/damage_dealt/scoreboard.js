import { world } from "@minecraft/server";

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

function clampInt32(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(INT32_MIN, Math.min(INT32_MAX, Math.trunc(n)));
}

/** @type {Map<string, any>} */
const objectiveCache = new Map();

export const OBJ_H = "H";
export const OBJ_VIDA = "Vida";
export const OBJ_VIDA_MAX = "VidaMaxTotalH";

export const OBJ_DANO_SC = "DanoFinalSC";
export const OBJ_DANO_CC = "DanoFinalCC";
export const OBJ_PROB_CRIT = "ProbabilidadCriticaTotal";
export const OBJ_PROB_CRIT_TOTAL = "ProbCritTotalH";

export const OBJ_DEF_TOTAL = "DtotalH";
export const OBJ_DEF_TOTAL_TOTAL = "DefensaTotalH";
export const OBJ_PEN_ARMOR_TOTAL = "PenArmorTotalH";
export const OBJ_DMGH = "DMGH";

export const OBJ_LAST_KILLER_ID = "LastKillerId";
export const OBJ_LAST_KILL_TICK = "LastKillTick";

function getParticipant(entity) {
	try {
		return entity?.scoreboardIdentity ?? null;
	} catch (e) {
		void e;
		return null;
	}
}

function getObjectiveCached(objectiveId) {
	// IMPORTANTE: durante worldLoad los objectives pueden no existir aún.
	// No cacheamos null permanentemente; si está null, reintentamos.
	if (objectiveCache.has(objectiveId)) {
		const cached = objectiveCache.get(objectiveId) ?? null;
		if (cached) return cached;
	}
	try {
		const obj = world.scoreboard.getObjective(objectiveId) ?? null;
		if (obj) objectiveCache.set(objectiveId, obj);
		return obj;
	} catch (e) {
		void e;
		return null;
	}
}

export function ensureObjectiveBestEffort(objectiveId, displayName = undefined) {
	try {
		const existing = world.scoreboard.getObjective(objectiveId);
		if (existing) {
			objectiveCache.set(objectiveId, existing);
			return existing;
		}
	} catch (e) {
		void e;
	}
	// Creación migrada a scripts/scoreboards (init central)
	void displayName;
	return null;
}

export function killEntityBestEffort(entity) {
	try {
		if (!entity || !entity.isValid) return false;
		if (typeof entity.kill === "function") {
			entity.kill();
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		entity?.runCommandAsync?.("kill @s");
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function getScore(entity, objectiveId, defaultValue = 0) {
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

export function setScore(entity, objectiveId, value) {
	try {
		const obj = getObjectiveCached(objectiveId) ?? ensureObjectiveBestEffort(objectiveId);
		if (!obj) return false;
		const p = getParticipant(entity);
		if (!p) return false;
		obj.setScore(p, clampInt32(value));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function addScore(entity, objectiveId, delta) {
	const cur = getScore(entity, objectiveId, 0);
	return setScore(entity, objectiveId, cur + Math.trunc(Number(delta)));
}

export function removeScore(entity, objectiveId, delta) {
	const d = Math.trunc(Number(delta));
	if (!Number.isFinite(d) || d <= 0) return true;
	return addScore(entity, objectiveId, -d);
}

// Remueve score pero clamp a 0; retorna cuanto se removio realmente.
export function removeScoreMin0(entity, objectiveId, delta) {
	const d = Math.trunc(Number(delta));
	if (!Number.isFinite(d) || d <= 0) return 0;
	const cur = getScore(entity, objectiveId, 0);
	const applied = Math.max(0, Math.min(cur, d));
	setScore(entity, objectiveId, cur - applied);
	return applied;
}

export function hasHEnabled(entity) {
	return getScore(entity, OBJ_H, 0) === 1;
}

export function isPlayerEntity(entity) {
	try {
		return entity?.typeId === "minecraft:player";
	} catch (e) {
		void e;
		return false;
	}
}

export function debugTellBestEffort(entity, message) {
	const text = String(message);
	try {
		if (typeof entity?.sendMessage === "function") {
			entity.sendMessage(text);
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		entity?.runCommandAsync?.(`tellraw @s {"rawtext":[{"text":${JSON.stringify(text)}}]}`);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function ensureTargetVidaInitializedBestEffort(target, config = undefined) {
	// Intenta evitar el caso donde H==1 pero Vida/VidaMax todavía no fueron inicializados por health.
	// Esto permite que el hit aplique dano en el mismo tick.
	try {
		const curVida = getScore(target, OBJ_VIDA, undefined);
		if (curVida !== undefined) return true;

		let vidaMax = getScore(target, OBJ_VIDA_MAX, undefined);
		if (vidaMax === undefined) {
			if (isPlayerEntity(target)) {
				vidaMax = Math.max(0, Math.trunc(Number(config?.defaultPlayerVidaMaxTotal ?? 100)));
				setScore(target, OBJ_VIDA_MAX, vidaMax);
			} else {
				// Basado en `combat/health` default para mobs: vida vanilla actual * 5
				const hc = target?.getComponent?.("minecraft:health");
				const cur = Number(hc?.currentValue);
				if (Number.isFinite(cur) && cur > 0) {
					vidaMax = Math.max(0, Math.trunc(cur * 5));
					setScore(target, OBJ_VIDA_MAX, vidaMax);
				}
			}
		}

		const initVida = vidaMax !== undefined && vidaMax > 0 ? vidaMax : 0;
		setScore(target, OBJ_VIDA, initVida);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}
