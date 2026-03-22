// Feature: bloques regenerables (global para skills)
// - Event-driven: playerBreakBlock (before)
// - Drops controlados
// - Regeneración con system.runTimeout
// - Persistencia con world dynamic properties

import * as mc from "@minecraft/server";
import { GameMode, system, world } from "@minecraft/server";

import { isInAnyArea } from "./area.js";
import { buildBlockRegistry, getBlockDefinition } from "./registry.js";
import {
	getModifierScoreboardAdds,
	getModifierTitleRule,
	getModifierXpRule,
	resolveDropsTable,
	resolveFortuneResult,
	selectActiveModifier,
} from "./modifiers.js";
import { runDropsTable } from "./drops.js";
import { resolveSpreadTargets } from "./spread.js";
import { validateMiningRegenConfig } from "./validate.js";
import { upsertTemporaryTitle } from "../../../systems/titlesPriority/index.js";
import { getSkillDefinition, getSkillNextXpRequirement, onSkillScoreboardsApplied } from "../core/index.js";
import {
	clearLegacyPendingEntries,
	createGroupPersistenceContext,
	computeRemainingTicks,
	initSkillRegenDynamicProperties,
	loadLegacyPendingEntries,
	loadPersistedGroups,
	makeBlockPendingKey,
	makeGroupId,
	makeGroupScopeId,
	processEntriesInBatches,
	saveScopeGroups,
} from "./persistence.js";

let didInit = false;
const SKILL_GATE_OBJECTIVE = "H";
/** @type {Map<string, { capturedAtMs: number, cropTarget: { id: string, states?: Record<string, any> } }>} */
const cropTrampleSnapshotBySpot = new Map();
/** @type {Map<string, { dimensionId: string, x: number, y: number, z: number, expiresAtMs: number, blockedItemIds: string[] }>} */
const cropTrampleDropSuppressionBySpot = new Map();
/** @type {Map<string, { dimensionId: string, pos: { x: number, y: number, z: number }, updatedAtMs: number }>} */
const cropProtectionLastFootByPlayer = new Map();

function nowMs() {
	return Date.now();
}

function makeKeyFromPos(dimensionId, pos) {
	return makeBlockPendingKey(dimensionId, pos);
}

function debugEnabled(config) {
	if (!config) return false;
	// Switch de producción: fuerza debug OFF
	const mode = String(config.mode != null ? config.mode : "").toLowerCase();
	const production = Boolean(config.production);
	if (production || mode === "prod" || mode === "production") return false;
	return Boolean(config?.debug?.enabled);
}

function debugConsole(config) {
	return Boolean(config?.debug?.console);
}

function debugTellPlayer(config) {
	return Boolean(config?.debug?.tellPlayer);
}

function debugTraceBreak(config) {
	return Boolean(config?.debug?.traceBreak);
}

function metricsEnabled(config) {
	return Boolean(config?.metrics?.enabled);
}

function getPersistenceRetryDelayMs(config) {
	const ms = Number(config?.persistence?.retryDelayMs);
	if (!Number.isFinite(ms) || ms <= 0) return 2000;
	return Math.trunc(ms);
}

function getXpOrbsMaxSpawnPerBreak(config) {
	const cap = Number(config?.runtime?.xpOrbs?.maxSpawnPerBreak);
	if (!Number.isFinite(cap) || cap <= 0) return 25;
	return Math.max(1, Math.trunc(cap));
}

