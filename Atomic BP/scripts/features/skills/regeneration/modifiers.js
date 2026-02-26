// Modifiers resolver scoreboard-driven (modifiers como array).
// Responsabilidad: NO spawnear drops ni tocar bloques; solo decidir qué efectos aplican.

import { world } from "@minecraft/server";
import { isInArea } from "./area.js";

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function safeString(v) {
	return String(v != null ? v : "").trim();
}

function isFiniteNumber(v) {
	return Number.isFinite(Number(v));
}

function toIntOr(v, fallback = 0) {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function getObjectiveCached(objectiveId) {
	const id = safeString(objectiveId);
	if (!id) return null;
	if (objectiveCache.has(id)) {
		const cached = objectiveCache.get(id) ?? null;
		if (cached) return cached;
	}
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
		const raw = obj.getScore(identity);
		if (raw == null) return null;
		const n = Math.trunc(Number(raw));
		return Number.isFinite(n) ? n : null;
	} catch (e) {
		void e;
		return null;
	}
}

function compareInt(lhs, op, rhs) {
	const a = toIntOr(lhs, NaN);
	const b = toIntOr(rhs, NaN);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
	switch (safeString(op)) {
		case "==":
			return a === b;
		case "!=":
			return a !== b;
		case ">=":
			return a >= b;
		case "<=":
			return a <= b;
		case ">":
			return a > b;
		case "<":
			return a < b;
		default:
			return false;
	}
}

function matchesScoreCondition(player, scoreCondition) {
	if (!scoreCondition || typeof scoreCondition !== "object") return false;
	const objective = safeString(scoreCondition.objective);
	if (!objective) return false;

	const lhs = getScoreBestEffort(player, objective);
	if (lhs == null) return false;

	const range = scoreCondition.range;
	if (range && typeof range === "object") {
		if (range.min != null) {
			const min = toIntOr(range.min, NaN);
			if (!Number.isFinite(min)) return false;
			if (lhs < min) return false;
		}
		if (range.max != null) {
			const max = toIntOr(range.max, NaN);
			if (!Number.isFinite(max)) return false;
			if (lhs > max) return false;
		}
		return true;
	}

	const condition = safeString(scoreCondition.condition);
	const rhsValue = scoreCondition.value ?? scoreCondition.int;
	if (!condition || !isFiniteNumber(rhsValue)) return false;
	return compareInt(lhs, condition, rhsValue);
}

function normalizeAreaId(value) {
	const id = safeString(value);
	return id ? id.toLowerCase() : "";
}

function matchesAreaCondition(context, areaCondition) {
	if (!areaCondition || typeof areaCondition !== "object") return false;
	const dimId = safeString(context?.dimensionId);
	const pos = context?.blockPos ?? null;
	if (!dimId || !pos) return false;

	if (areaCondition.id != null) {
		const wanted = normalizeAreaId(areaCondition.id);
		if (!wanted) return false;
		const areas = Array.isArray(context?.areas) ? context.areas : [];
		for (const area of areas) {
			if (!area || typeof area !== "object") continue;
			const areaId = normalizeAreaId(area.id ?? area.name);
			if (!areaId || areaId !== wanted) continue;
			if (isInArea(dimId, pos, area)) return true;
		}
		return false;
	}

	if (areaCondition.aabb && typeof areaCondition.aabb === "object") {
		const aabb = areaCondition.aabb;
		if (!aabb.min || !aabb.max) return false;
		return isInArea(dimId, pos, {
			dimensionId: dimId,
			min: aabb.min,
			max: aabb.max,
		});
	}

	return false;
}

function matchesSkillCondition(blockDef, skillCondition) {
	if (typeof skillCondition === "string") return safeString(blockDef?.skill) === safeString(skillCondition);
	if (!skillCondition || typeof skillCondition !== "object") return false;
	const expected = safeString(skillCondition.equals ?? skillCondition.id ?? "");
	if (!expected) return false;
	return safeString(blockDef?.skill) === expected;
}

