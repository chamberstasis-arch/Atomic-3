import { GameMode, PlayerPermissionLevel, system, world } from "@minecraft/server";

function normalizeExceptionTag(tag) {
	const t = (tag != null ? tag : "").toString().trim();
	if (!t) return null;
	const lowered = t.toLowerCase();
	if (lowered === "none" || lowered === "null") return null;
	return t;
}

function isOperator(player) {
	try {
		return Number(player && player.playerPermissionLevel != null ? player.playerPermissionLevel : 0) >= PlayerPermissionLevel.Operator;
	} catch (e) {
		void e;
		return false;
	}
}

function playerHasTag(player, tag) {
	try {
		if (!tag) return false;
		if (!player || typeof player.hasTag !== "function") return false;
		return Boolean(player.hasTag(tag));
	} catch (e) {
		void e;
		return false;
	}
}

function tryForceSurvival(player) {
	// Mejor esfuerzo. Si no se puede, solo quedará el warning.
	try {
		if (player && typeof player.setGameMode === "function") player.setGameMode(GameMode.Survival);
		return true;
	} catch (e) {
		void e;
		// fallback: comando
	}

	try {
		if (player && typeof player.runCommand === "function") player.runCommand("gamemode s");
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export const adminAllowlistCheck = {
	id: "admin_allowlist",
	section: 15,
	name: "Admin allowlist (by name) + gamemode restrictions",

	start(ctx) {
		const cfg = ctx && ctx.config && ctx.config.adminAllowlist ? ctx.config.adminAllowlist : {};
		if (!cfg || !cfg.enabled) return;

		const exceptionTag = normalizeExceptionTag(cfg.exceptionTag);
		const gmCfg = cfg && cfg.gameModes ? cfg.gameModes : {};
		const denyCreative = Boolean(gmCfg && gmCfg.denyCreative != null ? gmCfg.denyCreative : true);
		const denySpectator = Boolean(gmCfg && gmCfg.denySpectator != null ? gmCfg.denySpectator : true);
		const action = (gmCfg && gmCfg.action != null ? gmCfg.action : "ForceSurvival").toString();
		const everyTicks = Math.max(5, Number(gmCfg && gmCfg.checkEveryTicks != null ? gmCfg.checkEveryTicks : 20));

		system.runInterval(() => {
			for (const player of world.getPlayers()) {
				let gm;
				try {
					gm = player && typeof player.getGameMode === "function" ? player.getGameMode() : undefined;
				} catch (e) {
					void e;
					gm = undefined;
				}

				// Scripting V2: los miembros del enum son PascalCase (GameMode.Creative === "Creative").
				// Se compara sin distinguir mayúsculas para tolerar ambos formatos.
				const gmName = gm == null ? "" : String(gm).toLowerCase();
				const isCreative = gmName === "creative";
				const isSpectator = gmName === "spectator";
				if ((!denyCreative || !isCreative) && (!denySpectator || !isSpectator)) continue;

				const allowed = isOperator(player) || playerHasTag(player, exceptionTag);
				if (allowed) continue;

				try {
					if (ctx && ctx.enforce && typeof ctx.enforce.flag === "function") {
						ctx.enforce.flag(player, "gamemode_not_allowed", {
							checkId: "gamemode",
							severity: 2,
							tpsSensitive: false,
							details: {
								gameMode: String(gm),
								exceptionTag: exceptionTag,
							},
						});
					}
				} catch (e) {
					void e;
				}

				if (action === "ForceSurvival") {
					const ok = tryForceSurvival(player);
					try {
						if (ctx && ctx.logger && typeof ctx.logger.warn === "function") {
							ctx.logger.warn({
								checkId: "gamemode",
								player: player,
								message: "Forced survival due to illegal gamemode",
								data: { ok: ok, gameMode: String(gm) },
							});
						}
					} catch (e) {
						void e;
					}
				}
			}
		}, everyTicks);
	},
};