function getParticleTriggerModifierKeys(config) {
	const raw = config?.runtime?.particles?.triggerModifierKeys;
	if (!Array.isArray(raw) || raw.length === 0) return ["silk_touch_1"];
	return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function getTitleDefaults(config) {
	const defaults = config?.runtime?.titles ?? {};
	return {
		enabledByDefault: defaults.enabledByDefault !== false,
		source: String(defaults.source ?? "regen_xp"),
		priority: Number.isFinite(Number(defaults.priority)) ? Number(defaults.priority) : 40,
		durationTicks: Number.isFinite(Number(defaults.durationTicks)) ? Number(defaults.durationTicks) : 40,
		contentTemplate: Array.isArray(defaults.contentTemplate) && defaults.contentTemplate.length > 0 ? defaults.contentTemplate : ["+${xpGain}"],
	};
}

function normalizeSkillId(skill) {
	return String(skill ?? "").trim().toLowerCase();
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function formatThousandsInt(value) {
	const n = toInt(value, 0);
	const sign = n < 0 ? "-" : "";
	const digits = String(Math.abs(n));
	return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getSkillProgressObjectiveIds(config, skill, xpRule) {
	const bySkill = config?.runtime?.titles?.progressObjectivesBySkill;
	const key = normalizeSkillId(skill);
	const runtimeSkill = bySkill && typeof bySkill === "object" ? bySkill[key] : null;
	const coreSkill = getSkillDefinition(key);
	const xpObjective = String(xpRule?.gainObjective ?? runtimeSkill?.xp ?? coreSkill?.xpObjective ?? "").trim();
	const levelObjective = String(xpRule?.levelObjective ?? runtimeSkill?.level ?? coreSkill?.levelObjective ?? "").trim();
	return { xpObjective, levelObjective };
}

function getNoLevelsTitleTemplate(config) {
	const raw = config?.runtime?.titles?.noLevelsContentTemplate;
	if (Array.isArray(raw) && raw.length > 0) return raw;
	return ["+${xpGain} (${xpTotal})"];
}

function buildXpTitlePayload(config, player, blockDef, xpRule, xpGain, options = {}) {
	const skill = normalizeSkillId(blockDef?.skill);
	const gain = Math.max(0, Math.trunc(Number(xpGain?.gain) || 0));
	const objectiveIds = getSkillProgressObjectiveIds(config, skill, xpRule);

	const currentXpRaw = options.currentXpOverride;
	const currentLevelRaw = options.currentLevelOverride;
	const currentXp = Number.isFinite(Number(currentXpRaw))
		? Math.max(0, Math.trunc(Number(currentXpRaw)))
		: (objectiveIds.xpObjective ? (getScoreBestEffort(player, objectiveIds.xpObjective) ?? 0) : 0);
	const currentLevel = Number.isFinite(Number(currentLevelRaw))
		? Math.max(0, Math.trunc(Number(currentLevelRaw)))
		: (objectiveIds.levelObjective ? (getScoreBestEffort(player, objectiveIds.levelObjective) ?? 0) : 0);
	const xpActual = Number.isFinite(Number(currentXpRaw)) ? currentXp : Math.max(0, currentXp + gain);
	const requirementFromCatalog = Number(getSkillNextXpRequirement(skill, currentLevel));
	const hasLevelRequirement = Number.isFinite(requirementFromCatalog) && requirementFromCatalog > 0;
	const xpRequeriment = hasLevelRequirement ? Math.trunc(requirementFromCatalog) : 0;

	return {
		hasLevelRequirement,
		xpGain: formatThousandsInt(gain),
		xpActual: formatThousandsInt(xpActual),
		xpTotal: formatThousandsInt(xpActual),
		xpRequeriment: hasLevelRequirement ? formatThousandsInt(xpRequeriment) : "",
		xpRequirement: hasLevelRequirement ? formatThousandsInt(xpRequeriment) : "",
		skill,
		skillXpObjective: objectiveIds.xpObjective,
		skillLvlObjective: objectiveIds.levelObjective,
	};
}

function resolveXpTitleDescriptor(config, blockDef, selected) {
	const titleRule = getModifierTitleRule(selected)
		?? (blockDef?.xpTitle && typeof blockDef.xpTitle === "object" ? blockDef.xpTitle : null);
	const title = titleRule && typeof titleRule === "object" ? titleRule : {};
	const defaults = getTitleDefaults(config);
	if (titleRule && titleRule.enabled !== true) return null;
	if (!titleRule && !defaults.enabledByDefault) return null;
	return {
		template: title.content ?? defaults.contentTemplate,
		source: String(title.source ?? defaults.source),
		id: String(title.id ?? `xp_${String(blockDef?.skill ?? "unknown")}`),
		priority: Number.isFinite(Number(title.priority)) ? Number(title.priority) : defaults.priority,
		durationTicks: Number.isFinite(Number(title.durationTicks)) ? Number(title.durationTicks) : defaults.durationTicks,
		durationMs: Number.isFinite(Number(title.durationMs)) ? Number(title.durationMs) : undefined,
	};
}

function makeXpTitleBatch() {
	return { entries: new Map() };
}

function accumulateXpTitleBatch(batch, config, player, blockDef, selected, xpRule, xpGain) {
	if (!batch?.entries || !player || !xpGain || xpGain.gain <= 0) return;
	const descriptor = resolveXpTitleDescriptor(config, blockDef, selected);
	if (!descriptor) return;
	const skill = normalizeSkillId(blockDef?.skill);
	const key = `${skill}|${descriptor.source}|${descriptor.id}`;
	const previous = batch.entries.get(key);
	if (previous) {
		previous.totalGain += Math.max(0, Math.trunc(Number(xpGain.gain) || 0));
		previous.blockCount += 1;
		return;
	}
	batch.entries.set(key, {
		config,
		player,
		blockDef,
		xpRule,
		descriptor,
		totalGain: Math.max(0, Math.trunc(Number(xpGain.gain) || 0)),
		blockCount: 1,
	});
}

function flushXpTitleBatch(batch) {
	if (!batch?.entries || batch.entries.size === 0) return;
	for (const entry of batch.entries.values()) {
		const totalGain = Math.max(0, Math.trunc(Number(entry.totalGain) || 0));
		if (totalGain <= 0) continue;
		const skill = normalizeSkillId(entry.blockDef?.skill);
		const objectiveIds = getSkillProgressObjectiveIds(entry.config, skill, entry.xpRule);
		const currentXp = objectiveIds.xpObjective ? (getScoreBestEffort(entry.player, objectiveIds.xpObjective) ?? 0) : 0;
		const currentLevel = objectiveIds.levelObjective ? (getScoreBestEffort(entry.player, objectiveIds.levelObjective) ?? 0) : 0;
		const payload = buildXpTitlePayload(
			entry.config,
			entry.player,
			entry.blockDef,
			entry.xpRule,
			{ gain: totalGain },
			{ currentXpOverride: currentXp, currentLevelOverride: currentLevel }
		);
		const chosenTemplate = payload.hasLevelRequirement ? entry.descriptor.template : getNoLevelsTitleTemplate(entry.config);
		const content = renderTitleContent(chosenTemplate, payload);
		upsertTemporaryTitle({
			target: entry.player,
			source: entry.descriptor.source,
			id: entry.descriptor.id,
			priority: entry.descriptor.priority,
			durationTicks: entry.descriptor.durationTicks,
			durationMs: entry.descriptor.durationMs,
			content,
		});
	}
	batch.entries.clear();
}

function getScoreboardAddsOnBreak(config) {
	const v = config && config.metrics && config.metrics.scoreboardAddsOnBreak;
	return v && typeof v === "object" ? v : null;
}

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

function clampInt32(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(INT32_MIN, Math.min(INT32_MAX, Math.trunc(n)));
}

function applyScoreboardAddsBestEffort(config, dimension, player, addsObj) {
	if (!addsObj || typeof addsObj !== "object") return;
	if (!player) return;

	// Preferir API nativa (no requiere cheats/command permissions)
	const canApi =
		world && world.scoreboard && typeof world.scoreboard.getObjective === "function" && player.scoreboardIdentity != null;

	for (const [objectiveRaw, deltaRaw] of Object.entries(addsObj)) {
		try {
			const objective = String(objectiveRaw != null ? objectiveRaw : "").trim();
			const delta = Number(deltaRaw);
			if (!objective) continue;
			if (!Number.isFinite(delta) || delta === 0) continue;

			if (canApi) {
				let obj = null;
				try {
					obj = world.scoreboard.getObjective(objective) || null;
				} catch (e) {
					void e;
					obj = null;
				}
				if (!obj) {
					// Best-effort: si el objetivo no existe, no hacemos nada.
					if (debugEnabled(config)) dbg(config, `scoreboard: objective '${objective}' no existe (skip)`);
					continue;
				}
				try {
					const current = Number(obj.getScore(player.scoreboardIdentity)) || 0;
					obj.setScore(player.scoreboardIdentity, clampInt32(current + delta));
					continue;
				} catch (e) {
					void e;
					// Si falla API (raro), intentamos fallback a comando.
				}
			}

			// Fallback: comando (puede requerir cheats habilitados)
			if (!dimension || typeof dimension.runCommandAsync !== "function" || !player.name) continue;
			if (!isSafeCommandToken(objective)) {
				if (debugEnabled(config)) dbg(config, `scoreboard: objective '${objective}' inválido para fallback command (skip)`);
				continue;
			}
			const target = quoteForCommand(player.name);
			const cmd = `scoreboard players add ${target} ${objective} ${Math.trunc(delta)}`;
			dimension.runCommandAsync(cmd);
		} catch (e) {
			void e;
		}
	}
}

function mergeScoreboardAdds(a, b) {
	if (!a && !b) return null;
	/** @type {Record<string, number>} */
	const out = {};
	for (const src of [a, b]) {
		if (!src || typeof src !== "object") continue;
		for (const [k, v] of Object.entries(src)) {
			const obj = String(k != null ? k : "").trim();
			const delta = Number(v);
			if (!obj) continue;
			if (!Number.isFinite(delta) || delta === 0) continue;
			out[obj] = Math.trunc((out[obj] || 0) + delta);
		}
	}
	return Object.keys(out).length ? out : null;
}

function getScoreBestEffort(player, objectiveId) {
	try {
		const objective = String(objectiveId ?? "").trim();
		if (!objective) return null;
		const obj = world.scoreboard.getObjective(objective);
		if (!obj) return null;
		const identity = player?.scoreboardIdentity;
		if (!identity) return null;
		const value = obj.getScore(identity);
		if (value == null) return null;
		const n = Math.trunc(Number(value));
		return Number.isFinite(n) ? n : null;
	} catch (e) {
		void e;
		return null;
	}
}

function hasSkillGateEnabled(player) {
	const gate = getScoreBestEffort(player, SKILL_GATE_OBJECTIVE);
	if (gate == null) return false;
	return Number(gate) >= 1;
}

function resolveXpGain(xpRule, player) {
	if (!xpRule || typeof xpRule !== "object") return null;
	const base = Math.trunc(Number(xpRule.base));
	if (!Number.isFinite(base) || base <= 0) return null;

	const per = Math.max(1, Math.trunc(Number(xpRule.stepPerPoints ?? xpRule.perPoints ?? 10) || 10));
	const objective = String(xpRule.scalingObjective ?? "").trim();
	if (!objective) return { gain: base, stat: 0, multiplier: 1 };

	const stat = getScoreBestEffort(player, objective) ?? 0;
	const multiplier = Math.max(1, 1 + Math.trunc(stat / per));
	const gain = Math.max(0, Math.trunc(base * multiplier));
	return { gain, stat, multiplier };
}

function resolveMutationDrops(blockDef, player) {
	const mutation = blockDef?.mutation && typeof blockDef.mutation === "object" ? blockDef.mutation : null;
	if (!mutation || mutation.enabled === false) return null;
	const drops = Array.isArray(mutation.drops) ? mutation.drops : [];
	if (drops.length === 0) return null;

	const objective = String(mutation.objective ?? "").trim();
	const scoreMaxRaw = Number(mutation.scoreMax ?? mutation.maxScore ?? 1000);
	const scoreMax = Number.isFinite(scoreMaxRaw) ? Math.max(1, Math.trunc(scoreMaxRaw)) : 1000;
	const scoreMinRaw = Number(mutation.scoreMin ?? 0);
	const scoreMin = Number.isFinite(scoreMinRaw) ? Math.max(0, Math.trunc(scoreMinRaw)) : 0;

	const score = objective ? (getScoreBestEffort(player, objective) ?? 0) : scoreMax;
	const clampedScore = Math.max(scoreMin, Math.min(scoreMax, Math.trunc(Number(score) || 0)));
	const chance = Math.max(0, Math.min(1, clampedScore / scoreMax));
	if (chance <= 0) return null;
	if (chance < 1 && Math.random() >= chance) return null;

	return drops;
}

function normalizeBlockStatesForRuntime(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const key = String(k != null ? k : "").trim();
		if (!key) continue;
		if (typeof v === "number") {
			if (!Number.isFinite(v)) continue;
			out[key] = Math.trunc(v);
			continue;
		}
		if (typeof v === "string" || typeof v === "boolean") out[key] = v;
	}
	return Object.keys(out).length ? out : null;
}

function resolveBlockTarget(target, fallbackId = "") {
	if (typeof target === "string") {
		const id = String(target).trim();
		return id ? { id, states: null } : null;
	}
	if (!target || typeof target !== "object") return null;
	const id = String(target.id ?? fallbackId ?? "").trim();
	if (!id) return null;
	return {
		id,
		states: normalizeBlockStatesForRuntime(target.states),
	};
}

function getEventBrokenStateValueSafe(ev, stateName) {
	try {
		const state = String(stateName ?? "").trim();
		if (!state) return null;
		const perm = ev?.brokenBlockPermutation;
		if (!perm || typeof perm.getState !== "function") return null;
		return perm.getState(state);
	} catch (e) {
		void e;
		return null;
	}
}

function getBlockStateValueSafe(dimension, pos, stateName) {
	try {
		const state = String(stateName ?? "").trim();
		if (!state) return null;
		const block = dimension.getBlock(pos);
		if (!block?.permutation || typeof block.permutation.getState !== "function") return null;
		return block.permutation.getState(state);
	} catch (e) {
		void e;
		return null;
	}
}

function isStateValueAtLeast(value, min) {
	const current = Number(value);
	const required = Number(min);
	if (!Number.isFinite(current) || !Number.isFinite(required)) return false;
	return current >= required;
}

function isFarmlandType(typeId) {
	const t = String(typeId ?? "").trim().toLowerCase();
	return t === "minecraft:farmland" || t === "minecraft:wet_farmland";
}

function isAirType(typeId) {
	const t = String(typeId ?? "").trim().toLowerCase();
	return t === "minecraft:air" || t === "minecraft:cave_air" || t === "minecraft:void_air";
}

function isLikelyFarmlandTrampleResult(typeId) {
	const t = String(typeId ?? "").trim().toLowerCase();
	return t === "minecraft:dirt" || t === "minecraft:coarse_dirt" || t === "minecraft:rooted_dirt";
}

function normalizeBlockPosFromLocation(loc) {
	if (!loc) return null;
	const x = Number(loc.x);
	const y = Number(loc.y);
	const z = Number(loc.z);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

function getEntityLocationSafe(loc) {
	if (!loc) return null;
	const x = Number(loc.x);
	const y = Number(loc.y);
	const z = Number(loc.z);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	return { x, y, z };
}

function makePlayerRuntimeKey(player) {
	const pid = String(player?.id ?? "").trim();
	if (pid) return pid;
	const name = String(player?.nameTag ?? player?.name ?? "").trim();
	if (name) return `name:${name}`;
	return "";
}

function isSameBlockPos(a, b) {
	if (!a || !b) return false;
	return a.x === b.x && a.y === b.y && a.z === b.z;
}

function buildFootTrailCandidates(currentPos, previousPos) {
	const out = [];
	if (currentPos) out.push(currentPos);
	if (previousPos && !isSameBlockPos(currentPos, previousPos)) {
		out.push(previousPos);
		const dx = Math.abs(Number(currentPos?.x) - Number(previousPos.x));
		const dz = Math.abs(Number(currentPos?.z) - Number(previousPos.z));
		if (Number.isFinite(dx) && Number.isFinite(dz) && (dx > 1 || dz > 1) && dx <= 3 && dz <= 3) {
			out.push({
				x: Math.round((currentPos.x + previousPos.x) / 2),
				y: currentPos.y,
				z: Math.round((currentPos.z + previousPos.z) / 2),
			});
		}
	}
	return out;
}

function getFarmlandPosUnderPlayer(player) {
	const pos = normalizeBlockPosFromLocation(player?.location);
	if (!pos) return null;
	return { x: pos.x, y: pos.y - 1, z: pos.z };
}

function recordCropSnapshotAtSpot(dimension, dimensionId, farmlandPos, cropTypeId) {
	if (!dimension || !farmlandPos || !cropTypeId) return;
	const spotKey = makeKeyFromPos(dimensionId, farmlandPos);
	const cropPos = { x: farmlandPos.x, y: farmlandPos.y + 1, z: farmlandPos.z };
	cropTrampleSnapshotBySpot.set(spotKey, {
		capturedAtMs: nowMs(),
		cropTarget: {
			id: String(cropTypeId),
			states: getBlockStatesSnapshotSafe(dimension, cropPos),
		},
	});
}

function getBlockStatesSnapshotSafe(dimension, pos) {
	try {
		const block = dimension.getBlock(pos);
		const perm = block?.permutation;
		if (!perm || typeof perm.getAllStates !== "function") return undefined;
		return normalizeBlockStatesForRuntime(perm.getAllStates());
	} catch (e) {
		void e;
		return undefined;
	}
}

function getCropProtectionConfig(config) {
	const raw = config?.runtime?.cropProtection;
	const enabled = raw?.enabled !== false;
	const intervalTicks = Math.max(1, Math.trunc(Number(raw?.intervalTicks ?? 1) || 1));
	const restoreDestroyedCrop = raw?.restoreDestroyedCrop !== false;
	const snapshotTtlMs = Math.max(100, Math.trunc(Number(raw?.snapshotTtlMs ?? 1200) || 1200));
	const suppressVanillaDrops = raw?.suppressVanillaDrops !== false;
	const dropSuppressTtlMs = Math.max(100, Math.trunc(Number(raw?.dropSuppressTtlMs ?? 500) || 500));
	const dropSuppressRadius = Math.max(0.5, Number(raw?.dropSuppressRadius ?? 1.2) || 1.2);
	const blockedVanillaItemIds = Array.isArray(raw?.blockedVanillaItemIds)
		? raw.blockedVanillaItemIds.map((v) => String(v ?? "").trim()).filter(Boolean)
		: [];
	const rawAreas = raw?.areaIds ?? raw?.areas;
	const areaIds = Array.isArray(rawAreas)
		? rawAreas.map((v) => normalizeAreaIdForScope(v)).filter(Boolean)
		: (typeof rawAreas === "string" ? [normalizeAreaIdForScope(rawAreas)].filter(Boolean) : []);
	const footTrailTtlMs = Math.max(50, Math.trunc(Number(raw?.footTrailTtlMs ?? 350) || 350));
	return {
		enabled,
		intervalTicks,
		restoreDestroyedCrop,
		snapshotTtlMs,
		suppressVanillaDrops,
		dropSuppressTtlMs,
		dropSuppressRadius,
		blockedVanillaItemIds,
		areaIds,
		footTrailTtlMs,
	};
}

function isInCropProtectionScopeAreas(dimensionId, pos, areas, cropProtection) {
	const allow = Array.isArray(cropProtection?.areaIds) ? cropProtection.areaIds : [];
	if (allow.length === 0 || allow.includes("*")) return true;
	return isInAnyArea(dimensionId, pos, areas, allow);
}

function inferVanillaTrampleDropItemIds(cropBlockId) {
	const id = String(cropBlockId ?? "").trim().toLowerCase();
	if (!id) return [];
	if (id === "minecraft:carrots") return ["minecraft:carrot"];
	if (id === "minecraft:potatoes") return ["minecraft:potato"];
	if (id === "minecraft:wheat") return ["minecraft:wheat", "minecraft:wheat_seeds"];
	if (id === "minecraft:beetroot") return ["minecraft:beetroot", "minecraft:beetroot_seeds"];
	if (id === "minecraft:nether_wart") return ["minecraft:nether_wart"];
	return [];
}

function mergeUniqueLowercase(values) {
	const out = [];
	const seen = new Set();
	for (const v of values) {
		const key = String(v ?? "").trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

function markTrampleDropSuppression(context) {
	const {
		dimensionId,
		farmlandPos,
		cropBlockId,
		cropProtection,
	} = context;
	if (!cropProtection?.suppressVanillaDrops) return;
	const blockedItemIds = mergeUniqueLowercase([
		...inferVanillaTrampleDropItemIds(cropBlockId),
		...(Array.isArray(cropProtection.blockedVanillaItemIds) ? cropProtection.blockedVanillaItemIds : []),
	]);
	if (blockedItemIds.length === 0) return;
	const spotKey = makeKeyFromPos(dimensionId, farmlandPos);
	cropTrampleDropSuppressionBySpot.set(spotKey, {
		dimensionId,
		x: farmlandPos.x + 0.5,
		y: farmlandPos.y + 1,
		z: farmlandPos.z + 0.5,
		expiresAtMs: nowMs() + cropProtection.dropSuppressTtlMs,
		blockedItemIds,
	});
}

function cleanupExpiredCropProtectionState(cropProtection) {
	const now = nowMs();
	for (const [k, v] of cropTrampleSnapshotBySpot.entries()) {
		if (!v || now - Number(v.capturedAtMs) > cropProtection.snapshotTtlMs) {
			cropTrampleSnapshotBySpot.delete(k);
		}
	}
	for (const [k, v] of cropTrampleDropSuppressionBySpot.entries()) {
		if (!v || now > Number(v.expiresAtMs)) {
			cropTrampleDropSuppressionBySpot.delete(k);
		}
	}
}

function getItemEntityStackTypeIdSafe(entity) {
	try {
		if (!entity || String(entity.typeId) !== "minecraft:item") return "";
		const itemComp = entity.getComponent("minecraft:item");
		const typeId = itemComp?.itemStack?.typeId;
		return String(typeId ?? "").trim().toLowerCase();
	} catch (e) {
		void e;
		return "";
	}
}

function trySuppressVanillaTrampleDrop(config, entity) {
	if (!entity || String(entity.typeId) !== "minecraft:item") return false;
	if (cropTrampleDropSuppressionBySpot.size === 0) return false;

	const cropProtection = getCropProtectionConfig(config);
	if (!cropProtection.enabled || !cropProtection.suppressVanillaDrops) return false;

	const itemId = getItemEntityStackTypeIdSafe(entity);
	if (!itemId) return false;

	const pos = getEntityLocationSafe(entity.location);
	const dimId = String(entity.dimension?.id ?? "");
	if (!pos || !dimId) return false;

	const radiusSq = cropProtection.dropSuppressRadius * cropProtection.dropSuppressRadius;
	const maxDy = 1.2;
	const now = nowMs();

	for (const [k, entry] of cropTrampleDropSuppressionBySpot.entries()) {
		if (!entry || now > Number(entry.expiresAtMs)) {
			cropTrampleDropSuppressionBySpot.delete(k);
			continue;
		}
		if (entry.dimensionId !== dimId) continue;
		if (!Array.isArray(entry.blockedItemIds) || !entry.blockedItemIds.includes(itemId)) continue;
		const dx = pos.x - entry.x;
		const dy = pos.y - entry.y;
		const dz = pos.z - entry.z;
		if (Math.abs(dy) > maxDy) continue;
		const distSq = dx * dx + dy * dy + dz * dz;
		if (distSq > radiusSq) continue;
		try {
			entity.remove();
			cropTrampleDropSuppressionBySpot.delete(k);
			if (debugEnabled(config)) dbg(config, `cropProtection: suppressed vanilla drop ${itemId}`);
			return true;
		} catch (e) {
			void e;
		}
	}

	return false;
}

function hasManagedGrowthCycleDefinitions(registry) {
	if (!registry || typeof registry !== "object") return false;
	const exact = registry.exact instanceof Map ? registry.exact : null;
	if (exact) {
		for (const def of exact.values()) {
			if (def?.growthCycle) return true;
		}
	}
	const patterns = Array.isArray(registry.patterns) ? registry.patterns : [];
	for (const def of patterns) {
		if (def?.growthCycle) return true;
	}
	return false;
}

function tryProtectFarmlandSpot(context) {
	const {
		config,
		registry,
		dimension,
		dimensionId,
		farmlandPos,
		areas,
		cropProtection,
	} = context;
	const now = nowMs();
	const spotKey = makeKeyFromPos(dimensionId, farmlandPos);

	const supportType = getBlockTypeIdSafe(dimension, farmlandPos);
	if (!supportType) return false;

	const abovePos = { x: farmlandPos.x, y: farmlandPos.y + 1, z: farmlandPos.z };
	const aboveType = getBlockTypeIdSafe(dimension, abovePos);

	if (aboveType) {
		const managedDef = getBlockDefinition(registry, aboveType);
		if (
			managedDef?.growthCycle
			&& managedDef?.skill === "farming"
			&& isInAnyArea(dimensionId, abovePos, areas, managedDef.areaIds)
			&& isInCropProtectionScopeAreas(dimensionId, abovePos, areas, cropProtection)
		) {
			recordCropSnapshotAtSpot(dimension, dimensionId, farmlandPos, aboveType);

			if (!isFarmlandType(supportType) && isLikelyFarmlandTrampleResult(supportType)) {
				const restored = setBlockTypeSafe(dimension, farmlandPos, "minecraft:farmland");
				if (restored) {
					markTrampleDropSuppression({
						dimensionId,
						farmlandPos,
						cropBlockId: aboveType,
						cropProtection,
					});
				}
				if (restored && debugEnabled(config)) {
					dbg(config, `cropProtection: restored farmland at ${farmlandPos.x},${farmlandPos.y},${farmlandPos.z}`);
				}
				return restored;
			}
			return false;
		}
	}

	if (!isAirType(aboveType) || isFarmlandType(supportType) || !isLikelyFarmlandTrampleResult(supportType)) {
		return false;
	}

	const snapshot = cropTrampleSnapshotBySpot.get(spotKey);
	if (!snapshot) return false;
	if (now - snapshot.capturedAtMs > cropProtection.snapshotTtlMs) {
		cropTrampleSnapshotBySpot.delete(spotKey);
		return false;
	}

	const supportRestored = setBlockTypeSafe(dimension, farmlandPos, "minecraft:farmland");
	if (!supportRestored) return false;

	if (cropProtection.restoreDestroyedCrop) {
		setBlockTypeSafe(dimension, abovePos, snapshot.cropTarget);
	}

	markTrampleDropSuppression({
		dimensionId,
		farmlandPos,
		cropBlockId: snapshot.cropTarget?.id,
		cropProtection,
	});

	cropTrampleSnapshotBySpot.delete(spotKey);
	if (debugEnabled(config)) dbg(config, `cropProtection: recovered trample at ${farmlandPos.x},${farmlandPos.y},${farmlandPos.z}`);
	return true;
}

function runCropProtectionTick(config, registry) {
	const cropProtection = getCropProtectionConfig(config);
	if (!cropProtection.enabled) return;
	const areas = Array.isArray(config?.areas) ? config.areas : [];
	cleanupExpiredCropProtectionState(cropProtection);
	const now = nowMs();
	if (cropProtectionLastFootByPlayer.size > 256) {
		for (const [k, v] of cropProtectionLastFootByPlayer.entries()) {
			if (!v || now - Number(v.updatedAtMs) > cropProtection.footTrailTtlMs * 2) {
				cropProtectionLastFootByPlayer.delete(k);
			}
		}
	}

	for (const player of world.getPlayers()) {
		try {
			if (!player) continue;
			const dim = player.dimension;
			if (!dim) continue;
			const dimensionId = String(dim.id ?? "");
			const playerKey = makePlayerRuntimeKey(player);
			if (!hasSkillGateEnabled(player)) {
				if (playerKey) cropProtectionLastFootByPlayer.delete(playerKey);
				continue;
			}
			const currentFarmlandPos = getFarmlandPosUnderPlayer(player);
			if (!currentFarmlandPos) continue;

			const previousFoot = playerKey ? cropProtectionLastFootByPlayer.get(playerKey) : null;
			const previousFarmlandPos = previousFoot && previousFoot.dimensionId === dimensionId && now - Number(previousFoot.updatedAtMs) <= cropProtection.footTrailTtlMs
				? previousFoot.pos
				: null;

			const candidates = buildFootTrailCandidates(currentFarmlandPos, previousFarmlandPos);
			const seen = new Set();
			for (const farmlandPos of candidates) {
				if (!farmlandPos) continue;
				const key = `${farmlandPos.x}:${farmlandPos.y}:${farmlandPos.z}`;
				if (seen.has(key)) continue;
				seen.add(key);
				tryProtectFarmlandSpot({
					config,
					registry,
					dimension: dim,
					dimensionId,
					farmlandPos,
					areas,
					cropProtection,
				});
			}

			if (playerKey) {
				cropProtectionLastFootByPlayer.set(playerKey, {
					dimensionId,
					pos: currentFarmlandPos,
					updatedAtMs: now,
				});
			}
		} catch (e) {
			void e;
		}
	}
}

function getGrowthCycleTargets(blockDef, originalBlockTypeId) {
	const cycle = blockDef?.growthCycle;
	if (!cycle || typeof cycle !== "object") return null;
	const typeId = String(blockDef?.blockId || originalBlockTypeId || "").trim();
	if (!typeId) return null;
	const stateName = String(cycle.state ?? "growth").trim();
	const matureValue = Math.trunc(Number(cycle.matureValue));
	const seedValue = Math.trunc(Number(cycle.seedValue));
	if (!stateName || !Number.isFinite(matureValue) || !Number.isFinite(seedValue)) return null;
	return {
		stateName,
		matureValue,
		seedValue,
		instantRestoreImmature: cycle.instantRestoreImmature !== false,
		minedTarget: { id: typeId, states: { [stateName]: seedValue } },
		restoreTarget: { id: typeId, states: { [stateName]: matureValue } },
	};
}

function isBlockTargetMatch(dimension, pos, target) {
	try {
		const resolved = resolveBlockTarget(target);
		if (!resolved) return false;
		const block = dimension.getBlock(pos);
		if (!block) return false;
		if (String(block.typeId) !== resolved.id) return false;
		if (!resolved.states) return true;
		if (!block.permutation || typeof block.permutation.getState !== "function") return false;
		for (const [key, expected] of Object.entries(resolved.states)) {
			if (block.permutation.getState(key) !== expected) return false;
		}
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function renderTitleContent(templateLines, payload) {
	const lines = Array.isArray(templateLines) ? templateLines : [String(templateLines ?? "")];
	return lines.map((line) => {
		let out = String(line ?? "");
		for (const [k, v] of Object.entries(payload || {})) {
			out = out.replaceAll("${" + String(k) + "}", String(v));
		}
		return out;
	});
}

function emitXpTitleBestEffort(config, player, blockDef, selected, xpRule, xpGain) {
	if (!player || !xpGain || xpGain.gain <= 0) return;
	const descriptor = resolveXpTitleDescriptor(config, blockDef, selected);
	if (!descriptor) return;
	const payload = buildXpTitlePayload(config, player, blockDef, xpRule, xpGain);
	const chosenTemplate = payload.hasLevelRequirement ? descriptor.template : getNoLevelsTitleTemplate(config);
	const content = renderTitleContent(chosenTemplate, payload);

	upsertTemporaryTitle({
		target: player,
		source: descriptor.source,
		id: descriptor.id,
		priority: descriptor.priority,
		durationTicks: descriptor.durationTicks,
		durationMs: descriptor.durationMs,
		content,
	});
}

function dbg(config, message) {
	if (!debugEnabled(config) || !debugConsole(config)) return;
	try {
		console.log(`[skillRegen] ${String(message != null ? message : "")}`);
	} catch (e) {
		void e;
	}
}

function tell(player, msg) {
	try {
		if (player && typeof player.sendMessage === "function") player.sendMessage(String(msg));
	} catch (e) {
		void e;
	}
}

function getDebugTag(config) {
	const tag = String(config?.debug?.tag ?? "regen").trim();
	return tag || "regen";
}

function toTraceFilterTokenList(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
}

function isTraceTargetBlock(config, blockTypeId, blockDef) {
	const targets = toTraceFilterTokenList(config?.debug?.traceTargets);
	if (targets.length === 0) return true;
	const typeId = String(blockTypeId ?? "").trim().toLowerCase();
	const defId = String(blockDef?.id ?? "").trim().toLowerCase();
	const skillId = String(blockDef?.skill ?? "").trim().toLowerCase();
	for (const target of targets) {
		if (target === "*" || target === typeId) return true;
		if (target.startsWith("skill:") && target.slice(6) === skillId) return true;
		if (target.startsWith("def:") && target.slice(4) === defId) return true;
	}
	return false;
}

function isSafeCommandToken(token) {
	// Token "simple" para usar en comandos sin comillas.
	// Ejemplos esperados: dig.stone, minecraft:block.stone, random.pop
	return /^[0-9A-Za-z_:\.-]+$/.test(String(token != null ? token : ""));
}

function quoteForCommand(value) {
	// Similar a anticheat/commandsRunner.js pero local al feature.
	return `"${String(value).replace(/"/g, "\\\"")}"`;
}

function playMineSoundBestEffort(config, player, dimension, pos, oreDef, traceToPlayer = false) {
	try {
		const sounds = Array.isArray(oreDef && oreDef.sounds) ? oreDef.sounds : [];
		if (sounds.length === 0) return;

		// Ejecutar en el siguiente tick para evitar errores por early_execution.
		system.run(() => {
			const loc = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
			const canPlayer = player && typeof player.playSound === "function";
			const canDim = dimension && typeof dimension.playSound === "function";
			const canCmd = dimension && typeof dimension.runCommandAsync === "function";

			let played = 0;
			let via = canPlayer ? "player.playSound" : canDim ? "dimension.playSound" : canCmd ? "command" : "none";

			for (const s of sounds) {
				try {
					const id = String(s && s.id != null ? s.id : "").trim();
					if (!id || !isSafeCommandToken(id)) continue;
					const volume = Number.isFinite(Number(s && s.volume)) ? Number(s.volume) : 1;
					const pitch = Number.isFinite(Number(s && s.pitch)) ? Number(s.pitch) : 1;
					const volC = Math.max(0, Math.min(4, volume));
					const pitC = Math.max(0, Math.min(2, pitch));

					if (canPlayer) {
						player.playSound(id, { volume: volC, pitch: pitC });
						played++;
						if (debugEnabled(config)) dbg(config, `sound: ok id=${id} via=player v=${volC} p=${pitC}`);
						continue;
					}

					if (canDim) {
						dimension.playSound(id, loc, { volume: volC, pitch: pitC });
						played++;
						if (debugEnabled(config)) dbg(config, `sound: ok id=${id} via=dimension v=${volC} p=${pitC}`);
						continue;
					}

					if (canCmd) {
						const targetByName = player && player.name ? `@a[name=${quoteForCommand(player.name)}]` : null;
						const fallbackTarget = `@p[x=${pos.x},y=${pos.y},z=${pos.z},r=8]`;
						const target = targetByName || fallbackTarget;
						const cmd = `playsound ${id} ${target} ${pos.x} ${pos.y} ${pos.z} ${volC} ${pitC} 0.2`;
						dimension.runCommandAsync(cmd);
						played++;
						if (debugEnabled(config)) dbg(config, `sound: ok id=${id} via=command v=${volC} p=${pitC}`);
					}
				} catch (e) {
					void e;
					if (debugEnabled(config)) dbg(config, "sound: excepción al reproducir un entry");
				}
			}

			if (traceToPlayer && debugTellPlayer(config) && player) {
				tell(player, `§8[${getDebugTag(config)}] sounds=${played}/${sounds.length} via=${via}`);
			}
			if (debugEnabled(config) && played === 0) dbg(config, "sound: no se pudo reproducir ningún sonido");
		});
	} catch (e) {
		void e;
		dbg(config, "sound: excepción inesperada");
	}
}

function buildSpreadBurstSounds(blockDef, spreadConfig) {
	const sounds = Array.isArray(blockDef?.sounds) ? blockDef.sounds : [];
	if (sounds.length === 0) return [];
	const jitter = Number(spreadConfig?.sound?.pitchJitter ?? 0);
	if (!Number.isFinite(jitter) || jitter <= 0) return sounds;
	return sounds.map((sound) => {
		const basePitch = Number.isFinite(Number(sound?.pitch)) ? Number(sound.pitch) : 1;
		const delta = (Math.random() * 2 - 1) * jitter;
		return {
			...sound,
			pitch: Math.max(0, Math.min(2, basePitch + delta)),
		};
	});
}

function playSpreadBurstSoundBestEffort(config, player, dimension, pos, blockDef, spreadConfig) {
	if (!spreadConfig?.sound?.enabled) return;
	const sounds = buildSpreadBurstSounds(blockDef, spreadConfig);
	if (!Array.isArray(sounds) || sounds.length === 0) return;
	playMineSoundBestEffort(config, player, dimension, pos, { ...blockDef, sounds }, false);
}

function rollChancePct(chancePct) {
	const c = Number(chancePct);
	if (!Number.isFinite(c)) return false;
	if (c <= 0) return false;
	if (c >= 100) return true;
	return Math.random() * 100 < c;
}

function rollUniformInt(min, max) {
	const a = Math.floor(Number(min));
	const b = Math.floor(Number(max));
	if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	if (hi <= lo) return Math.max(0, lo);
	return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function spawnXpOrbsBestEffort(config, dimension, blockPos, oreDef) {
	try {
		const xp = oreDef && oreDef.xpOrbs && typeof oreDef.xpOrbs === "object" ? oreDef.xpOrbs : null;
		if (!xp) return;
		if (!rollChancePct(xp.chance)) return;
		let amount = rollUniformInt(xp.min, xp.max);
		if (amount <= 0) return;

		// Cap para evitar spam de entidades si alguien configura valores grandes.
		const cap = getXpOrbsMaxSpawnPerBreak(config);
		if (amount > cap) {
			dbg(config, `xpOrbs cap aplicado: ${amount} -> ${cap}`);
			amount = cap;
		}

		if (!dimension || typeof dimension.spawnEntity !== "function") return;
		const loc = { x: blockPos.x + 0.5, y: blockPos.y + 0.5, z: blockPos.z + 0.5 };
		for (let i = 0; i < amount; i++) {
			try {
				dimension.spawnEntity("minecraft:xp_orb", loc);
			} catch (e) {
				void e;
				// si falla una vez, no spameamos exceptions: cortamos
				break;
			}
		}
	} catch (e) {
		void e;
	}
}

function safeGetDimension(id) {
	try {
		return world.getDimension(id);
	} catch (e) {
		void e;
		return null;
	}
}

function setBlockTypeSafe(dimension, pos, blockTypeIdOrTarget) {
	try {
		const target = resolveBlockTarget(blockTypeIdOrTarget);
		if (!target) return false;
		const block = dimension.getBlock(pos);
		if (!block) return false;

		// Preferir permutation (más estable en varias versiones)
		if (mc?.BlockPermutation?.resolve && typeof block.setPermutation === "function") {
			const perm = mc.BlockPermutation.resolve(target.id, target.states || undefined);
			block.setPermutation(perm);
			return true;
		}

		// Fallback
		if (typeof block.setType === "function") {
			block.setType(target.id);
			return true;
		}
	} catch (e) {
		void e;
	}
	return false;
}

function getBlockTypeIdSafe(dimension, pos) {
	try {
		const b = dimension.getBlock(pos);
		return b && b.typeId ? String(b.typeId) : null;
	} catch (e) {
		void e;
		return null;
	}
}

function getGameModeNameBestEffort(player) {
	try {
		if (player && typeof player.getGameMode === "function") {
			const gm = player.getGameMode();
			return gm != null ? String(gm) : null;
		}
	} catch (e) {
		void e;
	}
	return null;
}

function isCreativeBestEffort(player) {
	try {
		// API moderna
		if (typeof player.getGameMode === "function") {
			const gm = player.getGameMode();
			const gmStr = gm != null ? String(gm).toLowerCase() : "";

			// En 2.4.0 el enum es PascalCase: GameMode.Creative (value: "Creative")
			const creativeEnum = (GameMode && (GameMode.Creative ?? GameMode.creative)) || null;
			if (creativeEnum != null && gm === creativeEnum) return true;
			return gmStr === "creative";
		}
	} catch (e) {
		void e;
	}
	// Si no se puede detectar, asumimos NO-creative para no romper la economía.
	return false;
}

function getGroupingConfig(config) {
	const grouping = config?.runtime?.grouping ?? {};
	return {
		windowMs: Math.max(250, Math.trunc(Number(grouping.windowMs ?? 4000) || 4000)),
		maxMembersPerGroup: Math.max(1, Math.trunc(Number(grouping.maxMembersPerGroup ?? 12) || 12)),
		maxOpenGroupsPerScope: Math.max(1, Math.trunc(Number(grouping.maxOpenGroupsPerScope ?? 40) || 40)),
		maxClosedPendingPerScope: Math.max(0, Math.trunc(Number(grouping.maxClosedPendingPerScope ?? 80) || 80)),
		maxGroupsPerScopeTotal: Math.max(1, Math.trunc(Number(grouping.maxGroupsPerScopeTotal ?? 120) || 120)),
		restoreAllWhenNoPlayers: grouping.restoreAllWhenNoPlayers !== false,
		offlineCheckIntervalTicks: Math.max(1, Math.trunc(Number(grouping.offlineCheckIntervalTicks ?? 100) || 100), 1),
	};
}

function normalizeAreaIdForScope(value) {
	const v = String(value != null ? value : "").trim().toLowerCase();
	if (!v) return "";
	return v.replace(/[^a-z0-9:_\-]/g, "_");
}

function normalizeTokenForScope(value) {
	const v = String(value != null ? value : "").trim().toLowerCase();
	if (!v) return "";
	return v.replace(/[^a-z0-9:_\-]/g, "_");
}

function normalizeAreaAllowList(allowedAreaIds) {
	if (allowedAreaIds == null) return [];
	if (typeof allowedAreaIds === "string") {
		const id = normalizeAreaIdForScope(allowedAreaIds);
		return id ? [id] : [];
	}
	if (!Array.isArray(allowedAreaIds)) return [];
	return allowedAreaIds.map((v) => normalizeAreaIdForScope(v)).filter(Boolean);
}

function resolveAreaIdForPos(dimensionId, pos, areas, allowedAreaIds) {
	if (!Array.isArray(areas) || areas.length === 0) return "";
	const allow = normalizeAreaAllowList(allowedAreaIds);
	const allowAll = allow.length === 0 || allow.includes("*");
	for (const area of areas) {
		if (!area || typeof area !== "object") continue;
		const areaId = normalizeAreaIdForScope(area.id ?? area.name);
		if (!areaId) continue;
		if (!allowAll && !allow.includes(areaId)) continue;
		if (isInAnyArea(dimensionId, pos, [area], undefined)) return areaId;
	}
	return "";
}

function getFamilyIdForScope(blockDef, originalBlockTypeId) {
	const family = String(blockDef?.familyId ?? blockDef?.id ?? originalBlockTypeId ?? "").trim().toLowerCase();
	const normalized = normalizeTokenForScope(family);
	return normalized || "generic";
}

function getOrthogonalNeighborKeys(dimensionId, pos) {
	return [
		makeBlockPendingKey(dimensionId, { x: pos.x + 1, y: pos.y, z: pos.z }),
		makeBlockPendingKey(dimensionId, { x: pos.x - 1, y: pos.y, z: pos.z }),
		makeBlockPendingKey(dimensionId, { x: pos.x, y: pos.y + 1, z: pos.z }),
		makeBlockPendingKey(dimensionId, { x: pos.x, y: pos.y - 1, z: pos.z }),
		makeBlockPendingKey(dimensionId, { x: pos.x, y: pos.y, z: pos.z + 1 }),
		makeBlockPendingKey(dimensionId, { x: pos.x, y: pos.y, z: pos.z - 1 }),
	];
}

function getBlockSafe(dimension, pos) {
	try {
		if (!dimension) return null;
		return dimension.getBlock(pos) || null;
	} catch (e) {
		void e;
		return null;
	}
}

function blockMatchesTarget(block, target) {
	const resolved = resolveBlockTarget(target);
	if (!resolved || !block) return false;
	if (String(block.typeId) !== resolved.id) return false;
	if (!resolved.states) return true;
	if (!block.permutation || typeof block.permutation.getState !== "function") return false;
	for (const [key, expected] of Object.entries(resolved.states)) {
		if (block.permutation.getState(key) !== expected) return false;
	}
	return true;
}

/**
 * Inicializa el sistema.
 * @param {any} userConfig
 */
export function initMiningRegen(userConfig) {
	if (didInit) return;
	didInit = true;

	// Soporte dinámico:
	// - Objeto directo: initMiningRegen(config)
	// - Provider: initMiningRegen(() => configActual)
	const configProvider = typeof userConfig === "function" ? userConfig : () => (userConfig || {});
	let config = configProvider();
	if (!config || !config.enabled) return;

	// Registra DP (best-effort)
	initSkillRegenDynamicProperties(config);

	// Validación (solo diagnóstico)
	try {
		const report = validateMiningRegenConfig(config);
		for (const w of report.warnings) dbg(config, `WARN: ${w}`);
		for (const e of report.errors) dbg(config, `ERROR: ${e}`);
	} catch (e) {
		void e;
	}

	let registry = buildBlockRegistry(config);
	let ticksPerSecond = Number(config.ticksPerSecond != null ? config.ticksPerSecond : 20) || 20;
	let lastConfigRef = config;

	function refreshConfigIfChanged() {
		const next = configProvider();
		if (!next || typeof next !== "object") return;
		// Si el provider devuelve un objeto nuevo, rearmamos el registro.
		if (next !== lastConfigRef) {
			lastConfigRef = next;
			config = next;
			registry = buildBlockRegistry(config);
			ticksPerSecond = Number(config.ticksPerSecond != null ? config.ticksPerSecond : 20) || 20;
			groupingConfig = getGroupingConfig(config);
			persistenceContext = createGroupPersistenceContext(config);
			const blocksCount = Array.isArray(config.blocks)
				? config.blocks.length
				: 0;
			dbg(config, `Config recargada: areas=${Array.isArray(config.areas) ? config.areas.length : 0} blocks=${blocksCount}`);
		}
	}

	let groupingConfig = getGroupingConfig(config);
	let persistenceContext = createGroupPersistenceContext(config);
	const persistRetryTokenByScope = new Map();

	/** @type {Map<string, { groupId: string, scopeId: string }>} */
	const pendingByKey = new Map();
	/** @type {Set<string>} */
	const processingKeys = new Set();
	/** @type {Map<string, any>} */
	const groupsById = new Map();
	/** @type {Map<string, Set<string>>} */
	const groupIdsByScope = new Map();
	/** @type {Map<string, Set<string>>} */
	const openGroupIdsByScope = new Map();

	function ensureScopeSet(map, scopeId) {
		if (!map.has(scopeId)) map.set(scopeId, new Set());
		return map.get(scopeId);
	}

	function addGroupToScopeIndexes(group) {
		ensureScopeSet(groupIdsByScope, group.scopeId).add(group.id);
		if (group.status === "open") ensureScopeSet(openGroupIdsByScope, group.scopeId).add(group.id);
	}

	function removeGroupFromScopeIndexes(group) {
		const all = groupIdsByScope.get(group.scopeId);
		if (all) {
			all.delete(group.id);
			if (all.size === 0) groupIdsByScope.delete(group.scopeId);
		}
		const open = openGroupIdsByScope.get(group.scopeId);
		if (open) {
			open.delete(group.id);
			if (open.size === 0) openGroupIdsByScope.delete(group.scopeId);
		}
	}

	function markGroupOpenState(group, isOpen) {
		const open = ensureScopeSet(openGroupIdsByScope, group.scopeId);
		if (isOpen) open.add(group.id);
		else open.delete(group.id);
		if (open.size === 0) openGroupIdsByScope.delete(group.scopeId);
	}

	function ensureGroupRuntimeFields(group) {
		group.memberKeys = new Set();
		const members = Array.isArray(group.members) ? group.members : [];
		for (const m of members) {
			group.memberKeys.add(makeBlockPendingKey(group.dimensionId, m));
		}
		group.closeToken = Number(group.closeToken || 0);
		group.restoreToken = Number(group.restoreToken || 0);
		group.regenMs = Math.max(1000, Math.trunc(Number(group.regenMs || (group.restoreAt - group.closeAt) || 1000)));
		if (!group.owner || typeof group.owner !== "object") {
			group.owner = { firstPlayerId: "", contributors: 1 };
		}
		group.owner.contributors = Math.max(1, Math.trunc(Number(group.owner.contributors) || 1));
		return group;
	}

	function addGroupToRuntime(groupRaw) {
		const group = ensureGroupRuntimeFields(groupRaw);
		groupsById.set(group.id, group);
		addGroupToScopeIndexes(group);
		for (const memberKey of group.memberKeys) {
			pendingByKey.set(memberKey, { groupId: group.id, scopeId: group.scopeId });
		}
		return group;
	}

	function removeGroupFromRuntime(groupId) {
		const group = groupsById.get(groupId);
		if (!group) return null;
		groupsById.delete(groupId);
		removeGroupFromScopeIndexes(group);
		for (const memberKey of group.memberKeys || []) pendingByKey.delete(memberKey);
		return group;
	}

	function serializeGroup(group) {
		return {
			id: group.id,
			scopeId: group.scopeId,
			dimensionId: group.dimensionId,
			areaId: group.areaId,
			skillId: group.skillId,
			familyId: group.familyId,
			status: group.status,
			createdAt: Math.trunc(Number(group.createdAt) || nowMs()),
			closeAt: Math.trunc(Number(group.closeAt) || nowMs()),
			restoreAt: Math.trunc(Number(group.restoreAt) || nowMs()),
			members: Array.isArray(group.members) ? group.members.map((m) => ({
				x: Math.trunc(Number(m.x) || 0),
				y: Math.trunc(Number(m.y) || 0),
				z: Math.trunc(Number(m.z) || 0),
				blockId: String(m.blockId ?? ""),
				...(m.blockStates ? { blockStates: m.blockStates } : {}),
				minedBlockId: String(m.minedBlockId ?? ""),
				...(m.minedBlockStates ? { minedBlockStates: m.minedBlockStates } : {}),
			})) : [],
			owner: group.owner && typeof group.owner === "object"
				? {
					firstPlayerId: String(group.owner.firstPlayerId ?? ""),
					contributors: Math.max(1, Math.trunc(Number(group.owner.contributors) || 1)),
				}
				: undefined,
		};
	}

	function getScopeGroups(scopeId) {
		const ids = groupIdsByScope.get(scopeId);
		if (!ids || ids.size === 0) return [];
		const out = [];
		for (const id of ids) {
			const g = groupsById.get(id);
			if (g) out.push(g);
		}
		return out;
	}

	function persistScope(scopeId, reason = "") {
		let attempt = 0;
		while (attempt < 2) {
			const groups = getScopeGroups(scopeId).map(serializeGroup);
			const result = saveScopeGroups(persistenceContext, scopeId, groups);
			if (result.ok && result.trimmed <= 0) {
				persistRetryTokenByScope.delete(scopeId);
				return true;
			}
			if (result.trimmed > 0 && attempt === 0) {
				dbg(config, `persistScope(${scopeId}) over-budget trimmed=${result.trimmed}; applying guardrails and retry`);
				enforceScopeGuardrails(scopeId);
				attempt++;
				continue;
			}
			dbg(config, `persistScope(${scopeId}) failed${reason ? ` (${reason})` : ""}`);
			schedulePersistScopeRetry(scopeId, reason || "unknown");
			return false;
		}
		schedulePersistScopeRetry(scopeId, reason || "unknown");
		return false;
	}

	function schedulePersistScopeRetry(scopeId, reason = "") {
		if (!scopeId) return;
		const token = Number(persistRetryTokenByScope.get(scopeId) || 0) + 1;
		persistRetryTokenByScope.set(scopeId, token);
		const retryMs = getPersistenceRetryDelayMs(config);
		const retryTicks = Math.max(20, Math.ceil(retryMs / 50));
		system.runTimeout(() => {
			const currentToken = Number(persistRetryTokenByScope.get(scopeId) || 0);
			if (currentToken !== token) return;
			persistScope(scopeId, `retry:${reason}`);
		}, retryTicks);
	}

	function hydrateGroupsFromPersistence() {
		pendingByKey.clear();
		groupsById.clear();
		groupIdsByScope.clear();
		openGroupIdsByScope.clear();

		const loaded = loadPersistedGroups(persistenceContext);
		for (const loadedGroup of loaded) {
			addGroupToRuntime({
				...loadedGroup,
				status: String(loadedGroup.status || "open").toLowerCase(),
			});
		}
		return loaded.length;
	}

	function restoreLegacyPendingImmediately(reason) {
		const loaded = loadLegacyPendingEntries(config);
		if (!Array.isArray(loaded) || loaded.length === 0) return;
		dbg(config, `${reason}: legacy pending entries=${loaded.length}`);

		processEntriesInBatches(
			config,
			loaded,
			(entry) => {
				const dim = safeGetDimension(entry.dimensionId);
				if (!dim) return;
				const pos = { x: entry.x, y: entry.y, z: entry.z };
				const block = getBlockSafe(dim, pos);
				if (!block) return;
				if (!blockMatchesTarget(block, { id: entry.minedBlockId, states: entry.minedBlockStates })) return;
				setBlockTypeSafe(dim, pos, { id: entry.blockId, states: entry.blockStates });
			},
			() => {
				clearLegacyPendingEntries(config);
			}
		);
	}

	function resolveGroupForBlock(scopeId, dimensionId, blockPos, now) {
		const openIds = openGroupIdsByScope.get(scopeId);
		if (!openIds || openIds.size === 0) return null;
		const neighborKeys = getOrthogonalNeighborKeys(dimensionId, blockPos);
		let best = null;
		for (const groupId of openIds) {
			const group = groupsById.get(groupId);
			if (!group || group.status !== "open") continue;
			if (now > Number(group.closeAt)) continue;
			if ((group.members?.length || 0) >= groupingConfig.maxMembersPerGroup) continue;
			if (!group.memberKeys) continue;
			let adjacent = false;
			for (const nKey of neighborKeys) {
				if (group.memberKeys.has(nKey)) {
					adjacent = true;
					break;
				}
			}
			if (!adjacent) continue;
			if (!best || Number(group.closeAt) > Number(best.closeAt)) best = group;
		}
		return best;
	}

	function scheduleGroupClose(group) {
		if (!group || group.status !== "open") return;
		group.closeToken = Number(group.closeToken || 0) + 1;
		const token = group.closeToken;
		const ticks = computeRemainingTicks({ restoreAt: group.closeAt }, ticksPerSecond);
		system.runTimeout(() => {
			const current = groupsById.get(group.id);
			if (!current || current.status !== "open") return;
			if (current.closeToken !== token) return;
			if (nowMs() < Number(current.closeAt)) {
				scheduleGroupClose(current);
				return;
			}
			current.status = "closed";
			markGroupOpenState(current, false);
			scheduleGroupRestore(current);
			persistScope(current.scopeId, "close");
		}, ticks);
	}

	function scheduleGroupRestore(group) {
		if (!group) return;
		group.restoreToken = Number(group.restoreToken || 0) + 1;
		const token = group.restoreToken;
		const ticks = computeRemainingTicks({ restoreAt: group.restoreAt }, ticksPerSecond);
		system.runTimeout(() => {
			const current = groupsById.get(group.id);
			if (!current) return;
			if (current.restoreToken !== token) return;
			if (nowMs() < Number(current.restoreAt)) {
				scheduleGroupRestore(current);
				return;
			}
			performGroupRestore(current.id, false, "timer");
		}, ticks);
	}

	function performGroupRestore(groupId, force, reason) {
		const group = groupsById.get(groupId);
		if (!group) return false;
		if (!force && group.status === "open") return false;
		if (force && group.status === "open") {
			group.status = "closed";
			markGroupOpenState(group, false);
		}

		const dim = safeGetDimension(group.dimensionId);
		if (!dim) {
			group.status = "restoring";
			group.restoreAt = nowMs() + getPersistenceRetryDelayMs(config);
			scheduleGroupRestore(group);
			persistScope(group.scopeId, `retry_dim_${reason}`);
			return false;
		}

		let unresolved = 0;
		for (const member of group.members || []) {
			const pos = { x: member.x, y: member.y, z: member.z };
			const block = getBlockSafe(dim, pos);
			if (!block) {
				unresolved++;
				continue;
			}

			const minedTarget = { id: member.minedBlockId, states: member.minedBlockStates };
			const restoreTarget = { id: member.blockId, states: member.blockStates };
			if (blockMatchesTarget(block, restoreTarget)) continue;
			if (!blockMatchesTarget(block, minedTarget)) continue;

			const restored = setBlockTypeSafe(dim, pos, restoreTarget);
			if (!restored) unresolved++;
		}

		if (unresolved > 0) {
			group.status = "restoring";
			group.restoreAt = nowMs() + getPersistenceRetryDelayMs(config);
			scheduleGroupRestore(group);
			persistScope(group.scopeId, `retry_chunks_${reason}`);
			return false;
		}

		const removed = removeGroupFromRuntime(group.id);
		if (removed) persistScope(removed.scopeId, `done_${reason}`);
		return true;
	}

	function restoreScopeImmediately(scopeId, reason) {
		const ids = Array.from(groupIdsByScope.get(scopeId) || []);
		for (const groupId of ids) {
			performGroupRestore(groupId, true, reason);
		}
	}

	function restoreAllGroupsImmediately(reason) {
		const ids = Array.from(groupsById.keys());
		if (ids.length === 0) return;
		dbg(config, `${reason}: restoring groups=${ids.length}`);
		processEntriesInBatches(
			config,
			ids,
			(groupId) => {
				performGroupRestore(groupId, true, reason);
			},
			() => {
				dbg(config, `${reason}: restore complete`);
			}
		);
	}

	function enforceScopeGuardrails(scopeId) {
		const groups = getScopeGroups(scopeId);
		if (groups.length === 0) return;

		const open = groups.filter((g) => g.status === "open");
		const closedLike = groups.filter((g) => g.status !== "open");
		const overOpen = open.length - groupingConfig.maxOpenGroupsPerScope;
		const overClosed = closedLike.length - groupingConfig.maxClosedPendingPerScope;
		const overTotal = groups.length - groupingConfig.maxGroupsPerScopeTotal;
		const toDrain = Math.max(0, overOpen, overClosed, overTotal);
		if (toDrain <= 0) return;

		const candidates = groups
			.slice()
			.sort((a, b) => Number(a.closeAt) - Number(b.closeAt));
		for (let i = 0; i < toDrain && i < candidates.length; i++) {
			performGroupRestore(candidates[i].id, true, "guardrail");
		}
	}

	function addBlockToLocalGroup({
		player,
		dimensionId,
		blockPos,
		blockDef,
		originalBlockTypeId,
		resolvedRestoreTarget,
		resolvedMinedTarget,
	}) {
		const areaId = resolveAreaIdForPos(
			dimensionId,
			blockPos,
			Array.isArray(config?.areas) ? config.areas : [],
			blockDef?.areaIds
		);
		if (!areaId) return false;
		const skillId = normalizeTokenForScope(blockDef?.skill);
		if (!skillId) return false;
		const familyId = getFamilyIdForScope(blockDef, originalBlockTypeId);
		const scopeId = makeGroupScopeId({ dimensionId, areaId, skillId, familyId });
		const blockKey = makeKeyFromPos(dimensionId, blockPos);
		if (pendingByKey.has(blockKey)) return false;

		enforceScopeGuardrails(scopeId);

		const now = nowMs();
		const regenMs = Math.max(1000, Math.trunc(Number(blockDef?.regenSeconds || 1) * 1000));
		let group = resolveGroupForBlock(scopeId, dimensionId, blockPos, now);

		if (!group) {
			group = addGroupToRuntime({
				id: makeGroupId(scopeId),
				scopeId,
				dimensionId,
				areaId,
				skillId,
				familyId,
				status: "open",
				createdAt: now,
				closeAt: now + groupingConfig.windowMs,
				restoreAt: now + regenMs,
				regenMs,
				members: [],
				owner: {
					firstPlayerId: makePlayerRuntimeKey(player),
					contributors: 1,
				},
			});
		}

		if (group.status !== "open") return false;
		if ((group.members?.length || 0) >= groupingConfig.maxMembersPerGroup) return false;

		const member = {
			x: blockPos.x,
			y: blockPos.y,
			z: blockPos.z,
			blockId: resolvedRestoreTarget?.id ?? originalBlockTypeId,
			blockStates: resolvedRestoreTarget?.states ?? undefined,
			minedBlockId: resolvedMinedTarget?.id ?? blockDef.minedBlockId,
			minedBlockStates: resolvedMinedTarget?.states ?? undefined,
		};
		const memberKey = makeKeyFromPos(dimensionId, member);
		if (!group.memberKeys.has(memberKey)) {
			group.members.push(member);
			group.memberKeys.add(memberKey);
			pendingByKey.set(memberKey, { groupId: group.id, scopeId });
			const playerKey = makePlayerRuntimeKey(player);
			if (playerKey && group.owner.firstPlayerId !== playerKey) {
				group.owner.contributors = Math.max(1, Number(group.owner.contributors || 1) + 1);
			}
		}

		group.closeAt = now + groupingConfig.windowMs;
		group.restoreAt = now + regenMs;
		group.regenMs = Math.max(group.regenMs || regenMs, regenMs);
		scheduleGroupClose(group);
		persistScope(scopeId, "add_member");
		return true;
	}

	function processResolvedBlockBreak({ player, dim, dimensionId, blockPos, originalBlockTypeId, blockDef, key, isTargetTrace = false, allowSpread = false, minedStatePreApplied = false, selectedOverride = undefined, xpTitleBatch = null }) {
		try {
			if (!config || !config.enabled) return false;
			if (isCreativeBestEffort(player)) return false;
			if (!hasSkillGateEnabled(player)) return false;
			const debugTag = getDebugTag(config);
			const growthTargets = getGrowthCycleTargets(blockDef, originalBlockTypeId);
			const minedTarget = growthTargets?.minedTarget ?? blockDef.minedBlockId;
			const restoreTarget = growthTargets?.restoreTarget ?? originalBlockTypeId;
			const resolvedMinedTarget = resolveBlockTarget(minedTarget);
			const resolvedRestoreTarget = resolveBlockTarget(restoreTarget);
			if (growthTargets) {
				const stateValue = getBlockStateValueSafe(dim, blockPos, growthTargets.stateName);
				const isHarvestReady = isStateValueAtLeast(stateValue, growthTargets.matureValue);
				if (!isHarvestReady) {
					if (growthTargets.instantRestoreImmature) {
						setBlockTypeSafe(dim, blockPos, growthTargets.minedTarget);
					}
					return false;
				}
			}

			const current = getBlockTypeIdSafe(dim, blockPos);
			if (minedStatePreApplied) {
				if (!isBlockTargetMatch(dim, blockPos, minedTarget)) {
					const recovered = current === originalBlockTypeId
						? setBlockTypeSafe(dim, blockPos, minedTarget)
						: false;
					if (!recovered) {
						if (isTargetTrace) tell(player, `§c[${debugTag}] abort: bloque cambió (${current})`);
						return false;
					}
				}
			} else {
				if (current !== originalBlockTypeId) {
					if (isTargetTrace) tell(player, `§c[${debugTag}] abort: bloque cambió (${current})`);
					return false;
				}

				const didSetMinedState = setBlockTypeSafe(dim, blockPos, minedTarget);
				if (!didSetMinedState) {
					dbg(config, `No se pudo setear minedState en ${key}`);
					if (isTargetTrace) tell(player, `§c[${debugTag}] mined-state FAIL (no se puede aplicar)`);
					return false;
				}
			}
			if (isTargetTrace) tell(player, `§a[${debugTag}] mined-state=ok`);

			let selected = selectedOverride;
			if (!selected) {
				selected = selectActiveModifier(blockDef, {
					player,
					blockDef,
					dimensionId,
					blockPos,
					areas: Array.isArray(config?.areas) ? config.areas : [],
				});

				if (!selected && blockDef.fortuneTiers) {
					selected = resolveFortuneResult(blockDef.fortuneTiers, player);
				}
			}

			const dropsTable = resolveDropsTable(blockDef, selected);
			const mutationDrops = resolveMutationDrops(blockDef, player);
			const finalDropsTable = Array.isArray(mutationDrops) && mutationDrops.length > 0
				? [...dropsTable, ...mutationDrops]
				: dropsTable;

			try {
				const triggerKeys = getParticleTriggerModifierKeys(config);
				if (selected && triggerKeys.includes(String(selected.key))) {
					const p = blockDef && blockDef.particlesOnSilkTouch && typeof blockDef.particlesOnSilkTouch === "object" ? blockDef.particlesOnSilkTouch : null;
					if (p && typeof p.fn === "function") {
						const off = p.offset || { x: 0.5, y: 0.5, z: 0.5 };
						p.fn(dim, { x: blockPos.x + off.x, y: blockPos.y + off.y, z: blockPos.z + off.z }, p.options);
					}
				}
			} catch (e) {
				void e;
			}

			const grouped = addBlockToLocalGroup({
				player,
				dimensionId,
				blockPos,
				blockDef,
				originalBlockTypeId,
				resolvedRestoreTarget,
				resolvedMinedTarget,
			});
			if (!grouped) {
				setBlockTypeSafe(dim, blockPos, { id: resolvedRestoreTarget?.id ?? originalBlockTypeId, states: resolvedRestoreTarget?.states });
				return false;
			}

			const spawned = runDropsTable(dim, blockPos, finalDropsTable);
			spawnXpOrbsBestEffort(config, dim, blockPos, blockDef);
			if (debugTellPlayer(config)) tell(player, `§7[${debugTag}] drops=${spawned} skill=${blockDef.skill} regen=${blockDef.regenSeconds}s`);

			const globalAdds = metricsEnabled(config) ? getScoreboardAddsOnBreak(config) : null;
			const blockAdds = blockDef && blockDef.scoreboardAddsOnBreak && typeof blockDef.scoreboardAddsOnBreak === "object" ? blockDef.scoreboardAddsOnBreak : null;
			const modifierAdds = getModifierScoreboardAdds(selected);

			let xpAdds = null;
			const xpRule = getModifierXpRule(selected)
				?? (blockDef?.xp && typeof blockDef.xp === "object" ? blockDef.xp : null);
			const xpGain = resolveXpGain(xpRule, player);
			if (xpRule && xpGain && xpGain.gain > 0) {
				const gainObjective = String(xpRule.gainObjective ?? "").trim();
				if (gainObjective) xpAdds = { [gainObjective]: xpGain.gain };
				if (xpTitleBatch) accumulateXpTitleBatch(xpTitleBatch, config, player, blockDef, selected, xpRule, xpGain);
				else emitXpTitleBestEffort(config, player, blockDef, selected, xpRule, xpGain);
			}

			const merged = mergeScoreboardAdds(mergeScoreboardAdds(mergeScoreboardAdds(globalAdds, blockAdds), modifierAdds), xpAdds);
			if (merged) {
				applyScoreboardAddsBestEffort(config, dim, player, merged);
				onSkillScoreboardsApplied(normalizeSkillId(blockDef?.skill), player, merged);
			}

			if (allowSpread) {
				const spreadPlan = resolveSpreadTargets({
					player,
					dimension: dim,
					dimensionId,
					originPos: blockPos,
					originBlockTypeId: originalBlockTypeId,
					blockDef,
					registry,
					areas: Array.isArray(config?.areas) ? config.areas : [],
					spreadDefaults: config?.runtime?.spread,
					pendingByKey,
					processingKeys,
					getScoreBestEffort,
					getBlockTypeIdSafe,
					makeKeyFromPos,
					isInAnyArea,
					getBlockDefinition,
				});
				const spreadTargets = Array.isArray(spreadPlan?.targets) ? spreadPlan.targets : [];
				const spreadConfig = spreadPlan?.spread && typeof spreadPlan.spread === "object" ? spreadPlan.spread : null;

				for (const target of spreadTargets) {
					playSpreadBurstSoundBestEffort(config, player, dim, target.pos, target.blockDef, spreadConfig);
					processingKeys.add(target.key);
					processResolvedBlockBreak({
						player,
						dim,
						dimensionId,
						blockPos: target.pos,
						originalBlockTypeId: target.blockTypeId,
						blockDef: target.blockDef,
						key: target.key,
						allowSpread: false,
						selectedOverride: selected,
						xpTitleBatch,
					});
				}
			}

			return true;
		} finally {
			processingKeys.delete(key);
		}
	}

	function maybeRestoreAllIfNoPlayers(reason) {
		if (!groupingConfig.restoreAllWhenNoPlayers) return;
		let players = [];
		try {
			players = Array.from(world.getPlayers());
		} catch (e) {
			void e;
			players = [];
		}
		if (players.length > 0) return;
		restoreAllGroupsImmediately(reason);
	}

	function bootstrapFromPersistence(reason) {
		try {
			const loaded = hydrateGroupsFromPersistence();
			dbg(config, `${reason}: hydrated groups=${loaded}`);
			restoreAllGroupsImmediately(reason);
			restoreLegacyPendingImmediately(`${reason}:legacy`);
		} catch (e) {
			void e;
		}
	}

	system.run(() => bootstrapFromPersistence("boot"));

	try {
		world?.afterEvents?.worldLoad?.subscribe?.(() => {
			system.run(() => bootstrapFromPersistence("worldLoad"));
		});
	} catch (e) {
		void e;
	}

	try {
		world?.afterEvents?.playerLeave?.subscribe?.((ev) => {
			system.run(() => {
				maybeRestoreAllIfNoPlayers("allPlayersLeft");
				// Limpiar datos de crop protection del jugador saliente.
				try {
					const pid = String(ev?.playerId ?? "").trim();
					if (pid) cropProtectionLastFootByPlayer.delete(pid);
				} catch (e) { void e; }
			});
		});
	} catch (e) {
		void e;
	}

	system.runInterval(() => {
		try {
			maybeRestoreAllIfNoPlayers("offlineCheck");
		} catch (e) {
			void e;
		}
	}, groupingConfig.offlineCheckIntervalTicks);

	// Anti-grief de cultivos: restaura soporte de farmland en spots gestionados
	// con costo acotado (solo revisa columna bajo cada jugador).
	const cropProtection = getCropProtectionConfig(config);
	if (cropProtection.enabled && hasManagedGrowthCycleDefinitions(registry)) {
		try {
			world?.afterEvents?.entitySpawn?.subscribe?.((ev) => {
				try {
					trySuppressVanillaTrampleDrop(config, ev?.entity);
				} catch (e) {
					void e;
				}
			});
		} catch (e) {
			void e;
		}

		system.runInterval(() => {
			try {
				runCropProtectionTick(config, registry);
			} catch (e) {
				void e;
			}
		}, cropProtection.intervalTicks);
	}

	// Evento principal: intercepta minado
	world.beforeEvents.playerBreakBlock.subscribe((ev) => {
		try {
			// Permite cambios dinámicos en config sin reiniciar script.
			refreshConfigIfChanged();
			if (!config || !config.enabled) return;

			if (!ev || !ev.block || !ev.player) return;
			const player = ev.player;
			const dim = ev.dimension;
			if (!dim) return;
			const debugTag = getDebugTag(config);
			const traceEnabled = debugTellPlayer(config) && debugTraceBreak(config);

			// Traza gamemode (solo si está en modo trace)
			if (traceEnabled) {
				const gmName = getGameModeNameBestEffort(player);
				if (gmName) tell(player, `§8[${debugTag}] gm=${gmName}`);
			}

			// Bypass Creative
			if (isCreativeBestEffort(player)) return;

			// Gate de skills: todo el sistema de regeneración/progresión requiere H >= 1.
			if (!hasSkillGateEnabled(player)) {
				if (traceEnabled) tell(player, `§c[${debugTag}] gate H<1 (skip)`);
				return;
			}

			const block = ev.block;
			const blockPos = block.location;
			const dimensionId = String(dim.id != null ? dim.id : "");

			// Traza de prueba: confirmar que el evento corre y qué datos entrega.
			if (traceEnabled) {
				tell(player, `§8[${debugTag}] dim=${dimensionId} block=${block.typeId} @ ${blockPos.x},${blockPos.y},${blockPos.z}`);
			}

			if (traceEnabled) {
				const areasCount = Array.isArray(config.areas) ? config.areas.length : 0;
				const blocksCount = Array.isArray(config.blocks)
					? config.blocks.length
					: 0;
				tell(player, `§8[${debugTag}] cfg areas=${areasCount} blocks=${blocksCount}`);
			}

			const blockDef = getBlockDefinition(registry, block.typeId);
			const isTargetTrace = traceEnabled && isTraceTargetBlock(config, block.typeId, blockDef);
			if (!blockDef) {
				if (isTargetTrace) tell(player, `§c[${debugTag}] bloque NO registrado en config`);
				return;
			}

			// Validación de área (soporta áreas dinámicas por bloque)
			const inArea = isInAnyArea(dimensionId, blockPos, config.areas, blockDef.areaIds);
			if (!inArea) {
				if (isTargetTrace) tell(player, `§c[${debugTag}] fuera de area (no aplica)`);
				return;
			}
			if (isTargetTrace) tell(player, `§a[${debugTag}] area=ok`);
			if (isTargetTrace) tell(player, `§a[${debugTag}] block=ok skill=${blockDef.skill} regen=${blockDef.regenSeconds}s mined=${blockDef.minedBlockId}`);

			// Sembrar snapshot anti-trample desde el evento de break para cubrir sprint/break rápido
			// sin depender de que el jugador siga parado exactamente encima del cultivo.
			const cropProtection = getCropProtectionConfig(config);
			if (
				blockDef.growthCycle
				&& blockDef.skill === "farming"
				&& isInCropProtectionScopeAreas(dimensionId, blockPos, Array.isArray(config?.areas) ? config.areas : [], cropProtection)
			) {
				const farmlandPos = { x: blockPos.x, y: blockPos.y - 1, z: blockPos.z };
				recordCropSnapshotAtSpot(dim, dimensionId, farmlandPos, block.typeId);
			}

			// Cancelar lo antes posible para minimizar artefactos visuales del break vanilla
			// en bloques gestionados por regeneration.
			ev.cancel = true;

			const key = makeKeyFromPos(dimensionId, blockPos);
			const originalBlockTypeId = String(block.typeId != null ? block.typeId : "");

			// Si ya está pendiente, cancelamos el break para evitar drops vanilla, duplicación
			// y cualquier sobrescritura visual de estados temporales del cultivo.
			if (pendingByKey.has(key) || processingKeys.has(key)) {
				if (isTargetTrace) tell(player, `§e[${debugTag}] ya pendiente => cancel`);
				return;
			}

			const growthTargets = getGrowthCycleTargets(blockDef, originalBlockTypeId);
			if (growthTargets) {
				const stateValueFromEvent = getEventBrokenStateValueSafe(ev, growthTargets.stateName);
				const stateValue = stateValueFromEvent != null
					? stateValueFromEvent
					: getBlockStateValueSafe(dim, blockPos, growthTargets.stateName);
				const isHarvestReady = isStateValueAtLeast(stateValue, growthTargets.matureValue);
				if (!isHarvestReady) {
					if (growthTargets.instantRestoreImmature) {
						const appliedNow = setBlockTypeSafe(dim, blockPos, growthTargets.minedTarget);
						if (!appliedNow) {
							system.run(() => {
								setBlockTypeSafe(dim, blockPos, growthTargets.minedTarget);
							});
						}
					}
					return;
				}
			}

			// Cancelar el break vanilla (evita drops vanilla)
			if (isTargetTrace) tell(player, `§a[${debugTag}] cancel=true (procesando next tick)`);

			// Importante (2.4.0 stable): en early_execution, cambiar bloques puede fallar.
			// Por eso, hacemos el procesamiento en el siguiente tick.
			// Reservamos la key solo como "en procesamiento" para evitar spam/duplicación por mantener click.
			processingKeys.add(key);

			// Sonido inmediato (antes del set mined-state), para que suene al instante.
			// En modo trace, mostramos qué ruta se usó.
			playMineSoundBestEffort(config, player, dim, blockPos, blockDef, isTargetTrace);

			// Mitigación visual/física: intentamos reemplazar el bloque en este mismo before-event.
			// Si la API/versión no lo permite, el procesamiento diferido mantiene el fallback actual.
			const minedTargetPre = growthTargets?.minedTarget ?? blockDef.minedBlockId;
			const minedStatePreApplied = setBlockTypeSafe(dim, blockPos, minedTargetPre);
			if (isTargetTrace && minedStatePreApplied) tell(player, `§a[${debugTag}] mined-state preapply=ok`);

			system.run(() => {
				const xpTitleBatch = makeXpTitleBatch();
				try {
					processResolvedBlockBreak({
						player,
						dim,
						dimensionId,
						blockPos,
						originalBlockTypeId,
						blockDef,
						key,
						isTargetTrace,
						allowSpread: true,
						minedStatePreApplied,
						xpTitleBatch,
					});
				} catch (e) {
					void e;
				} finally {
					flushXpTitleBatch(xpTitleBatch);
				}
			});
		} catch (e) {
			void e;
			// No hacemos throw para no romper el servidor.
		}
	});
}

// API nueva (nombre coherente): main.js usa esta.
export function initSkillRegeneration(userConfig) {
	return initMiningRegen(userConfig);
}
