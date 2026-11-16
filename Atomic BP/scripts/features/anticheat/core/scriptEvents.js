// Script events (scriptevent) para controlar flags del AntiCheat.
// Requisito: solo APIs estables de @minecraft/server.
// Sintaxis de Scriptevent:
// - id: "atomic:anticheat"
//   message: "anticheat:true"  (o enabled:true/false)
// - id: "atomic:kick"
//   message: "kick:true"  (o enabled:true/false)


import { PlayerPermissionLevel, system, world } from "@minecraft/server";
import { quoteForCommand, runAsPlayer, runInOverworld } from "./commandsRunner.js";
import { getObjectiveNameFromConfig } from "./scoreboardStore.js";
import { getFeatureFlagsDebugState, loadFeatureFlags, setAntiCheatEnabled, setBanKickEnabled } from "./featureFlags.js";

let didSubscribe = false;
let didScheduleFlags = false;

function q(value) {
	return quoteForCommand(value);
}

function tellSelf(player, message) {
	if (!player) return;
	const msg = String(message != null ? message : "");
	if (!msg) return;
	// Preferir sendMessage: no depende de cheats y es más estable.
	try {
		if (typeof player.sendMessage === "function") {
			player.sendMessage(msg);
			return;
		}
	} catch (e) {
		void e;
	}

	// Fallback: tellraw (best-effort). Ojo: runCommand puede fallar sin throw (Promise reject).
	try {
		const payload = JSON.stringify({ rawtext: [{ text: msg }] });
		runAsPlayer(player, `tellraw @s ${payload}`);
	} catch (e2) {
		void e2;
	}
}

function tellSelfTellraw(player, message) {
	if (!player) return;
	const msg = String(message != null ? message : "");
	if (!msg) return;
	// Requisito: mandar tellraw al ejecutor. Best-effort con fallback.
	try {
		const payload = JSON.stringify({ rawtext: [{ text: msg }] });
		runAsPlayer(player, `tellraw @s ${payload}`);
		return;
	} catch (e) {
		void e;
	}
	// Fallback: sendMessage
	try {
		if (typeof player.sendMessage === "function") player.sendMessage(msg);
	} catch (e2) {
		void e2;
	}
}

function isOperator(player) {
	try {
		const lvl = player && player.playerPermissionLevel != null ? player.playerPermissionLevel : 0;
		return lvl >= PlayerPermissionLevel.Operator;
	} catch (e) {
		void e;
		return false;
	}
}

function hasTag(player, tag) {
	try {
		if (!tag || tag === "none" || tag === "null") return false;
		if (!player || typeof player.hasTag !== "function") return false;
		return Boolean(player.hasTag(tag));
	} catch (e) {
		void e;
		return false;
	}
}

function normalizeName(name) {
	return String(name != null ? name : "").trim().toLowerCase();
}

function isOwnerHost(player, config) {
	if (!player) return false;
	const se = config && config.scriptevents ? config.scriptevents : {};
	const ownerTag = String(se.ownerTag != null ? se.ownerTag : "").trim();
	const ownerNames = Array.isArray(se.ownerNames) ? se.ownerNames : [];
	const nameOk = ownerNames.some((n) => normalizeName(n) && normalizeName(n) === normalizeName(player.name));
	// Requisito: escuchar solo al dueño/host. Mejor aproximación estable: OP + (nombre en allowlist o tag de owner).
	return isOperator(player) && (nameOk || (ownerTag && hasTag(player, ownerTag)));
}

function notifyOwners(config, message) {
	const msg = String(message != null ? message : "");
	if (!msg) return;
	let players = [];
	try {
		players = world.getPlayers();
	} catch (e) {
		void e;
		players = [];
	}
	for (const p of players) {
		try {
			if (p && isOwnerHost(p, config)) tellSelf(p, msg);
		} catch (e2) {
			void e2;
		}
	}
}

function parseMessageToObject(message) {
	const raw = String(message != null ? message : "").trim();
	if (!raw) return {};

	// JSON support
	if (raw.startsWith("{") && raw.endsWith("}")) {
		try {
			const obj = JSON.parse(raw);
			if (obj && typeof obj === "object") return obj;
		} catch (e) {
			void e;
			// ignore
		}
	}

	// key:value;key2=value2 support
	const out = {};
	const parts = raw.split(/[;\n,]+/g).map((p) => p.trim()).filter(Boolean);
	for (const part of parts) {
		const m = part.split(/[:=]/);
		if (m.length >= 2) {
			const key = String(m[0]).trim();
			const val = String(m.slice(1).join(":"))
				.trim()
				.replace(/^"|"$/g, "");
			out[key] = val;
			continue;
		}
		// Allow bare 'true/false'
		if (part === "true" || part === "false") out.enabled = part;
	}
	return out;
}

