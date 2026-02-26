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

function normalizeScoreboardAddItem(value, defaultObjective = "D") {
	if (value == null) return null;
	if (typeof value === "number") {
		const amount = toInt(value, NaN);
		if (!Number.isFinite(amount)) return null;
		return { objective: asStr(defaultObjective) || "D", amount };
	}
	if (typeof value !== "object") return null;
	const objective = asStr(value.objective) || asStr(defaultObjective) || "D";
	const amount = toInt(value.amount, NaN);
	if (!objective || !Number.isFinite(amount)) return null;
	return { objective, amount };
}

function normalizeScoreboardAddDRanges(raw, maxLevel) {
	if (!Array.isArray(raw)) return [];
	const ranges = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const fromLevel = Math.max(1, toInt(entry.fromLevel ?? entry.from, NaN));
		const toLevel = Math.min(maxLevel, toInt(entry.toLevel ?? entry.to, NaN));
		const amount = toInt(entry.amount, NaN);
		if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || !Number.isFinite(amount)) continue;
		if (toLevel < fromLevel) continue;
		ranges.push({ fromLevel, toLevel, amount });
	}
	return ranges;
}

function getDefaultScoreboardAddDForLevel(level, options = {}) {
	const ranges = Array.isArray(options.defaultScoreboardAddDRanges) ? options.defaultScoreboardAddDRanges : [];
	for (const range of ranges) {
		if (!range || typeof range !== "object") continue;
		if (level >= range.fromLevel && level <= range.toLevel) {
			return toInt(range.amount, 0);
		}
	}
	return toInt(options.defaultScoreboardAddD, 0);
}

function normalizeLevelEntry(entry, index, maxLevel, options = {}) {
	if (!entry || typeof entry !== "object") return null;
	const level = toInt(entry.level, NaN);
	const xpRequired = toInt(entry.xpRequired, NaN);
	if (!Number.isFinite(level) || !Number.isFinite(xpRequired)) return null;
	if (level < 1 || level > maxLevel) return null;
	if (xpRequired < 0) return null;
	const defaultScoreboardAddD = getDefaultScoreboardAddDForLevel(level, options);

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

	const directAddD = toInt(entry.scoreboardAddD, NaN);
	if (Number.isFinite(directAddD)) {
		scoreboardAdds.push({ objective: "D", amount: directAddD });
	}

	const directAddsRaw = entry.scoreboardAdd;
	if (Array.isArray(directAddsRaw)) {
		for (const item of directAddsRaw) {
			const normalized = normalizeScoreboardAddItem(item, "D");
			if (normalized) scoreboardAdds.push(normalized);
		}
	} else {
		const normalized = normalizeScoreboardAddItem(directAddsRaw, "D");
		if (normalized) scoreboardAdds.push(normalized);
	}

	if (scoreboardAdds.length === 0 && defaultScoreboardAddD !== 0) {
		scoreboardAdds.push({ objective: "D", amount: defaultScoreboardAddD });
	}

	const addsMerged = [];
	/** @type {Record<string, number>} */
	const addsMap = {};
	for (const add of scoreboardAdds) {
		const objective = asStr(add.objective);
		if (!objective) continue;
		addsMap[objective] = toInt(addsMap[objective], 0) + toInt(add.amount, 0);
	}
	for (const [objective, amount] of Object.entries(addsMap)) {
		if (amount === 0) continue;
		addsMerged.push({ objective, amount });
	}

	let messageAwards = [];
	if (Array.isArray(rewards.messageAwards)) {
		messageAwards = rewards.messageAwards.map((v) => asStr(v)).filter(Boolean);
	} else {
		const oneAward = asStr(rewards.messageAwards);
		if (oneAward) messageAwards = [oneAward];
	}

	return {
		id: asStr(entry.id) || `level_${index + 1}`,
		level,
		xpRequired,
		requirements,
		rewards: {
			scoreboardAdds: addsMerged,
			messageAwards,
		},
	};
}

function buildMiningLevelsCatalog(config) {
	const maxLevel = Math.max(1, toInt(config?.maxLevel, 60));
	const defaultScoreboardAddD = toInt(config?.rewards?.defaultScoreboardAddD, 0);
	const defaultScoreboardAddDRanges = normalizeScoreboardAddDRanges(config?.rewards?.defaultScoreboardAddDRanges, maxLevel);
	const raw = Array.isArray(config?.levels) ? config.levels : [];
	const out = raw
		.map((entry, i) => normalizeLevelEntry(entry, i, maxLevel, { defaultScoreboardAddD, defaultScoreboardAddDRanges }))
		.filter(Boolean);
	if (out.length === 0) return [];
	out.sort((a, b) => a.level - b.level);

	for (let i = 0; i < out.length; i++) {
		if (i > 0) {
			if (out[i].level === out[i - 1].level) return [];
			if (out[i].xpRequired < out[i - 1].xpRequired) return [];
		}
	}
	if (out[0].level !== 1 || out[0].xpRequired !== 0) return [];

	return out;
}

