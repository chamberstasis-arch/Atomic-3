import { asStr, getScoreBestEffort, setScoreBestEffort, toInt } from "./scoreboards.js";

const DEFAULT_LEVEL_UP_SOUND = Object.freeze({ id: "random.levelup", volume: 1, pitch: 1 });
const DEFAULT_LEVEL_UP_PARTICLE = Object.freeze({ id: "minecraft:totem_particle", count: 1, offset: { x: 0, y: 0, z: 0 } });
const SKILL_GATE_OBJECTIVE = "H";

function hasSkillGateEnabled(player) {
	const gate = getScoreBestEffort(player, SKILL_GATE_OBJECTIVE);
	if (gate == null) return false;
	return Number(gate) >= 1;
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

function normalizeTitleColor(value) {
	const color = asStr(value);
	if (!color) return "";
	return /^§[0-9a-f]$/i.test(color) ? color : "";
}

function normalizeSoundEffect(value, fallback = DEFAULT_LEVEL_UP_SOUND) {
	if (value === false) return false;
	if (typeof value === "string") {
		const id = asStr(value);
		return id ? { ...fallback, id } : { ...fallback };
	}
	if (!value || typeof value !== "object") return { ...fallback };
	const id = asStr(value.id ?? value.minecraftId ?? fallback.id);
	if (!id) return { ...fallback };
	const volume = Number.isFinite(Number(value.volume)) ? Number(value.volume) : fallback.volume;
	const pitch = Number.isFinite(Number(value.pitch)) ? Number(value.pitch) : fallback.pitch;
	return {
		id,
		volume: Math.max(0, Math.min(4, volume)),
		pitch: Math.max(0, Math.min(2, pitch)),
	};
}

function normalizeParticleEffect(value, fallback = DEFAULT_LEVEL_UP_PARTICLE) {
	if (value === false) return false;
	if (typeof value === "string") {
		const id = asStr(value);
		return id ? { ...fallback, id, offset: { ...fallback.offset } } : { ...fallback, offset: { ...fallback.offset } };
	}
	if (!value || typeof value !== "object") return { ...fallback, offset: { ...fallback.offset } };
	const id = asStr(value.id ?? value.particleId ?? fallback.id);
	if (!id) return { ...fallback, offset: { ...fallback.offset } };
	const count = Math.max(1, Math.min(32, toInt(value.count, fallback.count)));
	const offsetRaw = value.offset && typeof value.offset === "object" ? value.offset : {};
	const baseOffset = fallback.offset && typeof fallback.offset === "object" ? fallback.offset : { x: 0, y: 0, z: 0 };
	const offset = {
		x: Number.isFinite(Number(offsetRaw.x)) ? Number(offsetRaw.x) : baseOffset.x,
		y: Number.isFinite(Number(offsetRaw.y)) ? Number(offsetRaw.y) : baseOffset.y,
		z: Number.isFinite(Number(offsetRaw.z)) ? Number(offsetRaw.z) : baseOffset.z,
	};
	return { id, count, offset };
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
		if (level >= range.fromLevel && level <= range.toLevel) return toInt(range.amount, 0);
	}
	return toInt(options.defaultScoreboardAddD, 0);
}

function normalizeLevelEntry(entry, index, maxLevel, options = {}) {
	if (!entry || typeof entry !== "object") return null;
	const level = toInt(entry.level, NaN);
	const xpRequired = toInt(entry.xpRequired, NaN);
	if (!Number.isFinite(level) || !Number.isFinite(xpRequired)) return null;
	if (level < 1 || level > maxLevel || xpRequired < 0) return null;

	const requirementsRaw = Array.isArray(entry.requirements) ? entry.requirements : [];
	const requirements = requirementsRaw.map(normalizeRequirement).filter(Boolean);
	if (requirementsRaw.length > 0 && requirements.length !== requirementsRaw.length) {
		requirements.length = 0;
		requirements.push({ type: "invalidRequirement" });
	}

	const rewards = entry.rewards && typeof entry.rewards === "object" ? entry.rewards : {};
	const scoreboardAdds = [];
	const scoreboardAddsRaw = Array.isArray(rewards.scoreboardAdds) ? rewards.scoreboardAdds : [];
	for (const add of scoreboardAddsRaw) {
		if (!add || typeof add !== "object") continue;
		const objective = asStr(add.objective);
		const amount = toInt(add.amount, NaN);
		if (!objective || !Number.isFinite(amount)) continue;
		scoreboardAdds.push({ objective, amount });
	}

	const directAddD = toInt(entry.scoreboardAddD, NaN);
	if (Number.isFinite(directAddD)) scoreboardAdds.push({ objective: "D", amount: directAddD });

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

	const defaultScoreboardAddD = getDefaultScoreboardAddDForLevel(level, options);
	if (scoreboardAdds.length === 0 && defaultScoreboardAddD !== 0) {
		scoreboardAdds.push({ objective: "D", amount: defaultScoreboardAddD });
	}

	/** @type {Record<string, number>} */
	const addsMap = {};
	for (const add of scoreboardAdds) {
		const objective = asStr(add.objective);
		if (!objective) continue;
		addsMap[objective] = toInt(addsMap[objective], 0) + toInt(add.amount, 0);
	}

	const addsMerged = [];
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

	const sound = normalizeSoundEffect(entry.sound, DEFAULT_LEVEL_UP_SOUND);
	const particle = normalizeParticleEffect(entry.particle, DEFAULT_LEVEL_UP_PARTICLE);

	return {
		id: asStr(entry.id) || `level_${index + 1}`,
		level,
		xpRequired,
		titleColor: normalizeTitleColor(entry.titleColor),
		requirements,
		effects: {
			sound,
			particle,
		},
		rewards: {
			scoreboardAdds: addsMerged,
			messageAwards,
		},
	};
}

