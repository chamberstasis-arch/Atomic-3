import { system, world } from "@minecraft/server";
import achievementsConfig from "./config.js";
import { buildAchievementMessage, buildTellrawJson } from "./format/tellraw.js";
import { validateScoreboardCondition } from "./validators/scoreboard.js";
import { validatePositionCondition } from "./validators/position.js";
import { validateProximityCondition } from "./validators/proximity.js";
import { validateAreaCondition } from "./validators/area.js";
import { emitAchievementEvent, validateEventCondition, clearExpiredEvents } from "./validators/event.js";
import { handleHeartsMilestone } from "./rewards/hearts.js";
import { getAchievementObjectiveId } from "./scoreboards/scoreInit.js";

function logDebug(config, msg) {
	if (!config?.debug) return;
	try {
		console.log(`[achievements] ${String(msg)}`);
	} catch (e) {
		void e;
	}
}

function getObjective(id) {
	try {
		return world.scoreboard.getObjective(String(id)) || null;
	} catch (e) {
		void e;
		return null;
	}
}

function getScore(player, objectiveId) {
	const obj = getObjective(objectiveId);
	if (!obj) return null;
	const identity = player?.scoreboardIdentity;
	const name = player?.name;
	try {
		if (identity) {
			const v = obj.getScore(identity);
			if (Number.isFinite(v)) return v;
		}
	} catch (e) {
		void e;
	}

	try {
		if (!name) return 0;
		const vByName = obj.getScore(String(name));
		return Number.isFinite(vByName) ? vByName : 0;
	} catch (e) {
		void e;
		return 0;
	}
}

