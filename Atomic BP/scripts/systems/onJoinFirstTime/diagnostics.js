import { system } from "@minecraft/server";
import { debugLog, getOverworldDimension, getPlayerSelector, runCommandForPlayer, runCommandRaw } from "./commands.js";

const didRunFor = new Set();

function safeNum(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function safeId(player) {
	try {
		return String(player?.id ?? "");
	} catch (e) {
		void e;
		return "";
	}
}

function safeDimId(player) {
	try {
		return String(player?.dimension?.id ?? "");
	} catch (e) {
		void e;
		return "";
	}
}

function safeBool(value) {
	return value === true ? "true" : value === false ? "false" : "?";
}

function summarizeCommandSupport(context) {
	try {
		return {
			hasRunCommand: typeof context?.runCommand === "function",
		};
	} catch (e) {
		void e;
		return { hasRunCommand: false };
	}
}

export function runDiagnosticsOnce(player, config) {
	if (!config?.debug) return;
	if (!config?.diagnostics?.enabled) return;
	if (!player) return;

	const key = safeId(player) || String(player?.name ?? "");
	if (!key) return;
	if (didRunFor.has(key)) return;
	const delayTicks = Math.max(0, Math.trunc(Number(config?.diagnostics?.delayTicks ?? 0)));

	didRunFor.add(key);

	system.runTimeout(() => {
		try {
			const loc = player?.location;
			const selector = getPlayerSelector(player);
			debugLog(
				config,
				`DIAG player='${String(player?.name ?? "?")}' id='${safeId(player)}' selector='${selector}' dim='${safeDimId(player)}' loc=${loc ? `${loc.x.toFixed?.(2) ?? loc.x},${loc.y.toFixed?.(2) ?? loc.y},${loc.z.toFixed?.(2) ?? loc.z}` : "?"}`
			);

			if (config?.diagnostics?.chatSummary) {
				try {
					player.sendMessage(
						`§8[DIAG]§r selector=${selector} dim=${safeDimId(player)} tick=${safeNum(system.currentTick) ?? "?"}`
					);
				} catch (e) {
					void e;
				}
			}

			let isValid = "?";
			try {
				isValid = safeBool(player?.isValid);
			} catch (e) {
				void e;
			}
			debugLog(config, `DIAG isValid=${isValid}`);

			// Permission levels (if available)
			try {
				const ppl = player?.playerPermissionLevel;
				debugLog(config, `DIAG playerPermissionLevel=${String(ppl ?? "?")}`);
			} catch (e) {
				void e;
			}
			try {
				const cpl = player?.commandPermissionLevel;
				debugLog(config, `DIAG commandPermissionLevel=${String(cpl ?? "?")}`);
			} catch (e) {
				void e;
			}

			const dim = player?.dimension ?? getOverworldDimension();
			const playerCmdSupport = summarizeCommandSupport(player);
			const dimCmdSupport = summarizeCommandSupport(dim);
			debugLog(config, `DIAG cmdSupport player(runCommand=${playerCmdSupport.hasRunCommand}) dim(runCommand=${dimCmdSupport.hasRunCommand})`);

			if (!config?.diagnostics?.probeCommands) return;

			// Probe 1: benign chat output
			void runCommandRaw(dim, `say [onJoinFirstTime] DIAG say tick=${safeNum(system.currentTick) ?? "?"}`, config, "DIAG");

			// Probe 2: tellraw scoped to player
			void runCommandForPlayer(
				player,
				`tellraw @s {"rawtext":[{"text":"[onJoinFirstTime] DIAG tellraw ok"}]}`,
				undefined,
				config,
				"DIAG"
			);

			// Probe 3: scoreboard query (should not modify anything)
			void runCommandRaw(dim, `scoreboard objectives list`, config, "DIAG");
		} catch (e) {
			void e;
			debugLog(config, `DIAG threw: ${String(e)}`);
		}
	}, delayTicks);
}