function matchesWhenNode(node, context, depth = 0) {
	if (!node || typeof node !== "object") return true;
	if (depth > 3) return false;

	if (node.score != null) return matchesScoreCondition(context?.player, node.score);
	if (node.area != null) return matchesAreaCondition(context, node.area);
	if (node.skill != null) return matchesSkillCondition(context?.blockDef, node.skill);

	if (Array.isArray(node.all)) {
		for (const child of node.all) {
			if (!matchesWhenNode(child, context, depth + 1)) return false;
		}
		return true;
	}

	if (Array.isArray(node.any)) {
		for (const child of node.any) {
			if (matchesWhenNode(child, context, depth + 1)) return true;
		}
		return false;
	}

	if (node.not != null) return !matchesWhenNode(node.not, context, depth + 1);

	return true;
}

function normalizeRuleEffects(rule) {
	const effects = rule?.effects && typeof rule.effects === "object" ? rule.effects : rule;
	const out = {
		drops: Array.isArray(effects?.drops) ? effects.drops : undefined,
		scoreboardAddsOnBreak:
			effects?.scoreboardAddsOnBreak && typeof effects.scoreboardAddsOnBreak === "object" ? effects.scoreboardAddsOnBreak : undefined,
		xp: effects?.xp && typeof effects.xp === "object" ? effects.xp : undefined,
		title: effects?.title && typeof effects.title === "object" ? effects.title : undefined,
	};
	return out;
}
function pickBestScoreboardRule(modifierRules, context) {
	let best = null;
	let bestPriority = -Infinity;

	for (let i = 0; i < modifierRules.length; i++) {
		const rule = modifierRules[i];
		if (!rule || typeof rule !== "object") continue;
		const priority = Number(rule.priority != null ? rule.priority : 0);
		if (!matchesWhenNode(rule.when, context, 0)) continue;

		if (best == null || priority > bestPriority) {
			bestPriority = priority;
			best = {
				key: safeString(rule.id) || `rule_${i}`,
				id: safeString(rule.id) || `rule_${i}`,
				mode: safeString(rule.mode || "override") || "override",
				def: rule,
				effects: normalizeRuleEffects(rule),
				source: "scoreboard-rules",
			};
		}
		// empate de prioridad: orden estable (primer match gana)
	}

	return best;
}

/**
 * Elige el modifier activo según reglas scoreboard-driven.
 *
 * @param {any} oreDef
 * @param {{
 *  player?: any,
 *  blockDef?: any,
 *  dimensionId?: string,
 *  blockPos?: {x:number,y:number,z:number},
 *  areas?: any[],
 * }|undefined} context
 * @returns {{ key: string, id:string, mode:string, def: any, effects:any, source:string } | null}
 */
export function selectActiveModifier(oreDef, contextOrLore) {
	const modifiers = oreDef?.modifiers;
	if (!Array.isArray(modifiers) || modifiers.length === 0) return null;

	const ctx = contextOrLore && typeof contextOrLore === "object" ? contextOrLore : {};
	return pickBestScoreboardRule(modifiers, {
		player: ctx.player,
		blockDef: ctx.blockDef || oreDef,
		dimensionId: ctx.dimensionId,
		blockPos: ctx.blockPos,
		areas: ctx.areas,
	});
}

/**
 * Resuelve la tabla final de drops.
 * - mode=override => reemplaza
 * - mode=add => concatena
 * @param {any} oreDef
 * @param {{def:any}|null} selected
 */
export function resolveDropsTable(oreDef, selected) {
	const base = Array.isArray(oreDef && oreDef.drops) ? oreDef.drops : [];
	if (!selected || !selected.def) return base;

	const mode = safeString(selected.mode || selected.def.mode || "override").toLowerCase() || "override";
	const effects = selected.effects && typeof selected.effects === "object" ? selected.effects : null;
	const modDrops = Array.isArray(effects?.drops)
		? effects.drops
		: Array.isArray(selected.def.drops)
			? selected.def.drops
			: [];

	if (mode === "add") return base.concat(modDrops);
	// Default: override
	return modDrops.length ? modDrops : base;
}

