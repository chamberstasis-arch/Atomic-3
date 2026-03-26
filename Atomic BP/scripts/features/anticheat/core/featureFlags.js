// Feature flags globales (AntiCheat / Ban-kick)
// Objetivo: permitir toggles en runtime vía scriptevent.
// Persistencia (best-effort):
// 1) Dynamic properties (si están disponibles en el entorno)
// 2) Scoreboard configurable (fallback)
// 3) Memoria runtime (último recurso)

import { system, world } from "@minecraft/server";

import { runInOverworld, quoteForCommand } from "./commandsRunner.js";
import { getObjectiveFromConfig, getObjectiveNameFromConfig } from "./scoreboardStore.js";

const AC_ENABLED_KEY = "atomic3:ac_enabled";
const BAN_KICK_ENABLED_KEY = "atomic3:ac_ban_kick_enabled";

const SB_AC_ENABLED = "ac_enabled";
const SB_BAN_KICK_ENABLED = "ac_ban_kick_enabled";

let didLoad = false;

let antiCheatEnabled = true;
let banKickEnabled = true;

let warnedNoPersistence = false;

// Estado de diagnóstico (para verificar fallbacks desde scriptevents)
let lastLoadMethod = "unknown"; // dynamicProperty | scoreboard | memory
let lastPersistMethod = "unknown"; // dynamicProperty | scoreboard | memory
let lastPersistOk = true;
let lastPersistDetail = null;

let didRegisterDynamicProps = false;

// Importante: evitar crear objectives antes de que el mundo esté listo.
let worldLoaded = false;
let didScheduleWorldLoadRetry = false;

try {
	if (world && world.afterEvents && world.afterEvents.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
		world.afterEvents.worldLoad.subscribe(() => {
			worldLoaded = true;
		});
	}
} catch (e) {
	void e;
}

export function initFeatureFlagsDynamicProperties() {
	if (didRegisterDynamicProps) return;
	didRegisterDynamicProps = true;
	// @minecraft/server 2.x: Dynamic Properties son schemaless, no requieren registro.
	// worldInitialize y DynamicPropertiesDefinition fueron removidos de la superficie estable 2.0.0+.
	// world.setDynamicProperty() funciona directamente sin registro previo.
}

function q(value) {
	return quoteForCommand(value);
}

function toBoolOrDefault(value, defaultValue) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const s = value.trim().toLowerCase();
		if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
		if (s === "false" || s === "0" || s === "off" || s === "no") return false;
	}
	return defaultValue;
}

function warnNoPersist(logger) {
	if (warnedNoPersistence) return;
	warnedNoPersistence = true;
	if (logger && typeof logger.warn === "function") {
		logger.warn({
			checkId: "featureFlags",
			player: null,
			message: "No se pudo persistir flags (dynamic properties/scoreboards no disponibles). Se usará memoria runtime.",
			data: null,
		});
	}
}

function getFlagsObjective(config) {
	if (!worldLoaded) return null;
	const storage = config && config.storage ? config.storage : {};
	const sb = storage.scoreboards ? storage.scoreboards : {};
	return getObjectiveFromConfig(sb.featureFlags, "ac_feature_flags");
}

function scheduleWorldLoadRetry(options) {
	if (didScheduleWorldLoadRetry) return;
	didScheduleWorldLoadRetry = true;
	try {
		if (world && world.afterEvents && world.afterEvents.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
			world.afterEvents.worldLoad.subscribe(() => {
				// Orden: scoreboardsInit crea objectives en worldLoad; nosotros reintentamos en el siguiente tick.
				try {
					system.run(() => {
						try {
							const logger = options ? options.logger : undefined;
							const config = options && options.config ? options.config : {};
							// Reintentar solo si DP no funcionó y estamos en modo memoria.
							if (lastLoadMethod === "memory") {
								const okLoad = tryLoadFromScoreboard(config);
								if (okLoad) lastLoadMethod = "scoreboard";
							}
							// Si el último persist fue por memoria, intentar persistir ahora.
							if (lastPersistMethod === "memory") {
								const okPersist = tryPersistToScoreboard(config, logger);
								if (okPersist) {
									lastPersistMethod = "scoreboard";
									lastPersistOk = true;
									lastPersistDetail = null;
								}
							}
						} catch (e) {
							void e;
						}
					});
				} catch (e2) {
					void e2;
				}
			});
		}
	} catch (e2) {
		void e2;
	}
}

function findParticipantByName(objective, name) {
	if (!objective) return null;
	const target = String(name != null ? name : "").trim();
	if (!target) return null;
	try {
		const parts = objective.getParticipants();
		for (const p of parts) {
			try {
				const dn = p && p.displayName != null ? p.displayName : "";
				if (String(dn) === target) return p;
			} catch (e) {
				void e;
				// ignore
			}
		}
	} catch (e) {
		void e;
		// ignore
	}
	return null;
}

function readBoolFromScoreboard(objective, name, defaultValue) {
	const participant = findParticipantByName(objective, name);
	if (!participant) return defaultValue;
	try {
		const score = Number(objective.getScore(participant));
		return score !== 0;
	} catch (e) {
		void e;
		return defaultValue;
	}
}