function getNextLevelXpRequirement(levelsCatalog, currentLevel) {
	const levels = Array.isArray(levelsCatalog) ? levelsCatalog : [];
	const lvl = Math.max(1, toInt(currentLevel, 1));
	for (const entry of levels) {
		if (!entry || typeof entry !== "object") continue;
		if (entry.level > lvl) return entry.xpRequired;
	}
	return null;
}

function getNormalizedConfig() {
	const cfg = activeConfig && typeof activeConfig === "object" ? activeConfig : miningSkillConfig;
	const xpObjective = asStr(cfg?.scoreboards?.xp) || "SkillXpMineria";
	const levelObjective = asStr(cfg?.scoreboards?.level) || "SkillLvlMineria";
	const levels = buildMiningLevelsCatalog(cfg);
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

export function getMiningNextXpRequirement(currentLevel = 1) {
	const cfg = activeConfig && typeof activeConfig === "object" ? activeConfig : miningSkillConfig;
	const levels = buildMiningLevelsCatalog(cfg);
	return getNextLevelXpRequirement(levels, currentLevel);
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

function buildLevelUpRewardAdds(cfg, fromLevel, toLevel) {
	/** @type {Record<string, number>} */
	const out = {};
	const from = Math.max(1, toInt(fromLevel, 1));
	const to = Math.max(from, toInt(toLevel, from));
	for (const entry of cfg.levels) {
		if (entry.level < from) continue;
		if (entry.level > to) break;
		const adds = Array.isArray(entry.rewards?.scoreboardAdds) ? entry.rewards.scoreboardAdds : [];
		for (const add of adds) {
			const objective = asStr(add.objective);
			if (!objective) continue;
			out[objective] = toInt(out[objective], 0) + toInt(add.amount, 0);
		}
	}
	return out;
}

function applyAdditiveRewards(player, addsMap) {
	if (!player?.scoreboardIdentity) return;
	for (const [objective, amountRaw] of Object.entries(addsMap || {})) {
		const objectiveId = asStr(objective);
		if (!objectiveId) continue;
		const amount = toInt(amountRaw, 0);
		if (amount === 0) continue;
		const current = toInt(getScoreBestEffort(player, objectiveId), 0);
		setScoreBestEffort(player, objectiveId, current + amount);
	}
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
		if (line.includes("<OtherAwards>")) {
			if (awards.length === 0) continue;
			for (const award of awards) {
				out.push(line.replaceAll("<OtherAwards>", String(award ?? "")));
			}
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

function getLevelRewardAmount(levelDef, objectiveId) {
	const objective = asStr(objectiveId);
	if (!objective) return 0;
	const adds = Array.isArray(levelDef?.rewards?.scoreboardAdds) ? levelDef.rewards.scoreboardAdds : [];
	let total = 0;
	for (const add of adds) {
		if (asStr(add?.objective) !== objective) continue;
		total += toInt(add?.amount, 0);
	}
	return total;
}

function getFortuneTargetForLevel(cfg, level) {
	const lvl = Math.max(1, toInt(level, 1));
	const perLevel = toInt(cfg?.fortunePerLevel, 4);
	return Math.max(0, lvl * perLevel);
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

	const previousFortuneFromLevel = getFortuneTargetForLevel(cfg, previousLevel);
	const nextFortuneFromLevel = getFortuneTargetForLevel(cfg, resolvedLevel);
	const targetFortune = nextFortuneFromLevel;
	if (cfg.preserveHigherFortune) {
		const currentFortune = Math.max(0, getScoreBestEffort(player, cfg.fortuneObjective) ?? 0);
		setScoreBestEffort(player, cfg.fortuneObjective, Math.max(currentFortune, targetFortune));
	} else {
		setScoreBestEffort(player, cfg.fortuneObjective, targetFortune);
	}

	if (resolvedLevel > previousLevel) {
		const addsMap = buildLevelUpRewardAdds(cfg, previousLevel + 1, resolvedLevel);
		applyAdditiveRewards(player, addsMap);
	}

	if (resolvedLevel > previousLevel || (cfg.notifyOnLevelDown && resolvedLevel < previousLevel)) {
		const nextLevelDef = getLevelDef(cfg, resolvedLevel);
		const lines = renderLevelChangeMessage(
			cfg,
			{
				PreviousLevel: toRoman(previousLevel),
				NextLevel: toRoman(resolvedLevel),
				PreviousLevelArabic: previousLevel,
				NextLevelArabic: resolvedLevel,
				PreviousFortune: previousFortuneFromLevel,
				NextFortune: nextFortuneFromLevel,
				ScoreboardAddD: getLevelRewardAmount(nextLevelDef, "D"),
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
