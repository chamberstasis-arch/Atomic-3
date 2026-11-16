import {
	getSkillNextXpRequirement,
	initSkillsCore,
	onSkillScoreboardsApplied as onCoreSkillScoreboardsApplied,
	reconcileSkillForPlayer,
	registerSkillDefinition,
} from "../core/index.js";
import { miningSkillConfig } from "./config.js";

let didInit = false;

function asStr(value) {
	return String(value != null ? value : "").trim();
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
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

function buildMiningSkillDefinition(config) {
	const cfg = config && typeof config === "object" ? config : miningSkillConfig;
	const rewards = cfg.rewards && typeof cfg.rewards === "object" ? cfg.rewards : {};
	const runtime = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};

	return {
		...cfg,
		id: "mining",
		displayName: "Mineria",
		rewards: {
			...rewards,
			primaryObjective: asStr(rewards.primaryObjective) || asStr(rewards.fortuneObjective) || "FortMinPersonalH",
			primaryPerLevel: toInt(rewards.primaryPerLevel ?? rewards.fortunePerLevel, 4),
		},
		runtime: {
			...runtime,
			preserveHigherPrimary: runtime.preserveHigherPrimary === true || runtime.preserveHigherFortune !== false,
		},
		presentation: {
			levelUpMessage: Array.isArray(cfg.levelUpMessage) ? cfg.levelUpMessage : [],
			titleColorFallback: cfg.titleColorFallback,
			levelUpPlaceholder: "levelUpMining",
			buildLevelLabel: ({ definition, levelDef, level }) => {
				const color = normalizeTitleColor(levelDef?.titleColor) || definition?.titleColorFallback || "§f";
				return `${color}Mineria ${toRoman(level)}§r`;
			},
			buildMessagePayload: ({ previousPrimary, nextPrimary, getLevelRewardAmount }) => ({
				PreviousFortune: previousPrimary,
				NextFortune: nextPrimary,
				ScoreboardAddD: getLevelRewardAmount("D"),
			}),
		},
	};
}

export function getMiningNextXpRequirement(currentLevel = 1) {
	return getSkillNextXpRequirement("mining", currentLevel);
}

export function reconcileMiningLevelForPlayer(player, source = "manual") {
	return reconcileSkillForPlayer("mining", player, source);
}

export function onMiningScoreboardsApplied(player, addsMap) {
	return onCoreSkillScoreboardsApplied("mining", player, addsMap);
}

export function onSkillScoreboardsApplied(player, addsMap) {
	return onMiningScoreboardsApplied(player, addsMap);
}

export function initSkillMining(userConfig = undefined) {
	if (didInit) return;
	didInit = true;
	initSkillsCore();
	registerSkillDefinition("mining", buildMiningSkillDefinition(userConfig && typeof userConfig === "object" ? userConfig : miningSkillConfig));
}