function toBoolOrNull(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const s = value.trim().toLowerCase();
		if (["true", "1", "on", "yes"].includes(s)) return true;
		if (["false", "0", "off", "no"].includes(s)) return false;
	}
	return null;
}

function unbanByName(config, playerName) {
	const name = String(playerName != null ? playerName : "").trim();
	if (!name) return false;

	const storage = config && config.storage ? config.storage : {};
	const sb = storage.scoreboards ? storage.scoreboards : {};
	// Importante: este módulo NO crea objectives.
	// Asume que ya existen (creados por scripts/scoreboards/init.js post-worldLoad).
	const banUntilName = getObjectiveNameFromConfig(sb.banUntil, "ac_ban_until");
	const banSanctionName = getObjectiveNameFromConfig(sb.banSanction, "ac_ban_sanction");
	const banSecondsName = getObjectiveNameFromConfig(sb.banSeconds, "ac_ban_seconds");

	// Admin action: usar comando best-effort (permite limpiar aunque el jugador no esté online).
	// Nota Bedrock: el OBJECTIVE no va entre comillas.
	const ok1 = runInOverworld(`scoreboard players set ${q(name)} ${String(banUntilName)} 0`);
	const ok2 = runInOverworld(`scoreboard players set ${q(name)} ${String(banSanctionName)} 0`);
	const ok3 = runInOverworld(`scoreboard players set ${q(name)} ${String(banSecondsName)} 0`);
	return Boolean(ok1 && ok2 && ok3);
}

function tellFlagsDebug(player) {
	if (!player) return;
	try {
		const st = getFeatureFlagsDebugState();
		const lm = String(st && st.loadMethod != null ? st.loadMethod : "unknown");
		const pm = String(st && st.persistMethod != null ? st.persistMethod : "unknown");
		const ok = Boolean(st && st.persistOk);
		let msg = `§7[ac] flags load=${lm} persist=${pm} ok=${ok}`;
		if (pm === "memory") msg += " §c(NO persistente)";
		tellSelf(player, msg);
	} catch (e) {
		void e;
	}
}

function handleBanEvent({ config, logger, messageObj, sourcePlayer }) {
	// Renombrado: este handler ahora controla el flag de kick a baneados.
	// Requisito: SOLO jugadores con tag "SX" pueden ejecutar.
	if (!sourcePlayer) return;
	if (!hasTag(sourcePlayer, "SX")) return;

	// Accept: kick:true/false OR enabled:true/false OR mensaje bare true/false
	const kickValue = toBoolOrNull(messageObj.kick != null ? messageObj.kick : messageObj.enabled);
	if (kickValue === null) return;

	const next = setBanKickEnabled(kickValue, { config, logger });
	// Requisito: tellraw al ejecutor.
	tellSelfTellraw(sourcePlayer, next ? "§aSistema de kick activado" : "§cSistema de kick desactivado");
	tellFlagsDebug(sourcePlayer);

	if (logger && typeof logger.warn === "function") {
		logger.warn({
			checkId: "scriptevent",
			player: sourcePlayer || null,
			message: `Ban-kick ${next ? "activado" : "desactivado"} por scriptevent`,
			data: { event: "kick", enabled: next },
		});
	}
}

function handleAntiCheatEvent({ config, logger, messageObj, sourcePlayer }) {
	// Requisito: solo host/owner
	if (!sourcePlayer) {
		notifyOwners(config, "§c[ac] scriptevent recibido sin jugador origen (no se puede autorizar)." );
		return;
	}
	if (!isOwnerHost(sourcePlayer, config)) {
		// Ayuda de diagnóstico: si llega el evento pero no eres owner/OP, no hace nada.
		tellSelf(sourcePlayer, "§c[ac] No autorizado. Requiere OP + ownerNames/ownerTag (ver anticheat.config.js)");
		return;
	}

	const enabledValue = toBoolOrNull(messageObj.anticheat != null ? messageObj.anticheat : messageObj.enabled);
	if (enabledValue === null) return;
	const next = setAntiCheatEnabled(enabledValue, { config, logger });
	tellSelf(sourcePlayer, next ? "§aAnticheat activado correctamente" : "§mAnticheat desactivado");
	tellFlagsDebug(sourcePlayer);
	if (logger && typeof logger.warn === "function") {
		logger.warn({
			checkId: "scriptevent",
			player: sourcePlayer,
			message: `AntiCheat ${next ? "activado" : "desactivado"} por scriptevent`,
			data: { event: "anticheat", enabled: next },
		});
	}
}

