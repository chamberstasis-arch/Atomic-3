// Runner centralizado de comandos (AntiCheat)
// Objetivo: unificar quoting, dimensión, y ejecución best-effort.

import { world } from "@minecraft/server";

function getOverworld() {
	try {
		return world.getDimension("overworld");
	} catch (e) {
		void e;
		return null;
	}
}

export function quoteForCommand(value) {
	return `"${String(value).replace(/"/g, "\\\"")}"`;
}

export function runInOverworld(command) {
	const dim = getOverworld();
	if (!dim) return false;
	try {
		dim.runCommand(String(command));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function runAsPlayer(player, command) {
	try {
		if (player && typeof player.runCommand === "function") {
			player.runCommand(String(command));
			return true;
		}
		return false;
	} catch (e) {
		void e;
		return false;
	}
}
