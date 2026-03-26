import { world } from "@minecraft/server";

// Feature: skills/combat/damageCancel
// Score helpers
//
// Objetivo:
// - Leer `H` por API de scoreboard sin comandos (más barato y estable).
// - Si el objective no existe o identity no está listo, tratar como 0.

const OBJ_H = "H";
const OBJ_VIDA = "Vida";

function getObjectiveBestEffort(name, cache) {
	try {
		if (cache.obj) return cache.obj;
		const sb = world?.scoreboard;
		if (!sb) return null;
		cache.obj = sb.getObjective(name) || null;
		return cache.obj;
	} catch (e) {
		void e;
		return null;
	}
}

const _cacheH = { obj: null };
const _cacheVida = { obj: null };

function getObjectiveHBestEffort() {
	return getObjectiveBestEffort(OBJ_H, _cacheH);
}

function getObjectiveVidaBestEffort() {
	return getObjectiveBestEffort(OBJ_VIDA, _cacheVida);
}

export function getHScoreBestEffort(player) {
	try {
		const obj = getObjectiveHBestEffort();
		if (!obj) return 0;
		const id = player?.scoreboardIdentity;
		if (!id) return 0;
		const v = obj.getScore(id);
		return Number.isFinite(v) ? v : 0;
	} catch (e) {
		void e;
		return 0;
	}
}

export function isHEnabled(player) {
	return getHScoreBestEffort(player) === 1;
}

export function getVidaScoreBestEffort(player) {
	try {
		const obj = getObjectiveVidaBestEffort();
		if (!obj) return undefined;
		const id = player?.scoreboardIdentity;
		if (!id) return undefined;
		const v = obj.getScore(id);
		return v === undefined || v === null ? undefined : Number(v);
	} catch (e) {
		void e;
		return undefined;
	}
}