export function initAntiCheatScriptEvents(options) {
	const config = options && options.config ? options.config : {};
	const logger = options ? options.logger : undefined;

	// Cargar flags cuando el mundo ya terminó de inicializar.
	// En algunos entornos, acceder a dynamic properties/scoreboards demasiado pronto lanza excepción.
	// Esto evita warnings falsos de "no persistence" durante startup.
	if (!didScheduleFlags) {
		didScheduleFlags = true;
		let scheduledFlags = false;
		try {
			if (world && world.afterEvents && world.afterEvents.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
				world.afterEvents.worldLoad.subscribe(() => {
					loadFeatureFlags({ config: config, logger: logger });
				});
				scheduledFlags = true;
			}
		} catch (e) {
			void e;
			scheduledFlags = false;
		}
		if (!scheduledFlags) {
			// Fallback: siguiente tick.
			try {
				system.run(() => {
					loadFeatureFlags({ config: config, logger: logger });
				});
			} catch (e) {
				void e;
				// Último recurso: cargar de inmediato.
				loadFeatureFlags({ config: config, logger: logger });
			}
		}
	}
	if (didSubscribe) return;
	didSubscribe = true;

	const se = config && config.scriptevents ? config.scriptevents : {};
	if (se.enabled === false) return;

	const handler = (ev) => {
		const eventId = String(ev && ev.id != null ? ev.id : "").trim();
		if (!eventId) return;

		// IDs soportados (dos scriptevents)
		const isBan = eventId === "atomic:kick";
		const isAntiCheat = eventId === "atomic:anticheat";
		// Compatibilidad: un solo event puede enviar 'ban:true' o 'anticheat:false'
		const isCompat = eventId === "atomic:ac";
		if (!isBan && !isAntiCheat && !isCompat) return;

		const messageObj = parseMessageToObject(ev && ev.message != null ? ev.message : "");
		const source = ev ? ev.sourceEntity : null;
		let sourcePlayer = null;
		try {
			// Algunas versiones/entornos no exponen typeId o sourceEntity puede venir null.
			if (source && source.typeId === "minecraft:player") sourcePlayer = source;
			else if (source && typeof source.sendMessage === "function" && typeof source.name === "string") sourcePlayer = source;
		} catch (e) {
			void e;
			sourcePlayer = null;
		}

		if (isBan) handleBanEvent({ config, logger, messageObj, sourcePlayer });
		else if (isAntiCheat) handleAntiCheatEvent({ config, logger, messageObj, sourcePlayer });
		else {
			// Compat: decide por keys
			if ("kick" in messageObj) handleBanEvent({ config, logger, messageObj, sourcePlayer });
			if ("anticheat" in messageObj) handleAntiCheatEvent({ config, logger, messageObj, sourcePlayer });
		}
	};

	// Stable API varía según versión: intentamos system.afterEvents y world.afterEvents.
	let subscribed = false;
	try {
		system.afterEvents.scriptEventReceive.subscribe(handler);
		subscribed = true;
	} catch (e) {
		void e;
		// ignore
	}
	if (!subscribed) {
		try {
			world.afterEvents.scriptEventReceive.subscribe(handler);
			subscribed = true;
		} catch (e2) {
			void e2;
			// ignore
		}
	}

	if (!subscribed) {
		if (logger && typeof logger.warn === "function") {
			logger.warn({
				checkId: "scriptevent",
				player: null,
				message: "scriptEventReceive no está disponible en este entorno (no se podrán usar scriptevents)",
				data: null,
			});
		}
		notifyOwners(config, "§c[ac] scriptEventReceive NO disponible; /scriptevent no funcionará aquí.");
	}
	// Señal de vida (una vez): confirma que el listener está activo.
	try {
		system.run(() => notifyOwners(config, "§7[ac] scriptevents listos (listener activo)"));
	} catch (e3) {
		void e3;
	}
}