export function getModifierScoreboardAdds(selected) {
	if (!selected || typeof selected !== "object") return null;
	const fromEffects = selected.effects?.scoreboardAddsOnBreak;
	if (fromEffects && typeof fromEffects === "object") return fromEffects;
	const fromDef = selected.def?.scoreboardAddsOnBreak;
	if (fromDef && typeof fromDef === "object") return fromDef;
	return null;
}

export function getModifierXpRule(selected) {
	const xp = selected?.effects?.xp;
	if (!xp || typeof xp !== "object") return null;
	return xp;
}

export function getModifierTitleRule(selected) {
	const title = selected?.effects?.title;
	if (!title || typeof title !== "object") return null;
	return title;
}

// ─── Fortune Tiers: resolución probabilística ───────────────────────────────────
// Algoritmo:
//   1. Leer puntaje de fortuna del jugador (objective configurado).
//   2. tierIndex = floor(fortune / step), acotado a [0, tiers.length - 1].
//   3. remainder = fortune % step.
//   4. Si remainder > 0 Y existe tier siguiente: roll random [0..step).
//      - Si roll < remainder → usar tier siguiente.
//      - Si no → usar tier actual.
//   5. Retornar estructura compatible con selectActiveModifier (key/id/mode/effects/source).
//
// Ejemplo (step=100): fortune=150 → tierIndex=1, remainder=50
//   → 50% tier[2], 50% tier[1].

/**
 * Resuelve un resultado de fortune tiers con probabilidad interpolada.
 * Retorna un objeto compatible con el resultado de selectActiveModifier,
 * o null si no hay fortuneTiers válido.
 *
 * @param {{ objective:string, step:number, tiers:any[] }} fortuneTiers
 * @param {any} player
 * @returns {{ key:string, id:string, mode:string, def:any, effects:any, source:string } | null}
 */
export function resolveFortuneResult(fortuneTiers, player) {
	if (!fortuneTiers || typeof fortuneTiers !== "object") return null;

	const objective = safeString(fortuneTiers.objective);
	const step = toIntOr(fortuneTiers.step, 100);
	const tiers = Array.isArray(fortuneTiers.tiers) ? fortuneTiers.tiers : [];
	if (!objective || step <= 0 || tiers.length === 0) return null;

	// Leer puntaje de fortuna del jugador (clamp >= 0)
	const fortune = Math.max(0, getScoreBestEffort(player, objective) ?? 0);

	// Encontrar tier actual (index por posición, acotado al último tier)
	const maxTierIndex = tiers.length - 1;
	let tierIndex = Math.min(Math.floor(fortune / step), maxTierIndex);
	let selectedTier = tiers[tierIndex];

	// Probabilidad de obtener el tier siguiente
	const remainder = fortune % step;
	if (remainder > 0 && tierIndex < maxTierIndex) {
		const roll = Math.floor(Math.random() * step);
		if (roll < remainder) {
			tierIndex = tierIndex + 1;
			selectedTier = tiers[tierIndex];
		}
	}

	if (!selectedTier || typeof selectedTier !== "object") return null;

	// Construir effects — solo drops y scoreboardAddsOnBreak.
	// XP y title son INDEPENDIENTES de fortuna (se leen del block-level).
	const tierEffects =
		selectedTier.effects && typeof selectedTier.effects === "object" ? selectedTier.effects : null;

	const effects = {};

	// Drops (siempre del tier seleccionado)
	const tierDrops = Array.isArray(selectedTier.drops) ? selectedTier.drops : [];
	if (tierDrops.length) effects.drops = tierDrops;

	// scoreboardAddsOnBreak (solo del tier)
	const sbAdds = tierEffects?.scoreboardAddsOnBreak;
	if (sbAdds && typeof sbAdds === "object") effects.scoreboardAddsOnBreak = sbAdds;

	const tierId = safeString(selectedTier.id) || `fortune_tier_${tierIndex}`;

	return {
		key: tierId,
		id: tierId,
		mode: "override",
		def: selectedTier,
		effects,
		source: "fortune-tiers",
	};
}
