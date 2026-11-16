// Ban kick enforcer (AntiCheat)
//
// Responsabilidad única:
// - Detectar si un jugador está baneado al entrar (spawn inicial)
// - Expulsarlo mostrando el motivo y el tiempo restante
//
// Importante:
// - Este módulo NO crea scoreboards objectives.
// - Asume que los objectives ya existen (creados por scripts/scoreboards/init.js post-worldLoad).

import { system, world } from "@minecraft/server";

import { quoteForCommand, runInOverworld } from "./commandsRunner.js";
import { getPlayerScore, setPlayerScore, INT32_MAX } from "./scoreboardStore.js";
import { isBanKickEnabled } from "./featureFlags.js";

// Legacy (migración): antes se usaban dynamic properties.
export const BAN_UNTIL_KEY = "atomic:ac_ban_until";
export const BAN_REASON_KEY = "atomic:ac_ban_reason";

let didSubscribe = false;

/** @type {any} */
let runtime = {
	logger: null,
	getSanctionDef: null,
	banUntilObj: null,
	banSanctionObj: null,
	banSecondsObj: null,
};

function nowSec() {
	return Math.floor(Date.now() / 1000);
}

function q(value) {
	return quoteForCommand(value);
}

function pad2(n) {
	return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0");
}

function formatRemainingFromSeconds(totalSeconds) {
	const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
	const days = Math.floor(s / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;
	return `${pad2(days)}:${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatBanKickMessage(reason, untilSec) {
	const safeReason = String(reason != null ? reason : "").trim();

	// Mensaje compacto y consistente.
	if (untilSec === INT32_MAX) {
		return (
			`§cBan §lPERMANENTE§r§4 - Motivo:§b ${safeReason}§c\n` +
			`Tiempo restante:§b PERMANENTE\n` +
			`§fEn caso de error contactar a antheuss`
		);
	}

	const remainingSec = Math.max(0, Math.floor(Number(untilSec) - nowSec()));
	const headerDays = Math.min(Math.max(Math.ceil(remainingSec / 86400), 1), 99);
	return (
		`§cBan de §l${headerDays}d§r§4 - Motivo:§b ${safeReason}§c\n` +
		`Tiempo restante:§b ${formatRemainingFromSeconds(remainingSec)}\n` +
		`§fEn caso de error contactar a antheuss`
	);
}

export function readLegacyBanUntilSec(player) {
	try {
		if (!player || typeof player.getDynamicProperty !== "function") return 0;
		const v = Number(player.getDynamicProperty(BAN_UNTIL_KEY));
		if (!Number.isFinite(v) || v <= 0) return 0;
		// legacy guardaba ms
		return Math.max(0, Math.floor(v / 1000));
	} catch (e) {
		void e;
		return 0;
	}
}

export function readLegacyBanReason(player) {
	try {
		if (!player || typeof player.getDynamicProperty !== "function") return "";
		const v = player.getDynamicProperty(BAN_REASON_KEY);
		return String(v != null ? v : "");
	} catch (e) {
		void e;
		return "";
	}
}

export function tryClearLegacyBan(player) {
	try {
		if (player && typeof player.setDynamicProperty === "function") {
			player.setDynamicProperty(BAN_UNTIL_KEY, 0);
			player.setDynamicProperty(BAN_REASON_KEY, "");
		}
	} catch (e) {
		void e;
	}
}

function kickPlayer(player, message) {
	// 1) Intento directo con runCommand en overworld (más cercano a lo que funciona en muchos entornos)
	try {
		const overworld = world.getDimension("overworld");
		// Requisito del usuario: kick sin motivo primero.
		try {
			overworld.runCommand(`kick ${q(player.name)}`);
			return true;
		} catch (e0) {
			void e0;
		}

		// Fallback: intentar con motivo (sanitizado a una línea)
		const raw0 = String(message != null ? message : "Sancionado");
		const singleLine0 = raw0.replace(/\r?\n/g, " ");
		try {
			overworld.runCommand(`kick ${q(player.name)} ${q(singleLine0)}`);
			return true;
		} catch (e1) {
			void e1;
		}
	} catch (e) {
		void e;
	}

	// 2) Fallback: wrapper existente (best-effort)
	const raw = String(message != null ? message : "Sancionado");
	const ok = runInOverworld(`kick ${q(player.name)} ${q(raw)}`);
	if (ok) return true;
	const singleLine = raw.replace(/\r?\n/g, " ");
	return runInOverworld(`kick ${q(player.name)} ${q(singleLine)}`);
}

function tellPlayer(player, message) {
	try {
		if (player && typeof player.sendMessage === "function") {
			player.sendMessage(String(message != null ? message : ""));
		}
	} catch (e) {
		void e;
	}
}

function clearBanState(rt, player) {
	try {
		if (rt && rt.banUntilObj) setPlayerScore(rt.banUntilObj, player, 0);
		if (rt && rt.banSanctionObj) setPlayerScore(rt.banSanctionObj, player, 0);
		if (rt && rt.banSecondsObj) setPlayerScore(rt.banSecondsObj, player, 0);
	} catch (e) {
		void e;
	}
	tryClearLegacyBan(player);
}

function getBanUntilSecFromRuntime(rt, player) {
	const banUntilObj = rt && rt.banUntilObj ? rt.banUntilObj : null;
	if (banUntilObj) {
		const until = Math.max(0, Math.floor(getPlayerScore(banUntilObj, player)));
		if (until > 0) return until;
		return 0;
	}
	// Fallback legacy solo si no hay scoreboard.
	return readLegacyBanUntilSec(player);
}

function getSanctionIdFromRuntime(rt, player) {
	const banSanctionObj = rt && rt.banSanctionObj ? rt.banSanctionObj : null;
	if (!banSanctionObj) return 0;
	return Math.max(0, Math.floor(getPlayerScore(banSanctionObj, player)));
}

function resolveReason(rt, player, sanctionId) {
	let def = null;
	try {
		def = rt && typeof rt.getSanctionDef === "function" ? rt.getSanctionDef(sanctionId) : null;
	} catch (e) {
		void e;
		def = null;
	}
	const fromDef = def && def.name != null ? String(def.name) : "";
	const legacy = String(readLegacyBanReason(player) || "");
	const reason = String((fromDef || legacy || "Ban")).trim();
	return { reason, def };
}

export function setBanKickRuntime(nextRuntime) {
	runtime = {
		logger: nextRuntime && nextRuntime.logger ? nextRuntime.logger : runtime.logger,
		getSanctionDef: nextRuntime && nextRuntime.getSanctionDef ? nextRuntime.getSanctionDef : runtime.getSanctionDef,
		banUntilObj: nextRuntime && nextRuntime.banUntilObj ? nextRuntime.banUntilObj : null,
		banSanctionObj: nextRuntime && nextRuntime.banSanctionObj ? nextRuntime.banSanctionObj : null,
		banSecondsObj: nextRuntime && nextRuntime.banSecondsObj ? nextRuntime.banSecondsObj : null,
	};
}

export function initBanKickEnforcer(options) {
	const logger = options ? options.logger : undefined;
	const getSanctionDef = options ? options.getSanctionDef : undefined;
	setBanKickRuntime({ logger, getSanctionDef });

	if (didSubscribe) return;
	didSubscribe = true;

	world.afterEvents.playerSpawn.subscribe((ev) => {
		if (!isBanKickEnabled()) return;
		const player = ev ? ev.player : null;
		if (!player) return;
		if (ev && "initialSpawn" in ev && !ev.initialSpawn) return;

		const rt = runtime;
		const untilSec = getBanUntilSecFromRuntime(rt, player);
		if (!untilSec) return;

		// Expirado (solo para bans temporales)
		if (untilSec !== INT32_MAX && untilSec <= nowSec()) {
			// Ban expirado: limpiar estado para evitar falsos kicks futuros.
			clearBanState(rt, player);
			return;
		}

		const sanctionId = getSanctionIdFromRuntime(rt, player);
		const rr = resolveReason(rt, player, sanctionId);
		const msg = formatBanKickMessage(rr.reason, untilSec);

		// Enviar detalle por chat SIEMPRE (aunque el kick lo haga una .mcfunction).
		tellPlayer(player, msg);

		if (rt && rt.logger && typeof rt.logger.warn === "function") {
			rt.logger.warn({
				checkId: "kickEvent",
				player: player,
				message: "Jugador baneado intentó entrar",
				data: { untilSec: untilSec, sanctionId: sanctionId },
			});
		}

		// Best-effort kick
		system.run(() => {
			// 1) Intento principal: overworld.runCommand (dentro de kickPlayer)
			let ok = kickPlayer(player, msg);
			if (!ok && rt && rt.logger && typeof rt.logger.warn === "function") {
				rt.logger.warn({
					checkId: "kickEvent",
					player: player,
					message: "Kick falló (comando kick no disponible o sin permisos).",
					data: { untilSec: untilSec, sanctionId: sanctionId },
				});
			}
		});
	});
}

export function kickNowIfBanned(player, untilSec, reason, logger) {
	if (!player) return false;
	if (!isBanKickEnabled()) return false;
	const msg = formatBanKickMessage(reason, untilSec);
	// Enviar detalle por chat antes del kick.
	tellPlayer(player, msg);
	let ok = kickPlayer(player, msg);
	if (!ok && logger && typeof logger.warn === "function") {
		logger.warn({
			checkId: "kickEvent",
			player: player,
			message: "Kick falló (comando kick no disponible o sin permisos).",
			data: { untilSec: untilSec },
		});
	}
	return ok;
}
