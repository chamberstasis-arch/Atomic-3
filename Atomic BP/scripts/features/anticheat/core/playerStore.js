// Persistencia de datos por jugador para AntiCheat.
// Objetivo: no usar el script como "base de datos" y ser escalable.
// Implementación: Scoreboards (sin comandos), configurables desde anticheat.config.js.

import { getObjectiveFromConfig, getPlayerScore, setPlayerScore, addPlayerScore } from "./scoreboardStore.js";

// Fallback antiguo por Dynamic Properties si el scoreboard no está disponible.
const LEGACY_WARNINGS_KEY = "atomic:ac_player_warnings";

let _config = null;
let _warningsObjective = null;

export function initPlayerStore(config) {
	_config = config != null ? config : null;
	// Importante: este módulo NO crea objectives.
	// La creación se hace únicamente en scripts/scoreboards/init.js.
}

function ensureWarningsObjective() {
	if (_warningsObjective) return _warningsObjective;
	const storage = _config && _config.storage ? _config.storage : {};
	const sbCfg = storage.scoreboards ? storage.scoreboards.playerWarnings : undefined;
	_warningsObjective = getObjectiveFromConfig(sbCfg, "advertencias");
	return _warningsObjective;
}

function tryReadLegacyWarnings(player) {
	try {
		if (!player || typeof player.getDynamicProperty !== "function") return 0;
		const raw = player.getDynamicProperty(LEGACY_WARNINGS_KEY);
		const n = Number(raw);
		return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
	} catch (e) {
		void e;
		return 0;
	}
}

function tryClearLegacyWarnings(player) {
	try {
		if (player && typeof player.setDynamicProperty === "function") {
			player.setDynamicProperty(LEGACY_WARNINGS_KEY, 0);
		}
	} catch (e) {
		void e;
		// ignore
	}
}

export function getPlayerWarnings(player) {
	const obj = ensureWarningsObjective();
	if (!obj) {
		// Fallback: si el scoreboard no está disponible, no rompemos la lógica.
		return tryReadLegacyWarnings(player);
	}

	const sbValue = Math.max(0, Math.floor(getPlayerScore(obj, player)));
	if (sbValue > 0) return sbValue;

	// Migración best-effort: si el scoreboard está en 0 pero el legacy tiene valor, copiamos.
	const legacy = tryReadLegacyWarnings(player);
	if (legacy > 0) {
		const migrated = setPlayerScore(obj, player, legacy);
		if (migrated) tryClearLegacyWarnings(player);
		return legacy;
	}
	return 0;
}

export function setPlayerWarnings(player, count) {
	const obj = ensureWarningsObjective();
	const safe = Math.max(0, Math.floor(Number(count) || 0));
	if (!obj) {
		// Fallback
		try {
			if (player && typeof player.setDynamicProperty === "function") {
				player.setDynamicProperty(LEGACY_WARNINGS_KEY, safe);
				return true;
			}
			return false;
		} catch (e) {
			void e;
			return false;
		}
	}
	return setPlayerScore(obj, player, safe);
}

export function addPlayerWarnings(player, delta) {
	const obj = ensureWarningsObjective();
	if (!obj) {
		const current = tryReadLegacyWarnings(player);
		return setPlayerWarnings(player, current + (Number(delta) || 0));
	}
	return addPlayerScore(obj, player, Number(delta) || 0);
}