function buildLevelsCatalog(definition, maxLevel, rewardsCfg) {
	const defaultScoreboardAddD = toInt(rewardsCfg?.defaultScoreboardAddD, 0);
	const defaultScoreboardAddDRanges = normalizeScoreboardAddDRanges(rewardsCfg?.defaultScoreboardAddDRanges, maxLevel);
	const raw = Array.isArray(definition?.levels) ? definition.levels : [];
	const out = raw
		.map((entry, index) => normalizeLevelEntry(entry, index, maxLevel, { defaultScoreboardAddD, defaultScoreboardAddDRanges }))
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

function getReconcileEveryTicks(runtime) {
	const ticks = Number(runtime?.reconcileEveryTicks);
	if (!Number.isFinite(ticks) || ticks <= 0) return 40;
	return Math.max(1, Math.trunc(ticks));
}

function requirementPassed(player, req) {
	if (!req || req.type !== "scoreboardMin") return false;
	const score = getScoreBestEffort(player, req.objective);
	if (score == null) return false;
	return score >= req.min;
}

function levelPassed(player, levelDef, xpCurrent) {
	if (!levelDef || typeof levelDef !== "object") return false;
	if (xpCurrent < levelDef.xpRequired) return false;
	for (const req of levelDef.requirements) {
		if (!requirementPassed(player, req)) return false;
	}
	return true;
}

function resolveLevel(player, definition, xpCurrent) {
	const levels = definition.levels;
	if (!Array.isArray(levels) || levels.length === 0) return 1;
	let best = 1;
	for (const entry of levels) {
		if (xpCurrent < entry.xpRequired) break;
		if (levelPassed(player, entry, xpCurrent)) best = entry.level;
		else break;
	}
	return best;
}

function buildLevelUpRewardAdds(definition, fromLevel, toLevel) {
	/** @type {Record<string, number>} */
	const out = {};
	const from = Math.max(1, toInt(fromLevel, 1));
	const to = Math.max(from, toInt(toLevel, from));
	for (const entry of definition.levels) {
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

function getLevelDef(definition, level) {
	return definition.levels.find((entry) => entry.level === level) ?? null;
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

function getPrimaryTargetForLevel(definition, level) {
	const lvl = Math.max(1, toInt(level, 1));
	const perLevel = toInt(definition.primaryPerLevel, 0);
	return Math.max(0, lvl * perLevel);
}

function buildDefaultLevelLabel(definition, levelDef, levelNumber) {
	const color = normalizeTitleColor(levelDef?.titleColor) || definition.titleColorFallback || "§f";
	return `${color}${definition.displayName} ${toRoman(levelNumber)}§r`;
}

function renderLevelChangeMessage(definition, payload, levelDef) {
	const template = definition.levelUpMessage;
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
		for (const [key, value] of Object.entries(payload)) {
			finalLine = finalLine.replaceAll(`<${key}>`, String(value));
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

function isSafeCommandToken(token) {
	return /^[0-9A-Za-z_:\.-]+$/.test(String(token != null ? token : ""));
}

function emitLevelChangeSound(player, sound) {
	if (!player || sound === false) return;
	const resolved = normalizeSoundEffect(sound, DEFAULT_LEVEL_UP_SOUND);
	if (!resolved || resolved === false) return;
	try {
		if (typeof player.playSound === "function") {
			player.playSound(resolved.id, { volume: resolved.volume, pitch: resolved.pitch });
			return;
		}
		const dim = player.dimension;
		const loc = player.location;
		if (dim && loc && typeof dim.playSound === "function") {
			dim.playSound(resolved.id, loc, { volume: resolved.volume, pitch: resolved.pitch });
			return;
		}
		if (typeof player.runCommandAsync === "function" && isSafeCommandToken(resolved.id)) {
			player.runCommandAsync(`playsound ${resolved.id} @s ~~~ ${resolved.volume} ${resolved.pitch}`);
		}
	} catch (e) {
		void e;
	}
}

function emitLevelChangeParticles(player, particle) {
	if (!player || particle === false) return;
	const resolved = normalizeParticleEffect(particle, DEFAULT_LEVEL_UP_PARTICLE);
	if (!resolved || resolved === false) return;
	try {
		const dim = player.dimension;
		const loc = player.location;
		if (!dim || !loc) return;
		const spawnAt = {
			x: loc.x + resolved.offset.x,
			y: loc.y + resolved.offset.y,
			z: loc.z + resolved.offset.z,
		};
		if (typeof dim.spawnParticle === "function") {
			for (let i = 0; i < resolved.count; i++) dim.spawnParticle(resolved.id, spawnAt);
			return;
		}
		if (typeof player.runCommandAsync === "function" && isSafeCommandToken(resolved.id)) {
			for (let i = 0; i < resolved.count; i++) player.runCommandAsync(`particle ${resolved.id} ~~~`);
		}
	} catch (e) {
		void e;
	}
}

export function normalizeSkillDefinition(definition, skillIdFallback = "") {
	if (!definition || typeof definition !== "object") return null;
	const id = asStr(definition.id || skillIdFallback).toLowerCase();
	const scoreboards = definition.scoreboards && typeof definition.scoreboards === "object" ? definition.scoreboards : {};
	const rewards = definition.rewards && typeof definition.rewards === "object" ? definition.rewards : {};
	const runtime = definition.runtime && typeof definition.runtime === "object" ? definition.runtime : {};
	const presentation = definition.presentation && typeof definition.presentation === "object" ? definition.presentation : {};
	const maxLevel = Math.max(1, toInt(definition.maxLevel, 60));
	const levels = buildLevelsCatalog(definition, maxLevel, rewards);
	if (!id || !scoreboards || levels.length === 0) return null;

	const levelUpPlaceholder = asStr(presentation.levelUpPlaceholder) || "LevelUpSkill";
	const buildLevelLabel = typeof presentation.buildLevelLabel === "function"
		? presentation.buildLevelLabel
		: (ctx) => buildDefaultLevelLabel(ctx.definition, ctx.levelDef, ctx.level);
	const buildMessagePayload = typeof presentation.buildMessagePayload === "function" ? presentation.buildMessagePayload : null;
	const sendLevelChangeMessage = typeof presentation.sendLevelChangeMessage === "function" ? presentation.sendLevelChangeMessage : null;
	const levelUpSound = normalizeSoundEffect(presentation.levelUpSound ?? definition.levelUpSound, DEFAULT_LEVEL_UP_SOUND);
	const levelUpParticle = normalizeParticleEffect(presentation.levelUpParticle ?? definition.levelUpParticle, DEFAULT_LEVEL_UP_PARTICLE);

	return {
		id,
		raw: definition,
		enabled: definition.enabled !== false,
		displayName: asStr(definition.displayName) || id,
		xpObjective: asStr(scoreboards.xp),
		levelObjective: asStr(scoreboards.level),
		primaryObjective: asStr(rewards.primaryObjective ?? rewards.fortuneObjective),
		primaryPerLevel: toInt(rewards.primaryPerLevel ?? rewards.fortunePerLevel, 0),
		titleColorFallback: normalizeTitleColor(presentation.titleColorFallback ?? definition.titleColorFallback) || "§f",
		levelUpMessage: Array.isArray(presentation.levelUpMessage ?? definition.levelUpMessage)
			? (presentation.levelUpMessage ?? definition.levelUpMessage).map((v) => String(v ?? ""))
			: [],
		levelUpPlaceholder,
		buildLevelLabel,
		buildMessagePayload,
		sendLevelChangeMessage,
		levelUpSound,
		levelUpParticle,
		notifyOnLevelDown: runtime.notifyOnLevelDown === true,
		preserveHigherPrimary: runtime.preserveHigherPrimary === true,
		initializeOnJoin: runtime.initializeOnJoin !== false,
		reconcileEveryTicks: getReconcileEveryTicks(runtime),
		levels,
	};
}

export function getSkillNextXpRequirementForDefinition(definition, currentLevel = 1) {
	const levels = Array.isArray(definition?.levels) ? definition.levels : [];
	const lvl = Math.max(1, toInt(currentLevel, 1));
	for (const entry of levels) {
		if (!entry || typeof entry !== "object") continue;
		if (entry.level > lvl) return entry.xpRequired;
	}
	return null;
}

export function reconcileSkillForDefinition(definition, player, source = "manual") {
	if (!definition?.enabled || !player?.scoreboardIdentity) return false;
	if (!Array.isArray(definition.levels) || definition.levels.length === 0) return false;
	if (!hasSkillGateEnabled(player)) return false;

	const xpRaw = getScoreBestEffort(player, definition.xpObjective);
	const xpCurrent = Math.max(0, toInt(xpRaw, 0));
	if (xpRaw == null || xpRaw < 0) setScoreBestEffort(player, definition.xpObjective, xpCurrent);

	const previousLevelRaw = getScoreBestEffort(player, definition.levelObjective);
	const previousLevel = Math.max(1, toInt(previousLevelRaw, 1));
	if (previousLevelRaw == null || previousLevelRaw < 1) setScoreBestEffort(player, definition.levelObjective, previousLevel);

	const resolvedLevel = resolveLevel(player, definition, xpCurrent);
	let effectiveLevel = previousLevel;
	if (resolvedLevel !== previousLevel) {
		setScoreBestEffort(player, definition.levelObjective, resolvedLevel);
		const persistedLevelRaw = getScoreBestEffort(player, definition.levelObjective);
		effectiveLevel = Math.max(1, toInt(persistedLevelRaw, previousLevel));
	}

	const previousPrimary = getPrimaryTargetForLevel(definition, previousLevel);
	const nextPrimary = getPrimaryTargetForLevel(definition, effectiveLevel);
	if (definition.primaryObjective) {
		if (definition.preserveHigherPrimary) {
			const currentPrimary = Math.max(0, getScoreBestEffort(player, definition.primaryObjective) ?? 0);
			setScoreBestEffort(player, definition.primaryObjective, Math.max(currentPrimary, nextPrimary));
		} else {
			setScoreBestEffort(player, definition.primaryObjective, nextPrimary);
		}
	}

	if (effectiveLevel > previousLevel) {
		const addsMap = buildLevelUpRewardAdds(definition, previousLevel + 1, effectiveLevel);
		applyAdditiveRewards(player, addsMap);
	}

	if (effectiveLevel > previousLevel || (definition.notifyOnLevelDown && effectiveLevel < previousLevel)) {
		const levelDef = getLevelDef(definition, effectiveLevel);
		const levelLabel = definition.buildLevelLabel({ definition, levelDef, level: effectiveLevel, previousLevel, player });
		const basePayload = {
			LevelUpSkill: levelLabel,
			PreviousLevel: toRoman(previousLevel),
			NextLevel: toRoman(effectiveLevel),
			PreviousLevelArabic: previousLevel,
			NextLevelArabic: effectiveLevel,
			PreviousPrimaryReward: previousPrimary,
			NextPrimaryReward: nextPrimary,
		};
		basePayload[definition.levelUpPlaceholder] = levelLabel;

		const customPayload = definition.buildMessagePayload
			? definition.buildMessagePayload({
				definition,
				player,
				levelDef,
				previousLevel,
				effectiveLevel,
				previousPrimary,
				nextPrimary,
				getLevelRewardAmount: (objectiveId) => getLevelRewardAmount(levelDef, objectiveId),
			})
			: null;
		const payload = customPayload && typeof customPayload === "object" ? { ...basePayload, ...customPayload } : basePayload;
		const lines = renderLevelChangeMessage(definition, payload, levelDef);
		if (definition.sendLevelChangeMessage) definition.sendLevelChangeMessage({ definition, player, lines, payload, levelDef, source });
		else sendMessageLines(player, lines);
		if (effectiveLevel > previousLevel) {
			emitLevelChangeSound(player, levelDef?.effects?.sound ?? definition.levelUpSound);
			emitLevelChangeParticles(player, levelDef?.effects?.particle ?? definition.levelUpParticle);
		}
	}

	return true;
}

export function onSkillScoreboardsAppliedForDefinition(definition, player, addsMap) {
	if (!definition?.enabled || !addsMap || typeof addsMap !== "object") return false;
	const delta = toInt(addsMap[definition.xpObjective], 0);
	if (delta === 0) return false;
	return reconcileSkillForDefinition(definition, player, "regen-xp");
}