import { system, world } from "@minecraft/server";
import { miningSkillConfig } from "./config.js";

let didInit = false;
let activeConfig = miningSkillConfig;

function asStr(value) {
	return String(value != null ? value : "").trim();
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function clampInt32(value) {
	const n = toInt(value, 0);
	if (n > 2147483647) return 2147483647;
	if (n < -2147483648) return -2147483648;
	return n;
}

function debugEnabled(config) {
	return Boolean(config?.debug?.enabled && config?.debug?.console);
}

function debugLog(config, msg) {
	if (!debugEnabled(config)) return;
	try {
		console.log(`[skills/mining] ${String(msg ?? "")}`);
	} catch (e) {
		void e;
	}
}

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function getObjectiveCached(objectiveId) {
	const id = asStr(objectiveId);
	if (!id) return null;
	if (objectiveCache.has(id)) return objectiveCache.get(id) ?? null;
	try {
		const obj = world.scoreboard.getObjective(id) ?? null;
		if (obj) objectiveCache.set(id, obj);
		return obj;
	} catch (e) {
		void e;
		return null;
	}
}

function getScoreBestEffort(player, objectiveId) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return null;
		const identity = player?.scoreboardIdentity ?? null;
		if (!identity) return null;
		const value = obj.getScore(identity);
		if (value == null) return null;
		return toInt(value, 0);
	} catch (e) {
		void e;
		return null;
	}
}

function setScoreBestEffort(player, objectiveId, value) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return false;
		const identity = player?.scoreboardIdentity ?? null;
		if (!identity) return false;
		obj.setScore(identity, clampInt32(value));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function getReconcileEveryTicks(config) {
	const ticks = Number(config?.runtime?.reconcileEveryTicks);
	if (!Number.isFinite(ticks) || ticks <= 0) return 40;
	return Math.max(1, Math.trunc(ticks));
}

function toRoman(value) {
	let n = toInt(value, 0);
	if (n <= 0 || n > 3999) return String(value);
	const map = [
		[1000, "M"],
		[900, "CM"],
		[500, "D"],
		[400, "CD"],
		[100, "C"],
		[90, "XC"],
		[50, "L"],
		[40, "XL"],
		[10, "X"],
		[9, "IX"],
		[5, "V"],
		[4, "IV"],
		[1, "I"],
	];
	let out = "";
	for (const [base, sym] of map) {
		while (n >= base) {
			out += sym;
			n -= base;
		}
	}
	return out;
}

function normalizeRequirement(req) {
	if (!req || typeof req !== "object") return null;
	const type = asStr(req.type).toLowerCase();
	if (type !== "scoreboardmin") return null;
	const objective = asStr(req.objective);
	const min = toInt(req.min, NaN);
	if (!objective || !Number.isFinite(min)) return null;
	return { type: "scoreboardMin", objective, min };
}

function normalizeLevelEntry(entry, index, maxLevel) {
	if (!entry || typeof entry !== "object") return null;
	const level = toInt(entry.level, NaN);
	const xpRequired = toInt(entry.xpRequired, NaN);
	if (!Number.isFinite(level) || !Number.isFinite(xpRequired)) return null;
	if (level < 1 || level > maxLevel) return null;
	if (xpRequired < 0) return null;

	const requirementsRaw = Array.isArray(entry.requirements) ? entry.requirements : [];
	const requirements = requirementsRaw.map(normalizeRequirement).filter(Boolean);
	if (requirementsRaw.length > 0 && requirements.length !== requirementsRaw.length) return null;

	const rewards = entry.rewards && typeof entry.rewards === "object" ? entry.rewards : {};
	const scoreboardAddsRaw = Array.isArray(rewards.scoreboardAdds) ? rewards.scoreboardAdds : [];
	const scoreboardAdds = [];
	for (const add of scoreboardAddsRaw) {
		if (!add || typeof add !== "object") continue;
		const objective = asStr(add.objective);
		const amount = toInt(add.amount, NaN);
		if (!objective || !Number.isFinite(amount)) continue;
		scoreboardAdds.push({ objective, amount });
	}

	const messageAwards = Array.isArray(rewards.messageAwards)
		? rewards.messageAwards.map((v) => asStr(v)).filter(Boolean)
		: [];

	return {
		id: `level_${index + 1}`,
		level,
		xpRequired,
		requirements,
		rewards: {
			scoreboardAdds,
			messageAwards,
		},
	};
}

