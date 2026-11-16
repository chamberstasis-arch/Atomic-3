// Utilidades para storage basado en scoreboards (sin comandos)

import { world } from "@minecraft/server";

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

function clampInt32(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(INT32_MIN, Math.min(INT32_MAX, Math.trunc(n)));
}

export function ensureObjectiveFromConfig(entry, fallbackName, fallbackDisplay) {
	const e = entry || {};
	const name = String(e.scoreboard != null ? e.scoreboard : e.name != null ? e.name : fallbackName).trim() || fallbackName;
	const displayName = String(e.display != null ? e.display : fallbackDisplay != null ? fallbackDisplay : name);

	try {
		const existing = world.scoreboard.getObjective(name);
		if (existing) return existing;
	} catch (e) {
		void e;
		// ignore
	}
	// Creación migrada a scripts/scoreboards (init central)
	void displayName;
	return null;
}

// Helpers "get-only": no crean objectives. La creación vive en scripts/scoreboards/init.js.
export function getObjectiveNameFromConfig(entry, fallbackName) {
	const e = entry || {};
	return String(e.scoreboard != null ? e.scoreboard : e.name != null ? e.name : fallbackName).trim() || fallbackName;
}

export function getObjectiveFromConfig(entry, fallbackName) {
	const name = getObjectiveNameFromConfig(entry, fallbackName);
	try {
		const existing = world.scoreboard.getObjective(name);
		return existing || null;
	} catch (e) {
		void e;
		return null;
	}
}

export function getPlayerScore(objective, player) {
	if (!objective || !player) return 0;
	try {
		return Number(objective.getScore(player.scoreboardIdentity)) || 0;
	} catch (e) {
		void e;
		return 0;
	}
}

export function setPlayerScore(objective, player, score) {
	if (!objective || !player) return false;
	try {
		objective.setScore(player.scoreboardIdentity, clampInt32(score));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function addPlayerScore(objective, player, delta) {
	const current = getPlayerScore(objective, player);
	return setPlayerScore(objective, player, current + (Number(delta) || 0));
}

export { INT32_MAX };
