// Sanciones AntiCheat
// Nota: el Script API no siempre permite un "ban" real del servidor/realm.
// Implementación más cercana: se guarda un estado de ban por jugador y se le expulsa al entrar.
// "wipe" = quitarle los objetos (inventario/equipo). No todo el contenido (ej. ender chest) es accesible por API.

import { system, world } from "@minecraft/server";
import { quoteForCommand, runAsPlayer, runInOverworld } from "./commandsRunner.js";
import { getObjectiveFromConfig, getPlayerScore, setPlayerScore, INT32_MAX } from "./scoreboardStore.js";
import { isBanKickEnabled } from "./featureFlags.js";
import { BAN_REASON_KEY, BAN_UNTIL_KEY, initBanKickEnforcer, kickNowIfBanned, readLegacyBanUntilSec, setBanKickRuntime, tryClearLegacyBan } from "./kickEvent.js";
import { initBanClock, setBanClockRuntime } from "./banClock.js";

function nowSec() {
	return Math.floor(Date.now() / 1000);
}

function q(value) {
	return quoteForCommand(value);
}

function ensureObjectives(config) {
	const storage = config && config.storage ? config.storage : {};
	const sb = storage.scoreboards ? storage.scoreboards : {};
	const banUntilObj = getObjectiveFromConfig(sb.banUntil, "ac_ban_until");
	const banSanctionObj = getObjectiveFromConfig(sb.banSanction, "ac_ban_sanction");
	// Nuevo: duración original del ban en segundos (por jugador). 0 = no aplica / permanente.
	const banSecondsObj = getObjectiveFromConfig(sb.banSeconds, "ac_ban_seconds");
	return { banUntilObj, banSanctionObj, banSecondsObj };
}

function getBanUntilSec(runtime, player) {
	const banUntilObj = runtime && runtime.banUntilObj ? runtime.banUntilObj : null;
	const until = Math.max(0, Math.floor(getPlayerScore(banUntilObj, player)));
	if (until > 0) return until;

	// Si el scoreboard no está disponible, no intentamos migración.
	if (!banUntilObj) {
		return readLegacyBanUntilSec(player);
	}

	// Migración best-effort desde legacy (ms -> sec)
	const legacySec = readLegacyBanUntilSec(player);
	if (legacySec > 0) {
		const okUntil = setPlayerScore(banUntilObj, player, legacySec);
		const okSanction = setPlayerScore(banSanctionObj, player, 2);
		if (okUntil && okSanction) tryClearLegacyBan(player);
		return legacySec;
	}
	return 0;
}

function setBanScoreboards(runtime, player, untilSec, sanctionId) {
	const banUntilObj = runtime && runtime.banUntilObj ? runtime.banUntilObj : null;
	const banSanctionObj = runtime && runtime.banSanctionObj ? runtime.banSanctionObj : null;
	const banSecondsObj = runtime && runtime.banSecondsObj ? runtime.banSecondsObj : null;
	setPlayerScore(banUntilObj, player, untilSec);
	setPlayerScore(banSanctionObj, player, Number(sanctionId) || 0);
	// banSeconds se setea desde applySanctionById cuando aplica.
	if (banSecondsObj) {
		// no-op default (mantener valor existente si no se provee)
		void banSecondsObj;
	}
}

function clearBanScoreboards(runtime, player) {
	setBanScoreboards(runtime, player, 0, 0);
	try {
		const banSecondsObj = runtime && runtime.banSecondsObj ? runtime.banSecondsObj : null;
		if (banSecondsObj) setPlayerScore(banSecondsObj, player, 0);
	} catch (e) {
		void e;
	}
}

function clearInventory(player) {
	return runInOverworld(`clear ${q(player.name)}`);
}

function wipePlayer(player) {
	// Wipe = clear inventario. Equipo normalmente se limpia con clear también.
	return clearInventory(player);
}

function resetAllScoreboardsForSelf(player) {
	// Requisito del proyecto: usar exactamente `/scoreboard players reset @s *`.
	// Para que @s funcione, se ejecuta el comando desde el propio jugador.
	return runAsPlayer(player, "scoreboard players reset @s *");
}

// Enforcer se maneja en core/kickEvent.js

function computeBanUntil(def) {
	if (def && def.permanent) return INT32_MAX;
	const days = def ? def.banDays : undefined;
	if (days == null) return 0;
	const n = Number(days);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return nowSec() + Math.floor(n * 24 * 60 * 60);
}

/**
 * @param {{ config?: any, logger?: any }} options
 */
