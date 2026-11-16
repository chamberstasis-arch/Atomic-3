import { world } from "@minecraft/server";

function getObjective(id) {
	try {
		return world.scoreboard.getObjective(String(id)) ?? null;
	} catch (e) {
		void e;
		return null;
	}
}

function getScore(player, objectiveId, fallback = 0) {
	try {
		const obj = getObjective(objectiveId);
		const identity = player?.scoreboardIdentity;
		if (!obj || !identity) return fallback;
		const value = obj.getScore(identity);
		const n = Math.trunc(Number(value));
		return Number.isFinite(n) ? n : fallback;
	} catch (e) {
		void e;
		return fallback;
	}
}

function setScore(player, objectiveId, value) {
	try {
		const obj = getObjective(objectiveId);
		const identity = player?.scoreboardIdentity;
		if (!obj || !identity) return false;
		const n = Math.trunc(Number(value));
		if (!Number.isFinite(n)) return false;
		obj.setScore(identity, n);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function handleHeartsMilestone(player, config, totalAchievements) {
	if (!config?.enabled || !player) return false;

	const every = Math.max(1, Math.trunc(Number(config.milestoneEvery ?? 10)));
	const total = Math.trunc(Number(totalAchievements));
	if (!Number.isFinite(total) || total <= 0 || total % every !== 0) return false;

	const objectiveId = String(config.heartsObjective ?? "Corazones").trim();
	if (!objectiveId) return false;

	const maxLevel = Math.max(0, Math.trunc(Number(config.maxHeartsLevel ?? 5)));
	const current = getScore(player, objectiveId, 0);
	if (maxLevel > 0 && current >= maxLevel) return false;

	const next = maxLevel > 0 ? Math.min(maxLevel, current + 1) : current + 1;
	return setScore(player, objectiveId, next);
}
