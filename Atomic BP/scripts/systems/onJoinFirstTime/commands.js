import { world } from "@minecraft/server";

function safeString(value) {
	try {
		return String(value ?? "");
	} catch (e) {
		void e;
		return "";
	}
}

export function debugLog(config, message) {
	if (!config?.debug) return;
	try {
		console.warn(`[onJoinFirstTime] ${message}`);
	} catch (e) {
		void e;
	}
}

export function escapePlayerName(player) {
	return safeString(player?.name).replace(/"/g, "");
}

export function getPlayerSelector(player) {
	const name = escapePlayerName(player);
	if (!name) return "@s";
	return `@a[name="${name}"]`;
}

export function getOverworldDimension() {
	try {
		return world.getDimension("minecraft:overworld");
	} catch (e) {
		void e;
		return null;
	}
}

function extractCommandResult(result) {
	if (!result) return { successCount: undefined, statusMessage: undefined };
	try {
		const successCount =
			typeof result.successCount === "number" ? result.successCount : undefined;
		const statusMessage =
			typeof result.statusMessage === "string" ? result.statusMessage : undefined;
		return { successCount, statusMessage };
	} catch (e) {
		void e;
		return { successCount: undefined, statusMessage: undefined };
	}
}

function statusLooksLikeFailure(statusMessage) {
	const s = safeString(statusMessage).toLowerCase();
	if (!s) return false;
	return (
		s.includes("syntax") ||
		s.includes("unknown") ||
		s.includes("no targets") ||
		s.includes("no se") ||
		s.includes("no existe") ||
		s.includes("failed") ||
		s.includes("error")
	);
}

/**
 * Ejecuta un comando con `runCommand` (síncrono; `runCommandAsync` fue eliminado en Scripting V2).
 * Devuelve un resultado normalizado y nunca lanza. Se mantiene `async` por compatibilidad con los llamadores.
 */
export async function runCommandRaw(context, command, config, label = undefined) {
	const cmd = safeString(command).trim();
	if (!cmd) return { ok: false, used: "none", command: cmd };

	try {
		if (typeof context?.runCommand === "function") {
			const result = context.runCommand(cmd);
			const { successCount, statusMessage } = extractCommandResult(result);
			if (config?.debug && label) {
				debugLog(config, `${label}: ${cmd} -> successCount=${successCount ?? "?"} status=${safeString(statusMessage)}`);
			}
			return {
				ok: successCount == null ? true : successCount > 0 || !statusLooksLikeFailure(statusMessage),
				used: "sync",
				command: cmd,
				successCount,
				statusMessage,
			};
		}
	} catch (e) {
		if (config?.debug && label) {
			debugLog(config, `${label}: ERROR running '${cmd}'`);
		}
		return { ok: false, used: "error", command: cmd, error: e };
	}

	if (config?.debug && label) {
		debugLog(config, `${label}: No command runner available for '${cmd}'`);
	}
	return { ok: false, used: "missing", command: cmd };
}

/**
 * Best-effort: try as player with @s, then as dimension with an explicit player selector.
 */
export async function runCommandForPlayer(player, cmdAtS, cmdWithSelector, config, label = undefined) {
	const selector = getPlayerSelector(player);
	const cmdSel = safeString(cmdWithSelector || (cmdAtS ? safeString(cmdAtS).replace(/@s/g, selector) : ""));

	if (cmdAtS) {
		const r1 = await runCommandRaw(player, cmdAtS, config, label);
		if (r1.ok) return true;
	}

	const dim = player?.dimension ?? getOverworldDimension();
	if (!dim || !cmdSel) return false;
	const r2 = await runCommandRaw(dim, cmdSel, config, label);
	return Boolean(r2.ok);
}