function setScore(player, objectiveId, value) {
	const obj = getObjective(objectiveId);
	if (!obj) return false;
	const identity = player?.scoreboardIdentity;
	if (!identity) return false;
	try {
		obj.setScore(identity, Math.trunc(Number(value)));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function addScore(player, objectiveId, delta) {
	const cur = getScore(player, objectiveId) ?? 0;
	return setScore(player, objectiveId, cur + Math.trunc(Number(delta)));
}

function resolveVariant(config, achievement) {
	const variants = config?.visuals?.tellraw?.variants || {};
	const key = achievement?.variant || "A";
	return variants[key] || variants.A || {};
}

function getGlobalLogrosTotal(config) {
	const totalObj = String(config?.totals?.totalObjective ?? "LogrosTotal");
	const obj = getObjective(totalObj);
	if (obj) {
		try {
			const v = obj.getScore("global");
			if (Number.isFinite(v)) return v;
		} catch (e) {
			void e;
		}
	}
	const list = config?.achievements || [];
	return list.length;
}

function sendTellraw(player, config, achievement, totalValue) {
	const tellCfg = config.visuals?.tellraw || {};
	const variant = resolveVariant(config, achievement);
	const maxChars = tellCfg.maxVisibleCharsPerLine ?? 25;

	const message = buildAchievementMessage({
		variant,
		name: achievement.name,
		description: achievement.description,
		currentTotal: totalValue,
		totalCount: getGlobalLogrosTotal(config),
		maxVisibleChars: maxChars,
	});

	const json = buildTellrawJson(message);
	const target = "@s";
	try {
		// Prefer API message for reliability
		player.sendMessage(message);
		// Best-effort command (if available/allowed)
		if (typeof player?.runCommand === "function") {
			player.runCommand(`tellraw ${target} ${json}`);
		}
	} catch (e) {
		void e;
	}
}

function spawnParticles(player, config) {
	const pCfg = config.visuals?.particlesOnUnlock;
	if (!pCfg?.enabled) return;
	const particle = "minecraft:totem_particle";
	try {
		const dim = player?.dimension;
		const loc = player?.location;
		if (dim && loc && typeof dim.spawnParticle === "function") {
			dim.spawnParticle(particle, loc);
			return;
		}
		if (typeof player?.runCommand === "function") {
			player.runCommand(`particle ${particle} ~~~`);
		}
	} catch (e) {
		void e;
	}
}


function playSoundPrivate(player, sound, fallback = { minecraftId: "random.levelup" }) {
	const s = sound && typeof sound === "object" ? sound : fallback;
	const id = String(s?.minecraftId || fallback.minecraftId || "random.levelup");
	const volume = Number.isFinite(s?.volume) ? Number(s.volume) : 1;
	const pitch = Number.isFinite(s?.pitch) ? Number(s.pitch) : 1;
	try {
		if (typeof player?.playSound === "function") {
			player.playSound(id, { volume, pitch });
			return;
		}
		const dim = player?.dimension;
		const loc = player?.location;
		if (dim && loc && typeof dim.playSound === "function") {
			dim.playSound(id, loc, { volume, pitch });
			return;
		}
		if (typeof player?.runCommand === "function") {
			player.runCommand(`playsound ${id} @s ~~~ ${volume} ${pitch}`);
		}
	} catch (e) {
		void e;
	}
}

function playSoundBroadcast(player, sound, target) {
	const id = String(sound?.minecraftId ?? "note.pling");
	const volume = Number.isFinite(sound?.volume) ? Number(sound.volume) : 1;
	const pitch = Number.isFinite(sound?.pitch) ? Number(sound.pitch) : 1;
	try {
		const dim = player?.dimension;
		const loc = player?.location;
		if (target === "@a") {
			if (dim && loc && typeof dim.playSound === "function") {
				dim.playSound(id, loc, { volume, pitch });
				return;
			}
		}
		if (target === "@s" && typeof player?.playSound === "function") {
			player.playSound(id, { volume, pitch });
			return;
		}
		if (typeof player?.runCommand === "function") {
			player.runCommand(`playsound ${id} ${target} ~~~ ${volume} ${pitch}`);
		}
	} catch (e) {
		void e;
	}
}

function sendMessageBroadcast(player, messageDef) {
	if (!messageDef || typeof messageDef !== "object") return;
	const content = String(messageDef.content ?? "");
	const target = messageDef.target === "@a" ? "@a" : "@s";
	if (content) {
		try {
			if (target === "@a") {
				world.sendMessage(content);
			} else {
				player.sendMessage(content);
			}
			if (typeof player?.runCommand === "function") {
				player.runCommand(`tellraw ${target} ${JSON.stringify({ rawtext: [{ text: content }] })}`);
			}
		} catch (e) {
			void e;
		}
	}
	const sound = messageDef.sound;
	if (!sound) return;
	playSoundBroadcast(player, sound, target);
}

function checkConditions(player, achievement, ctx) {
	const conditions = Array.isArray(achievement.conditions) ? achievement.conditions : [];
	for (const condition of conditions) {
		switch (condition?.type) {
			case "scoreboard":
				if (!validateScoreboardCondition(player, condition)) return false;
				break;
			case "position":
				if (!validatePositionCondition(player, condition)) return false;
				break;
			case "proximity":
				if (!validateProximityCondition(player, condition)) return false;
				break;
			case "area":
				if (!validateAreaCondition(player, condition)) return false;
				break;
			case "event":
				if (!validateEventCondition(player, condition)) return false;
				break;
			default:
				return false;
		}
	}

	if (typeof achievement.shouldGrant === "function") {
		try {
			return Boolean(achievement.shouldGrant(player, ctx));
		} catch (e) {
			void e;
			return false;
		}
	}

	return true;
}

function handleAchievementGrant(player, config, achievement) {
	const objectiveId = getAchievementObjectiveId(achievement);
	if (!objectiveId) return;

	const totalObj = config?.totals?.playerTotalObjective || "Logros";

	setScore(player, objectiveId, 1);
	addScore(player, totalObj, 1);

	const totalValue = getScore(player, totalObj) ?? 0;
	spawnParticles(player, config);
	sendTellraw(player, config, achievement, totalValue);
	playSoundPrivate(player, achievement?.sound, { minecraftId: "random.levelup" });

	const messageList = achievement?.message;
	if (Array.isArray(messageList)) {
		for (const msg of messageList) {
			logDebug(config, `message: ${achievement.id} -> ${String(msg?.target ?? "@s")}`);
			sendMessageBroadcast(player, msg);
		}
	}

	handleHeartsMilestone(player, config.heartsReward, totalValue);
}

function shouldSkipAchievement(player, achievement) {
	const objectiveId = getAchievementObjectiveId(achievement);
	if (!objectiveId) return true;
	const done = getScore(player, objectiveId);
	return done === 1;
}

let didInit = false;

export function initAchievements(userConfig = achievementsConfig) {
	const config = userConfig || achievementsConfig;
	if (!config || !config.achievements) return;

	if (didInit) return;
	didInit = true;

	const loopTicks = Math.max(5, Number(config.loopTicks ?? 20));


	system.runInterval(() => {
		try {
			clearExpiredEvents();
			for (const player of world.getPlayers()) {
				const ctx = {};
				for (const achievement of config.achievements) {
					if (shouldSkipAchievement(player, achievement)) continue;
					const ok = checkConditions(player, achievement, ctx);
					if (!ok) continue;
					logDebug(config, `grant: ${achievement.id} -> ${player.name}`);
					handleAchievementGrant(player, config, achievement);
				}
			}
		} catch (e) {
			void e;
		}
	}, loopTicks);

	logDebug(config, "init ok");
}

export { emitAchievementEvent };
