import { world } from "@minecraft/server";
import { clampInt32 } from "./utilMath.js";

function safeString(v) {
	return String(v != null ? v : "");
}

export function debugLog(config, msg) {
	if (!config || !config.debug || !config.debug.enabled || !config.debug.console) return;
	try {
		console.log(`[skills/combat/calc] ${safeString(msg)}`);
	} catch (e) {
		void e;
	}
}

export function quoteForCommand(value) {
	return `"${safeString(value).replace(/"/g, "\\\"")}"`;
}

/** @type {Map<string, any>} */
const objectiveCache = new Map();

export function getObjectiveBestEffort(objectiveId) {
	const id = safeString(objectiveId);
	if (objectiveCache.has(id)) {
		const cached = objectiveCache.get(id);
		if (cached) return cached;
	}
	try {
		if (!world || !world.scoreboard || typeof world.scoreboard.getObjective !== "function") return null;
		const obj = world.scoreboard.getObjective(id) || null;
		if (obj) objectiveCache.set(id, obj);
		return obj;
	} catch (e) {
		void e;
		return null;
	}
}

export function ensureObjectiveBestEffort(dimension, objectiveId, criteria = "dummy", displayName) {
	const id = safeString(objectiveId).trim();
	if (!id) return false;

	// 1) API nativa
	try {
		const existing = getObjectiveBestEffort(id);
		if (existing) return true;
	} catch (e) {
		void e;
	}

	// Creación migrada a scripts/scoreboards (init central)
	void dimension;
	void criteria;
	void displayName;
	return false;
}

export function getScoreIdentityBestEffort(objectiveId, identity, missingValue = 0) {
	try {
		const obj = getObjectiveBestEffort(objectiveId);
		if (!obj || !identity) return missingValue;
		const v = obj.getScore(identity);
		return typeof v === "number" && Number.isFinite(v) ? v : missingValue;
	} catch (e) {
		void e;
		return missingValue;
	}
}

// Lee score por identity (preferido) con fallback a participante por nombre.
// Importante para mundos donde se setean scores con comandos que crean "fake players" por string.
export function getScoreIdentityOrNameBestEffort(objectiveId, identity, playerName, missingValue = 0) {
	const obj = getObjectiveBestEffort(objectiveId);
	if (!obj) return missingValue;

	let identityValue = undefined;
	if (identity) {
		try {
			const v = obj.getScore(identity);
			if (typeof v === "number" && Number.isFinite(v)) identityValue = v;
		} catch (e) {
			void e;
		}
	}

	let nameValue = undefined;
	const name = safeString(playerName).trim();
	if (name) {
		try {
			const v = obj.getScore(name);
			if (typeof v === "number" && Number.isFinite(v)) nameValue = v;
		} catch (e) {
			void e;
		}
	}

	// Preferimos identity, pero si es 0 y el nombre tiene un valor != 0, usamos el del nombre.
	if (identityValue !== undefined) {
		if (identityValue !== 0) return identityValue;
		if (nameValue !== undefined && nameValue !== 0) return nameValue;
		return identityValue;
	}

	if (nameValue !== undefined) return nameValue;
	return missingValue;
}

export function setScoreIdentityBestEffort(dimension, objectiveId, identity, playerName, value) {
	const v = clampInt32(value);

	// 1) API
	try {
		const obj = getObjectiveBestEffort(objectiveId);
		if (obj && identity) {
			obj.setScore(identity, v);
			return true;
		}
	} catch (e) {
		void e;
	}

	// 2) Fallback comando
	try {
		if (!dimension || typeof dimension.runCommand !== "function") return false;
		if (!playerName) return false;
		const selector = `@a[name=${quoteForCommand(playerName)}]`;
		const cmd = `execute as ${selector} run scoreboard players set @s ${safeString(objectiveId)} ${Math.trunc(v)}`;
		dimension.runCommand(cmd);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}
