import { addScore, debugTellBestEffort, getScore, hasHEnabled, isPlayerEntity } from "./damage_dealt/scoreboard.js";
import { subscribeOnMobKilledByPlayer } from "./damage_dealt/byplayer/index.js";
import { combatSkillConfig } from "./config.js";
import { resolveMobMatch, snapshotEntityForMatch } from "./match.js";

let didInit = false;

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function asBool(value) {
	return value === true;
}

function shouldDebug(cfg) {
	return asBool(cfg?.debug?.enabled) && asBool(cfg?.debug?.tellPlayer);
}

function notifyDebug(cfg, player, text) {
	if (!shouldDebug(cfg)) return;
	debugTellBestEffort(player, `[CombatXP] ${String(text)}`);
}

function computeXpFinal(cfg, attacker, baseXp) {
	const xpCfg = cfg?.xp && typeof cfg.xp === "object" ? cfg.xp : {};
	const loreObjective = String(xpCfg?.loreBonusObjective || "ExpCombateTotalH");
	const minBonus = Number.isFinite(Number(xpCfg?.minBonusPercent)) ? Number(xpCfg.minBonusPercent) : -100;
	const maxBonus = Number.isFinite(Number(xpCfg?.maxBonusPercent)) ? Number(xpCfg.maxBonusPercent) : 10000;
	const rawBonus = getScore(attacker, loreObjective, 0);
	const bonusPct = clamp(Number(rawBonus), minBonus, maxBonus);
	const scaled = Number(baseXp) * (1 + bonusPct / 100);
	if (!Number.isFinite(scaled)) return 0;
	return Math.max(0, Math.trunc(scaled));
}

function onMobKilledByPlayer(cfg, attacker, target) {
	if (!attacker || !target) return;
	if (!isPlayerEntity(attacker)) return;
	if (!hasHEnabled(attacker)) return;

	const snapshot = snapshotEntityForMatch(target);
	const match = resolveMobMatch(snapshot, cfg?.mobXp);
	if (!match) {
		notifyDebug(cfg, attacker, `sin match XP para type=${snapshot.typeId} name=${snapshot.nameTag}`);
		return;
	}

	const baseXp = Math.max(0, toInt(match?.baseXp, 0));
	if (baseXp <= 0) return;

	const xpFinal = computeXpFinal(cfg, attacker, baseXp);
	if (xpFinal <= 0) return;

	const xpObjective = String(cfg?.scoreboards?.xp || "SkillXpCombate");
	addScore(attacker, xpObjective, xpFinal);
	notifyDebug(cfg, attacker, `+${xpFinal} XP (base=${baseXp})`);
}

export function initCombatXp(userConfig = undefined) {
	if (didInit) return;
	didInit = true;
	const cfg = userConfig && typeof userConfig === "object" ? userConfig : combatSkillConfig;

	subscribeOnMobKilledByPlayer((attacker, target) => {
		try {
			onMobKilledByPlayer(cfg, attacker, target);
		} catch (e) {
			void e;
		}
	});
}
