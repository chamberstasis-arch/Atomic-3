import {
	getSkillNextXpRequirement,
	initSkillsCore,
	onSkillScoreboardsApplied as onCoreSkillScoreboardsApplied,
	reconcileSkillForPlayer,
	registerSkillDefinition,
} from "../core/index.js";
import { combatSkillConfig } from "./config.js";
import { initCombatXp } from "./xp.js";
import { initCombatLoot } from "./loot.js";

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

function buildCombatSkillDefinition(config) {
	const cfg = config && typeof config === "object" ? config : combatSkillConfig;
	const rewards = cfg.rewards && typeof cfg.rewards === "object" ? cfg.rewards : {};
	const runtime = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};

	return {
		...cfg,
		id: "combat",
		displayName: "Combate",
		rewards: {
			...rewards,
			primaryObjective: asStr(rewards.primaryObjective) || "DanoPersonalH",
			primaryPerLevel: toInt(rewards.primaryPerLevel, 2),
		},
		runtime: {
			...runtime,
			preserveHigherPrimary: runtime.preserveHigherPrimary !== false,
		},
		presentation: {
			levelUpMessage: Array.isArray(cfg.levelUpMessage) ? cfg.levelUpMessage : [],
			titleColorFallback: cfg.titleColorFallback,
			levelUpPlaceholder: "levelUpCombat",
			buildLevelLabel: ({ definition, levelDef, level }) => {
				const color = normalizeTitleColor(levelDef?.titleColor) || definition?.titleColorFallback || "§f";
				return `${color}Combate ${toRoman(level)}§r`;
			},
			buildMessagePayload: ({ previousPrimary, nextPrimary, getLevelRewardAmount }) => ({
				PreviousPrimary: previousPrimary,
				NextPrimary: nextPrimary,
				ScoreboardAddD: getLevelRewardAmount("D"),
			}),
		},
	};
}

export function getCombatNextXpRequirement(currentLevel = 1) {
	return getSkillNextXpRequirement("combat", currentLevel);
}

export function reconcileCombatLevelForPlayer(player, source = "manual") {
	return reconcileSkillForPlayer("combat", player, source);
}

export function onCombatScoreboardsApplied(player, addsMap) {
	return onCoreSkillScoreboardsApplied("combat", player, addsMap);
}

export function onSkillScoreboardsApplied(player, addsMap) {
	return onCombatScoreboardsApplied(player, addsMap);
}

export function initSkillCombat(userConfig = undefined) {
	if (didInit) return;
	didInit = true;

	const cfg = userConfig && typeof userConfig === "object" ? userConfig : combatSkillConfig;
	initSkillsCore();
	registerSkillDefinition("combat", buildCombatSkillDefinition(cfg));
	initCombatXp(cfg);
	initCombatLoot(cfg);
}
