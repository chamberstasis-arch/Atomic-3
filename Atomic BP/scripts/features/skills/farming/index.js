import {
	getSkillNextXpRequirement,
	initSkillsCore,
	onSkillScoreboardsApplied as onCoreSkillScoreboardsApplied,
	reconcileSkillForPlayer,
	registerSkillDefinition,
} from "../core/index.js";
import { farmingSkillConfig } from "./config.js";

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
		[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
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

function buildFarmingSkillDefinition(config) {
	const cfg = config && typeof config === "object" ? config : farmingSkillConfig;
	const rewards = cfg.rewards && typeof cfg.rewards === "object" ? cfg.rewards : {};
	const runtime = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
	return {
		...cfg,
		id: "farming",
		displayName: "Cosecha",
		rewards: {
			...rewards,
			primaryObjective: asStr(rewards.primaryObjective) || asStr(rewards.fortuneObjective) || "FortCosPersonalH",
			primaryPerLevel: toInt(rewards.primaryPerLevel ?? rewards.fortunePerLevel, 4),
		},
		runtime: {
			...runtime,
			preserveHigherPrimary: runtime.preserveHigherPrimary === true || runtime.preserveHigherFortune !== false,
		},
		presentation: {
			levelUpMessage: Array.isArray(cfg.levelUpMessage) ? cfg.levelUpMessage : [],
			titleColorFallback: cfg.titleColorFallback,
			levelUpPlaceholder: "levelUpFarming",
			buildLevelLabel: ({ definition, levelDef, level }) => {
				const color = normalizeTitleColor(levelDef?.titleColor) || definition?.titleColorFallback || "§f";
				return `${color}Cosecha ${toRoman(level)}§r`;
			},
			buildMessagePayload: ({ previousPrimary, nextPrimary, getLevelRewardAmount }) => ({
				PreviousFortune: previousPrimary,
				NextFortune: nextPrimary,
				ScoreboardAddD: getLevelRewardAmount("D"),
			}),
		},
	};
}

export function getFarmingNextXpRequirement(currentLevel = 1) {
	return getSkillNextXpRequirement("farming", currentLevel);
}

export function reconcileFarmingLevelForPlayer(player, source = "manual") {
	return reconcileSkillForPlayer("farming", player, source);
}

export function onFarmingScoreboardsApplied(player, addsMap) {
	return onCoreSkillScoreboardsApplied("farming", player, addsMap);
}

export function initSkillFarming(userConfig = undefined) {
	if (didInit) return;
	didInit = true;
	initSkillsCore();
	registerSkillDefinition("farming", buildFarmingSkillDefinition(userConfig && typeof userConfig === "object" ? userConfig : farmingSkillConfig));
}
