import { world } from "@minecraft/server";

export function asStr(value) {
	return String(value != null ? value : "").trim();
}

export function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

export function clampInt32(value) {
	const n = toInt(value, 0);
	if (n > 2147483647) return 2147483647;
	if (n < -2147483648) return -2147483648;
	return n;
}

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function getObjectiveCached(objectiveId) {
	const id = asStr(objectiveId);
	if (!id) return null;
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

export function getScoreBestEffort(player, objectiveId) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return null;
		const identity = player?.scoreboardIdentity ?? null;
		if (!identity) return null;
		const value = obj.getScore(identity);
		if (value == null) return null;
		return toInt(value, 0);
	} catch (e) {
		void e;
		return null;
	}
}

export function setScoreBestEffort(player, objectiveId, value) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return false;
		const identity = player?.scoreboardIdentity ?? null;
		if (!identity) return false;
		obj.setScore(identity, clampInt32(value));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}