function normalizeLevels(config) {
	const maxLevel = Math.max(1, toInt(config?.maxLevel, 60));
	const raw = Array.isArray(config?.levels) ? config.levels : [];
	const out = raw.map((entry, i) => normalizeLevelEntry(entry, i, maxLevel)).filter(Boolean);
	if (out.length === 0) return [];
	out.sort((a, b) => a.level - b.level);

	for (let i = 0; i < out.length; i++) {
		if (i > 0) {
			if (out[i].level === out[i - 1].level) return [];
			if (out[i].xpRequired < out[i - 1].xpRequired) return [];
		}
	}
	if (out[0].level !== 1 || out[0].xpRequired !== 0) return [];

	const gen = config?.levelGeneration && typeof config.levelGeneration === "object" ? config.levelGeneration : null;
	const generationEnabled = gen ? gen.enabled !== false : true;
	if (!generationEnabled) return out;

	const startLevelRaw = gen ? toInt(gen.startLevel, out[out.length - 1].level + 1) : out[out.length - 1].level + 1;
	const xpStepRaw = gen ? toInt(gen.xpStep, 250) : 250;
	const startLevel = Math.max(2, startLevelRaw);
	const xpStep = Math.max(1, xpStepRaw);

	let prev = out[out.length - 1];
	const fromLevel = Math.max(startLevel, prev.level + 1);
	for (let level = fromLevel; level <= maxLevel; level++) {
		prev = {
			id: `level_${level}`,
			level,
			xpRequired: prev.xpRequired + xpStep,
			requirements: [],
			rewards: {
				scoreboardAdds: [],
				messageAwards: [],
			},
		};
		out.push(prev);
	}

	return out;
}

function getNormalizedConfig() {
	const cfg = activeConfig && typeof activeConfig === "object" ? activeConfig : miningSkillConfig;
	const xpObjective = asStr(cfg?.scoreboards?.xp) || "SkillXpMineria";
	const levelObjective = asStr(cfg?.scoreboards?.level) || "SkillLvlMineria";
	const levels = normalizeLevels(cfg);
	return {
		raw: cfg,
		enabled: cfg?.enabled !== false,
		xpObjective,
		levelObjective,
		fortuneObjective: asStr(cfg?.rewards?.fortuneObjective) || "FortMinPersonalH",
		fortunePerLevel: toInt(cfg?.rewards?.fortunePerLevel, 4),
		notifyOnLevelDown: cfg?.runtime?.notifyOnLevelDown === true,
		preserveHigherFortune: cfg?.runtime?.preserveHigherFortune !== false,
		levelUpMessage: Array.isArray(cfg?.levelUpMessage) ? cfg.levelUpMessage.map((v) => String(v ?? "")) : [],
		levels,
	};
}

function requirementPassed(player, req) {
	if (!req) return false;
	if (req.type === "scoreboardMin") {
		const score = getScoreBestEffort(player, req.objective);
		if (score == null) return false;
		return score >= req.min;
	}
	return false;
}

function levelPassed(player, levelDef, xpCurrent) {
	if (!levelDef || typeof levelDef !== "object") return false;
	if (xpCurrent < levelDef.xpRequired) return false;
	for (const req of levelDef.requirements) {
		if (!requirementPassed(player, req)) return false;
	}
	return true;
}

function resolveLevel(player, cfg, xpCurrent) {
	const levels = cfg.levels;
	if (!Array.isArray(levels) || levels.length === 0) return 1;
	let best = 1;
	for (const entry of levels) {
		if (levelPassed(player, entry, xpCurrent)) best = entry.level;
		else break;
	}
	return best;
}

function buildRewardTargets(cfg, resolvedLevel) {
	const levels = cfg.levels;
	/** @type {Record<string, number>} */
	const out = {};
	for (const entry of levels) {
		if (entry.level > resolvedLevel) break;
		const adds = entry.rewards?.scoreboardAdds || [];
		for (const add of adds) {
			const objective = asStr(add.objective);
			if (!objective) continue;
			out[objective] = toInt(out[objective], 0) + toInt(add.amount, 0);
		}
	}
	if (cfg.fortuneObjective && !(cfg.fortuneObjective in out) && cfg.fortunePerLevel !== 0) {
		out[cfg.fortuneObjective] = toInt(resolvedLevel, 1) * toInt(cfg.fortunePerLevel, 4);
	}
	return out;
}

function getLevelDef(cfg, level) {
	return cfg.levels.find((entry) => entry.level === level) ?? null;
}

