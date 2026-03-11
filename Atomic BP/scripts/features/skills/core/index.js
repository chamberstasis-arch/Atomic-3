import { system, world } from "@minecraft/server";
import { skillsCoreConfig } from "./config.js";
import {
	getSkillNextXpRequirementForDefinition,
	normalizeSkillDefinition,
	onSkillScoreboardsAppliedForDefinition,
	reconcileSkillForDefinition,
} from "./progression.js";
import { getRegisteredSkillDefinition, listRegisteredSkillDefinitions, setRegisteredSkillDefinition } from "./registry.js";

let didInit = false;
const activeRuntimeSkills = new Set();
let activeConfig = skillsCoreConfig;

function normalizeSkillId(skillId) {
	return String(skillId ?? "").trim().toLowerCase();
}

function debugEnabled() {
	return Boolean(activeConfig?.debug?.enabled && activeConfig?.debug?.console);
}

function debugLog(message) {
	if (!debugEnabled()) return;
	try {
		console.log(`[skills/core] ${String(message ?? "")}`);
	} catch (e) {
		void e;
	}
}

function ensureSkillRuntime(skillId) {
	const id = normalizeSkillId(skillId);
	if (!didInit || !id || activeRuntimeSkills.has(id)) return;
	const definition = getRegisteredSkillDefinition(id);
	if (!definition) return;
	system.runInterval(() => {
		for (const player of world.getAllPlayers()) {
			reconcileSkillForDefinition(definition, player, "interval");
		}
	}, definition.reconcileEveryTicks);
	activeRuntimeSkills.add(id);
	debugLog(`runtime active skill=${id} ticks=${definition.reconcileEveryTicks}`);
}

export function initSkillsCore(userConfig = skillsCoreConfig) {
	if (didInit) return;
	didInit = true;
	activeConfig = userConfig && typeof userConfig === "object" ? userConfig : skillsCoreConfig;

	try {
		world.afterEvents.playerSpawn.subscribe((ev) => {
			if (!ev?.player) return;
			system.run(() => {
				for (const definition of listRegisteredSkillDefinitions()) {
					if (definition.initializeOnJoin === false) continue;
					reconcileSkillForDefinition(definition, ev.player, "spawn");
				}
			});
		});
	} catch (e) {
		void e;
	}

	for (const definition of listRegisteredSkillDefinitions()) {
		ensureSkillRuntime(definition.id);
	}
}

export function registerSkillDefinition(skillId, definition) {
	const normalized = normalizeSkillDefinition(definition, skillId);
	if (!normalized) return null;
	setRegisteredSkillDefinition(normalized.id, normalized);
	ensureSkillRuntime(normalized.id);
	return normalized;
}

export function getSkillDefinition(skillId) {
	return getRegisteredSkillDefinition(skillId);
}

export function getSkillNextXpRequirement(skillId, currentLevel = 1) {
	const definition = getRegisteredSkillDefinition(skillId);
	if (!definition) return null;
	return getSkillNextXpRequirementForDefinition(definition, currentLevel);
}

export function reconcileSkillForPlayer(skillId, player, source = "manual") {
	const definition = getRegisteredSkillDefinition(skillId);
	if (!definition) return false;
	return reconcileSkillForDefinition(definition, player, source);
}

export function onSkillScoreboardsApplied(skillId, player, addsMap) {
	const definition = getRegisteredSkillDefinition(skillId);
	if (!definition) return false;
	return onSkillScoreboardsAppliedForDefinition(definition, player, addsMap);
}