// Ban clock updater (AntiCheat)
//
// Objetivo:
// - Mantener un scoreboard con los SEGUNDOS RESTANTES del ban por jugador.
// - Permite verificar con comandos:
//   /scoreboard players test <jugador> ac_ban_seconds <min> <max>
//
// Importante:
// - Este módulo NO crea objectives.
// - Asume que los objectives ya existen (creados por scripts/scoreboards/init.js post-worldLoad).

import { system, world } from "@minecraft/server";
import { getPlayerScore, setPlayerScore, INT32_MAX } from "./scoreboardStore.js";

let didInit = false;

/** @type {any} */
let runtime = {
	logger: null,
	banUntilObj: null,
	banSanctionObj: null,
	banSecondsObj: null,
};

function nowSec() {
	return Math.floor(Date.now() / 1000);
}

export function setBanClockRuntime(nextRuntime) {
	runtime = {
		logger: nextRuntime && nextRuntime.logger ? nextRuntime.logger : runtime.logger,
		banUntilObj: nextRuntime && nextRuntime.banUntilObj ? nextRuntime.banUntilObj : null,
		banSanctionObj: nextRuntime && nextRuntime.banSanctionObj ? nextRuntime.banSanctionObj : null,
		banSecondsObj: nextRuntime && nextRuntime.banSecondsObj ? nextRuntime.banSecondsObj : null,
	};
}

function clearBanState(rt, player) {
	try {
		if (rt.banUntilObj) setPlayerScore(rt.banUntilObj, player, 0);
		if (rt.banSanctionObj) setPlayerScore(rt.banSanctionObj, player, 0);
		if (rt.banSecondsObj) setPlayerScore(rt.banSecondsObj, player, 0);
	} catch (e) {
		void e;
	}
}

function updatePlayer(rt, player) {
	if (!rt || !player) return;
	if (!rt.banUntilObj || !rt.banSecondsObj) return;

	const until = Math.max(0, Math.floor(getPlayerScore(rt.banUntilObj, player)));
	if (!until) return;

	if (until === INT32_MAX) {
		// Permanente: dejamos un valor estable para comandos (INT32_MAX)
		setPlayerScore(rt.banSecondsObj, player, INT32_MAX);
		return;
	}

	const rem = Math.max(0, Math.floor(until - nowSec()));
	if (rem <= 0) {
		clearBanState(rt, player);
		return;
	}
	setPlayerScore(rt.banSecondsObj, player, rem);
}

function tick() {
	const rt = runtime;
	if (!rt || !rt.banUntilObj || !rt.banSecondsObj) return;
	let players = [];
	try {
		players = world.getPlayers();
	} catch (e) {
		void e;
		players = [];
	}
	for (const p of players) {
		updatePlayer(rt, p);
	}
}

export function initBanClock(options) {
	if (didInit) return;
	didInit = true;

	const logger = options ? options.logger : undefined;
	setBanClockRuntime({ logger });

	let scheduled = false;
	try {
		if (world && world.afterEvents && world.afterEvents.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
			world.afterEvents.worldLoad.subscribe(() => {
				// Orden: scripts/scoreboards/init.js crea objectives en worldLoad; actualizar en el siguiente tick.
				try {
					system.run(() => {
						tick();
						system.runInterval(() => tick(), 20);
					});
				} catch (e) {
					void e;
					tick();
					system.runInterval(() => tick(), 20);
				}
			});
			scheduled = true;
		}
	} catch (e2) {
		void e2;
		scheduled = false;
	}

	if (!scheduled) {
		try {
			system.run(() => {
				tick();
				system.runInterval(() => tick(), 20);
			});
		} catch (e3) {
			void e3;
			tick();
			system.runInterval(() => tick(), 20);
		}
	}
}