function renderLevelChangeMessage(cfg, payload, levelDef) {
	const template = cfg.levelUpMessage;
	if (!Array.isArray(template) || template.length === 0) return [];
	const awards = Array.isArray(levelDef?.rewards?.messageAwards) ? levelDef.rewards.messageAwards : [];
	const out = [];
	for (const rawLine of template) {
		const line = String(rawLine ?? "");
		if (!line) continue;
		if (line.includes("<OtherAwards>")) {
			if (awards.length === 0) continue;
			for (const award of awards) out.push(String(award));
			continue;
		}

		let finalLine = line;
		for (const [k, v] of Object.entries(payload)) {
			finalLine = finalLine.replaceAll(`<${k}>`, String(v));
		}
		out.push(finalLine);
	}
	return out;
}

function sendMessageLines(player, lines) {
	if (!player || typeof player.sendMessage !== "function") return;
	for (const line of lines) {
		try {
			player.sendMessage(String(line ?? ""));
		} catch (e) {
			void e;
		}
	}
}

function reconcilePlayerInternal(player, source = "interval") {
	const cfg = getNormalizedConfig();
	if (!cfg.enabled) return false;
	if (!player?.scoreboardIdentity) return false;
	if (!Array.isArray(cfg.levels) || cfg.levels.length === 0) return false;

	const xpRaw = getScoreBestEffort(player, cfg.xpObjective);
	const xpCurrent = Math.max(0, toInt(xpRaw, 0));
	if (xpRaw == null || xpRaw < 0) setScoreBestEffort(player, cfg.xpObjective, xpCurrent);

	const previousLevelRaw = getScoreBestEffort(player, cfg.levelObjective);
	const previousLevel = Math.max(1, toInt(previousLevelRaw, 1));
	if (previousLevelRaw == null || previousLevelRaw < 1) setScoreBestEffort(player, cfg.levelObjective, previousLevel);

	const resolvedLevel = resolveLevel(player, cfg, xpCurrent);
	if (resolvedLevel !== previousLevel) setScoreBestEffort(player, cfg.levelObjective, resolvedLevel);

	const targets = buildRewardTargets(cfg, resolvedLevel);
	const previousFortune = Math.max(0, getScoreBestEffort(player, cfg.fortuneObjective) ?? 0);
	for (const [objective, value] of Object.entries(targets)) {
		const targetValue = Math.max(0, toInt(value, 0));
		if (cfg.preserveHigherFortune && objective === cfg.fortuneObjective) {
			const currentValue = Math.max(0, getScoreBestEffort(player, objective) ?? 0);
			setScoreBestEffort(player, objective, Math.max(currentValue, targetValue));
			continue;
		}
		setScoreBestEffort(player, objective, targetValue);
	}
	const nextFortune = Math.max(0, getScoreBestEffort(player, cfg.fortuneObjective) ?? 0);

	if (resolvedLevel > previousLevel || (cfg.notifyOnLevelDown && resolvedLevel < previousLevel)) {
		const nextLevelDef = getLevelDef(cfg, resolvedLevel);
		const lines = renderLevelChangeMessage(
			cfg,
			{
				PreviousLevel: toRoman(previousLevel),
				NextLevel: toRoman(resolvedLevel),
				PreviousLevelArabic: previousLevel,
				NextLevelArabic: resolvedLevel,
				PreviousFortune: previousFortune,
				NextFortune: nextFortune,
			},
			nextLevelDef
		);
		sendMessageLines(player, lines);
	}

	debugLog(cfg.raw, `reconcile source=${source} player=${asStr(player?.name)} xp=${xpCurrent} level=${previousLevel}->${resolvedLevel}`);
	return true;
}

export function reconcileMiningLevelForPlayer(player, source = "manual") {
	return reconcilePlayerInternal(player, source);
}

export function onSkillScoreboardsApplied(player, addsMap) {
	const cfg = getNormalizedConfig();
	if (!cfg.enabled) return false;
	if (!addsMap || typeof addsMap !== "object") return false;
	const delta = toInt(addsMap[cfg.xpObjective], 0);
	if (delta === 0) return false;
	return reconcilePlayerInternal(player, "regen-xp");
}

export function initSkillMining(userConfig = undefined) {
	if (didInit) return;
	didInit = true;
	activeConfig = userConfig && typeof userConfig === "object" ? userConfig : miningSkillConfig;

	const loopTicks = getReconcileEveryTicks(activeConfig);
	system.runInterval(() => {
		const players = world.getAllPlayers();
		for (const player of players) {
			reconcilePlayerInternal(player, "interval");
		}
	}, loopTicks);

	if (activeConfig?.runtime?.initializeOnJoin !== false) {
		try {
			world.afterEvents.playerSpawn.subscribe((ev) => {
				if (!ev?.player) return;
				system.run(() => {
					reconcilePlayerInternal(ev.player, "spawn");
				});
			});
		} catch (e) {
			void e;
		}
	}
}