export function createSanctionsManager(options) {
	const config = options && options.config ? options.config : {};
	const logger = options ? options.logger : undefined;
	/** @type {any} */
	let objectives = { banUntilObj: null, banSanctionObj: null, banSecondsObj: null };

	function refreshObjectives() {
		try {
			objectives = ensureObjectives(config);
		} catch (e) {
			void e;
			objectives = { banUntilObj: null, banSanctionObj: null, banSecondsObj: null };
		}
		// Actualiza runtime del kick enforcer con los objetivos ya obtenidos.
		setBanKickRuntime({
			logger,
			getSanctionDef,
			banUntilObj: objectives.banUntilObj,
			banSanctionObj: objectives.banSanctionObj,
			banSecondsObj: objectives.banSecondsObj,
		});
		// Mantener segundos restantes sincronizados.
		setBanClockRuntime({
			logger,
			banUntilObj: objectives.banUntilObj,
			banSanctionObj: objectives.banSanctionObj,
			banSecondsObj: objectives.banSecondsObj,
		});
	}

	function getSanctionDef(id) {
		const key = String(id);
		const sanctionsCfg = config && config.sanctions ? config.sanctions : {};
		return sanctionsCfg[key] != null ? sanctionsCfg[key] : sanctionsCfg[id] != null ? sanctionsCfg[id] : null;
	}

	// Importante: asegurar objectives solo cuando el mundo esté cargado.
	let scheduled = false;
	try {
		if (world && world.afterEvents && world.afterEvents.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
			// Orden: scripts/scoreboards/init.js crea objectives en worldLoad; nosotros leemos en el siguiente tick.
			world.afterEvents.worldLoad.subscribe(() => {
				try {
					system.run(() => refreshObjectives());
				} catch (e) {
					void e;
					refreshObjectives();
				}
			});
			scheduled = true;
		}
	} catch (e) {
		void e;
		scheduled = false;
	}
	if (!scheduled) {
		try {
			system.run(() => refreshObjectives());
		} catch (e2) {
			void e2;
			refreshObjectives();
		}
	}

	// Suscribir el enforcer una sola vez.
	initBanKickEnforcer({ logger, getSanctionDef });
	// Suscribir el reloj (actualiza ac_ban_seconds = segundos restantes)
	initBanClock({ logger });

	function applySanctionById(player, sanctionId, meta) {
		const def = getSanctionDef(sanctionId);
		if (!def) {
			if (logger && typeof logger.error === "function") {
				logger.error({ checkId: "sanctions", player: player, message: "Sanción no definida", data: { sanctionId: sanctionId } });
			}
			return;
		}

		if (logger && typeof logger.warn === "function") {
			logger.warn({
				checkId: meta && meta.checkId != null ? meta.checkId : "sanctions",
				player: player,
				message: `Aplicando sanción ${sanctionId}: ${def && def.name != null ? def.name : ""}`,
				data: { sanctionId: sanctionId, def: def, reason: meta && meta.reason != null ? meta.reason : null },
			});
		}

		// 1) Clear
		if (Number(sanctionId) === 1) {
			clearInventory(player);
			return;
		}

		// 4) Reset de todos los scoreboards del jugador
		if (Number(sanctionId) === 4) {
			resetAllScoreboardsForSelf(player);
			return;
		}

		// 5) Wipe
		if (Number(sanctionId) === 5) {
			wipePlayer(player);
			return;
		}

		// Bans (2,3,6,7)
		const until = computeBanUntil(def);
		const wipe = Boolean(def && def.wipe);
		const reason = def && def.name != null ? def.name : "";
		// IMPORTANTE: ac_ban_seconds ahora representa los SEGUNDOS RESTANTES.
		// Al aplicar, el valor inicial coincide con la duración total (para bans temporales).
		const durationSec = def && def.permanent ? INT32_MAX : def && def.banDays != null ? Math.max(0, Math.floor(Number(def.banDays) * 86400)) : 0;

		if (wipe) {
			wipePlayer(player);
		}

		// Guardar ban en scoreboards y expulsar.
		if (objectives && objectives.banUntilObj && objectives.banSanctionObj) {
			setBanScoreboards(objectives, player, until, Number(sanctionId));
			try {
				if (objectives.banSecondsObj) {
					// Para temporal: segundos restantes iniciales. Para permanente: INT32_MAX.
					setPlayerScore(objectives.banSecondsObj, player, durationSec);
				}
			} catch (e) {
				void e;
			}
		} else {
			// Fallback: si no hay scoreboards, usar legacy dynamic properties.
			try {
				if (player && typeof player.setDynamicProperty === "function") {
					player.setDynamicProperty(BAN_UNTIL_KEY, until === INT32_MAX ? Number.MAX_SAFE_INTEGER : until * 1000);
					player.setDynamicProperty(BAN_REASON_KEY, String(def && def.name != null ? def.name : ""));
				}
			} catch (e) {
				void e;
				// ignore
			}
		}

		// Best-effort kick (si el sistema de ban-kick está habilitado)
		if (isBanKickEnabled()) {
			kickNowIfBanned(player, until, reason, logger);
		}
	}

	function apply(player, sanction) {
		// Contrato: sanction puede venir como { sanctionId } o { id }.
		const sanctionId = sanction && sanction.sanctionId != null ? sanction.sanctionId : sanction && sanction.id != null ? sanction.id : null;
		if (sanctionId == null) {
			if (logger && typeof logger.error === "function") {
				logger.error({ checkId: "sanctions", player: player, message: "apply() sin sanctionId", data: sanction });
			}
			return;
		}
		applySanctionById(player, sanctionId, { checkId: sanction && sanction.checkId != null ? sanction.checkId : undefined, reason: sanction && sanction.reason != null ? sanction.reason : undefined });
	}

	return {
		apply,
		applySanctionById,
	};
}