function writeBoolToScoreboard(objective, objectiveName, name, value) {
	const score = value ? 1 : 0;

	// 1) Intentar API directa si el participante ya existe.
	try {
		const participant = findParticipantByName(objective, name);
		if (participant) {
			objective.setScore(participant, score);
			return true;
		}
	} catch (e) {
		void e;
		// ignore
	}

	// 2) Crear/actualizar participante vía comando (best-effort). Esto NO corre por tick, solo en toggles.
	// Nota Bedrock: el OBJECTIVE no va entre comillas.
	return runInOverworld(`scoreboard players set ${q(name)} ${String(objectiveName)} ${score}`);
}

function tryLoadFromScoreboard(config) {
	const objective = getFlagsObjective(config);
	if (!objective) return false;

	antiCheatEnabled = readBoolFromScoreboard(objective, SB_AC_ENABLED, true);
	banKickEnabled = readBoolFromScoreboard(objective, SB_BAN_KICK_ENABLED, true);
	return true;
}

function tryPersistToScoreboard(config, logger) {
	const objective = getFlagsObjective(config);
	if (!objective) return false;

	const storage = config && config.storage ? config.storage : {};
	const sb = storage.scoreboards ? storage.scoreboards : {};
	const objectiveName = getObjectiveNameFromConfig(sb.featureFlags, "ac_feature_flags");
	const ok1 = writeBoolToScoreboard(objective, objectiveName, SB_AC_ENABLED, antiCheatEnabled);
	const ok2 = writeBoolToScoreboard(objective, objectiveName, SB_BAN_KICK_ENABLED, banKickEnabled);
	if (!(ok1 && ok2)) {
		if (logger && typeof logger.warn === "function") {
			logger.warn({
				checkId: "featureFlags",
				player: null,
				message: "No se pudo persistir flags por scoreboard (best-effort)",
				data: { objective: objectiveName, ok1: ok1, ok2: ok2 },
			});
		}
	}
	return Boolean(ok1 && ok2);
}

export function loadFeatureFlags(options) {
	if (didLoad) return;
	didLoad = true;

	const logger = options ? options.logger : undefined;
	const config = options && options.config ? options.config : {};

	try {
		antiCheatEnabled = toBoolOrDefault(world.getDynamicProperty(AC_ENABLED_KEY), true);
		banKickEnabled = toBoolOrDefault(world.getDynamicProperty(BAN_KICK_ENABLED_KEY), true);
		lastLoadMethod = "dynamicProperty";
		return;
	} catch (e) {
		void e;
		// ignore y cae a scoreboard
	}

	// Asegurar reintento post-worldLoad si caímos a scoreboard/memoria.
	scheduleWorldLoadRetry(options);

	const ok = tryLoadFromScoreboard(config);
	if (ok) {
		lastLoadMethod = "scoreboard";
		return;
	}
	lastLoadMethod = "memory";
	warnNoPersist(logger);
}

export function isAntiCheatEnabled() {
	return Boolean(antiCheatEnabled);
}

export function isBanKickEnabled() {
	return Boolean(banKickEnabled);
}

export function setAntiCheatEnabled(enabled, options) {
	antiCheatEnabled = Boolean(enabled);
	const logger = options ? options.logger : undefined;
	const config = options && options.config ? options.config : {};
	try {
		world.setDynamicProperty(AC_ENABLED_KEY, antiCheatEnabled);
		lastPersistMethod = "dynamicProperty";
		lastPersistOk = true;
		lastPersistDetail = null;
		return antiCheatEnabled;
	} catch (e) {
		void e;
		// ignore y cae a scoreboard
	}

	scheduleWorldLoadRetry(options);

	const ok = tryPersistToScoreboard(config, logger);
	lastPersistMethod = ok ? "scoreboard" : "memory";
	lastPersistOk = Boolean(ok);
	lastPersistDetail = ok ? null : { reason: "scoreboard_persist_failed" };
	if (!ok) warnNoPersist(logger);
	return antiCheatEnabled;
}

export function setBanKickEnabled(enabled, options) {
	banKickEnabled = Boolean(enabled);
	const logger = options ? options.logger : undefined;
	const config = options && options.config ? options.config : {};
	try {
		world.setDynamicProperty(BAN_KICK_ENABLED_KEY, banKickEnabled);
		lastPersistMethod = "dynamicProperty";
		lastPersistOk = true;
		lastPersistDetail = null;
		return banKickEnabled;
	} catch (e) {
		void e;
		// ignore y cae a scoreboard
	}

	scheduleWorldLoadRetry(options);

	const ok = tryPersistToScoreboard(config, logger);
	lastPersistMethod = ok ? "scoreboard" : "memory";
	lastPersistOk = Boolean(ok);
	lastPersistDetail = ok ? null : { reason: "scoreboard_persist_failed" };
	if (!ok) warnNoPersist(logger);
	return banKickEnabled;
}

export function getFeatureFlagsDebugState() {
	return {
		loadMethod: lastLoadMethod,
		persistMethod: lastPersistMethod,
		persistOk: Boolean(lastPersistOk),
		persistDetail: lastPersistDetail,
		flags: getFeatureFlags(),
	};
}

export function getFeatureFlags() {
	return {
		antiCheatEnabled: Boolean(antiCheatEnabled),
		banKickEnabled: Boolean(banKickEnabled),
	};
}
