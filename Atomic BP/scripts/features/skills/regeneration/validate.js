// Validación de config (modo diagnóstico)
// Responsabilidad: detectar errores típicos de configuración sin romper el runtime.

function isObj(v) {
	return v != null && typeof v === "object";
}

function asStr(v) {
	return String(v != null ? v : "").trim();
}

function asNum(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function isStringArray(v) {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isSoundObj(v) {
	return isObj(v) && typeof v.id === "string";
}

function isSoundObjArray(v) {
	return Array.isArray(v) && v.every((x) => isSoundObj(x));
}

function normalizeAreaId(value) {
	const v = asStr(value);
	return v ? v.toLowerCase() : "";
}

function isFiniteNumber(v) {
	return Number.isFinite(Number(v));
}

function validateScoreboardAddsObject(adds, label, warnings) {
	if (adds == null) return;
	if (!isObj(adds)) {
		warnings.push(`${label}: scoreboardAddsOnBreak debería ser un objeto {OBJ: number}`);
		return;
	}
	for (const [k, v] of Object.entries(adds)) {
		const obj = asStr(k);
		if (!obj) warnings.push(`${label}: scoreboardAddsOnBreak contiene un objetivo vacío`);
		if (!isFiniteNumber(v)) warnings.push(`${label}: scoreboardAddsOnBreak['${obj || "?"}'] debería ser numérico`);
	}
}

function validateModifierRule(rule, label, warnings) {
	if (!isObj(rule)) {
		warnings.push(`${label}: regla inválida (no es objeto)`);
		return;
	}
	const id = asStr(rule.id);
	if (!id) warnings.push(`${label}: id recomendado (si no, se autogenera)`);
	if (rule.priority != null && !isFiniteNumber(rule.priority)) warnings.push(`${label}: priority debería ser numérico`);
	if (rule.mode != null) {
		const mode = asStr(rule.mode).toLowerCase();
		if (mode !== "override" && mode !== "add") warnings.push(`${label}: mode debería ser 'override' o 'add'`);
	}

	if (rule.when != null && !isObj(rule.when)) warnings.push(`${label}: when debería ser objeto`);
	if (isObj(rule.when)) {
		if (rule.when.score != null) {
			if (!isObj(rule.when.score)) warnings.push(`${label}: when.score debería ser objeto`);
			else {
				if (!asStr(rule.when.score.objective)) warnings.push(`${label}: when.score.objective es requerido`);
				const hasRange = isObj(rule.when.score.range) && (rule.when.score.range.min != null || rule.when.score.range.max != null);
				const hasCompare = asStr(rule.when.score.condition) && isFiniteNumber(rule.when.score.value ?? rule.when.score.int);
				if (!hasRange && !hasCompare) warnings.push(`${label}: when.score requiere range o condition+value`);
			}
		}
		if (Array.isArray(rule.when.all) && rule.when.all.length === 0) warnings.push(`${label}: when.all no debería estar vacío`);
		if (Array.isArray(rule.when.any) && rule.when.any.length === 0) warnings.push(`${label}: when.any no debería estar vacío`);
		if (rule.when.not != null && !isObj(rule.when.not)) warnings.push(`${label}: when.not debería ser objeto`);
	}

	const effects = isObj(rule.effects) ? rule.effects : rule;
	if (effects.drops != null && !Array.isArray(effects.drops)) warnings.push(`${label}: effects.drops debería ser array`);
	if (effects.scoreboardAddsOnBreak != null) {
		validateScoreboardAddsObject(effects.scoreboardAddsOnBreak, `${label} effects`, warnings);
	}
	if (effects.xp != null && !isObj(effects.xp)) warnings.push(`${label}: effects.xp debería ser objeto`);
	if (isObj(effects.xp)) {
		if (!isFiniteNumber(effects.xp.base) || Number(effects.xp.base) <= 0) warnings.push(`${label}: effects.xp.base debería ser > 0`);
		if (!asStr(effects.xp.scalingObjective)) warnings.push(`${label}: effects.xp.scalingObjective es requerido`);
		if (effects.xp.gainObjective != null && !asStr(effects.xp.gainObjective)) warnings.push(`${label}: effects.xp.gainObjective inválido`);
		if (effects.xp.levelObjective != null && !asStr(effects.xp.levelObjective)) warnings.push(`${label}: effects.xp.levelObjective inválido`);
		if (effects.xp.stepPerPoints != null && (!isFiniteNumber(effects.xp.stepPerPoints) || Number(effects.xp.stepPerPoints) <= 0)) {
			warnings.push(`${label}: effects.xp.stepPerPoints debería ser > 0`);
		}
	}
	if (effects.title != null && !isObj(effects.title)) warnings.push(`${label}: effects.title debería ser objeto`);
}

function validateSpreadConfig(spread, label, warnings) {
	if (spread == null) return;
	if (!isObj(spread)) {
		warnings.push(`${label}: spread debería ser un objeto`);
		return;
	}
	if (spread.enabled === true && !asStr(spread.objective)) warnings.push(`${label}: spread.objective es requerido cuando spread.enabled=true`);
	if (spread.objective != null && !asStr(spread.objective)) warnings.push(`${label}: spread.objective inválido`);
	if (spread.pointsPerExtra != null && (!isFiniteNumber(spread.pointsPerExtra) || Number(spread.pointsPerExtra) <= 0)) {
		warnings.push(`${label}: spread.pointsPerExtra debería ser > 0`);
	}
	if (spread.maxExtraBlocks != null && (!isFiniteNumber(spread.maxExtraBlocks) || Number(spread.maxExtraBlocks) < 0)) {
		warnings.push(`${label}: spread.maxExtraBlocks debería ser >= 0`);
	}
	if (spread.maxVisitedBlocks != null && (!isFiniteNumber(spread.maxVisitedBlocks) || Number(spread.maxVisitedBlocks) <= 0)) {
		warnings.push(`${label}: spread.maxVisitedBlocks debería ser > 0`);
	}
	if (spread.matchMode != null) {
		const matchMode = asStr(spread.matchMode).toLowerCase();
		if (matchMode && matchMode !== "same-block-type" && matchMode !== "same-definition" && matchMode !== "same-skill") {
			warnings.push(`${label}: spread.matchMode debería ser 'same-block-type', 'same-definition' o 'same-skill'`);
		}
	}
}

/**
 * @param {any} config
 * @returns {{ warnings: string[], errors: string[] }}
 */
export function validateMiningRegenConfig(config) {
	return validateSkillRegenConfig(config);
}

/**
 * Valida la config del sistema de regeneración (global para skills).
 * @param {any} config
 * @returns {{ warnings: string[], errors: string[] }}
 */
export function validateSkillRegenConfig(config) {
	const warnings = [];
	const errors = [];

	if (!isObj(config)) {
		errors.push("Config inválida: se esperaba un objeto");
		return { warnings, errors };
	}

	if (!config.enabled) {
		warnings.push("Config: enabled=false (feature desactivada)");
	}

	// Mode / production
	if (config.mode != null) {
		const m = String(config.mode).toLowerCase();
		if (m !== "dev" && m !== "prod" && m !== "production") warnings.push("Config: mode debería ser 'dev' o 'prod'");
	}

	const tps = asNum(config.ticksPerSecond);
	if (tps == null || tps <= 0) warnings.push("Config: ticksPerSecond inválido, usando fallback en runtime");

	const areas = Array.isArray(config.areas) ? config.areas : [];
	if (areas.length === 0) warnings.push("Config: areas está vacío (no aplicará en ningún lado)");
	const definedAreaIds = new Set();
	for (const [i, a] of areas.entries()) {
		if (!isObj(a)) {
			errors.push(`Area[${i}]: inválida (no es objeto)`);
			continue;
		}
		if (!asStr(a.dimensionId)) errors.push(`Area[${i}]: dimensionId vacío`);
		if (!isObj(a.min) || !isObj(a.max)) errors.push(`Area[${i}]: min/max inválidos`);
		const areaId = normalizeAreaId(a.id ?? a.name);
		if (areaId) definedAreaIds.add(areaId);
	}

	const blocks = Array.isArray(config.blocks) ? config.blocks : [];
	if (blocks.length === 0) warnings.push("Config: blocks está vacío (no hay bloques regenerables registrados)");
	validateSpreadConfig(config?.runtime?.spread, "Config runtime", warnings);
	let usesAreaFilters = false;
	for (const [i, b] of blocks.entries()) {
		if (!isObj(b)) {
			errors.push(`Block[${i}]: inválido (no es objeto)`);
			continue;
		}
		if (!asStr(b.id)) errors.push(`Block[${i}]: id vacío`);
		if (!asStr(b.skill)) errors.push(`Block[${i}] (${asStr(b.id) || "?"}): skill vacío`);
		const blockId = asStr(b.blockId);
		if (!blockId) errors.push(`Block[${i}] (${asStr(b.id) || "?"}): blockId vacío`);
		// '*' soportado (exact/prefix/glob) por registry.js

		// Areas por bloque (opcional)
		if (b.areas != null) {
			usesAreaFilters = true;
			if (typeof b.areas !== "string" && !isStringArray(b.areas)) {
				warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): areas debería ser string o string[]`);
			} else {
				const list = typeof b.areas === "string" ? [b.areas] : b.areas;
				for (const areaName of list) {
					const areaId = normalizeAreaId(areaName);
					if (!areaId) warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): areas contiene un id vacío`);
					if (areaId && areaId !== "*" && !definedAreaIds.has(areaId)) {
						warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): areas refiere a '${areaName}' no definido en config.areas`);
					}
				}
			}
		}

		// Sonidos (opcional)
		if (b.sounds != null) {
			if (!isSoundObjArray(b.sounds)) {
				warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): sounds debería ser Array<{id,volume?,pitch?}>`);
			}
		}

		// XP orbs (opcional)
		if (b.xpOrbs != null) {
			if (!isObj(b.xpOrbs)) {
				warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): xpOrbs debería ser objeto {min,max,chance}`);
			} else {
				if (!isFiniteNumber(b.xpOrbs.min) || !isFiniteNumber(b.xpOrbs.max) || !isFiniteNumber(b.xpOrbs.chance)) {
					warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): xpOrbs min/max/chance deben ser numéricos`);
				} else {
					const chance = Number(b.xpOrbs.chance);
					if (chance < 0 || chance > 100) warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): xpOrbs.chance debe ser 0..100`);
				}
			}
		}

		// Partículas Silk Touch (opcional)
		if (b.particlesOnSilkTouch != null) {
			if (!isObj(b.particlesOnSilkTouch) || typeof b.particlesOnSilkTouch.fn !== "function") {
				warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): particlesOnSilkTouch debería ser { fn: Function, offset?, options? }`);
			}
		}

		// Métricas por-bloque
		if (b.scoreboardAddsOnBreak != null) {
			validateScoreboardAddsObject(b.scoreboardAddsOnBreak, `Block[${i}] (${asStr(b.id) || "?"})`, warnings);
		}
		validateSpreadConfig(b.spread, `Block[${i}] (${asStr(b.id) || "?"})`, warnings);

		// Métricas por-modifier
		if (b.modifiers != null) {
			if (Array.isArray(b.modifiers)) {
				for (let ruleIndex = 0; ruleIndex < b.modifiers.length; ruleIndex++) {
					validateModifierRule(
						b.modifiers[ruleIndex],
						`Block[${i}] (${asStr(b.id) || "?"}) modifiers[${ruleIndex}]`,
						warnings
					);
				}
			} else {
				warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): modifiers debería ser array de reglas`);
			}
		}

		const drops = Array.isArray(b.drops) ? b.drops : [];
		if (drops.length === 0) warnings.push(`Block[${i}] (${asStr(b.id) || "?"}): drops vacío`);
		for (const [j, d] of drops.entries()) {
			if (!Array.isArray(d) || d.length < 5) {
				errors.push(`Block[${i}] drop[${j}]: entry inválido (esperado tuple [dropId,itemId,min,max,chance,...])`);
				continue;
			}
			const itemId = asStr(d[1]);
			if (!itemId) errors.push(`Block[${i}] drop[${j}]: itemId vacío`);
			const minQty = asNum(d[2]);
			const maxQty = asNum(d[3]);
			const chance = asNum(d[4]);
			if (minQty == null || maxQty == null) errors.push(`Block[${i}] drop[${j}]: min/max inválidos`);
			if (chance == null || chance < 0 || chance > 100) errors.push(`Block[${i}] drop[${j}]: chancePct debe ser 0..100`);
		}
	}

	if (usesAreaFilters && definedAreaIds.size === 0) {
		warnings.push("Config: se usan areas por bloque pero no hay ids definidos en config.areas");
	}

	// Métricas (scoreboards)
	if (config.metrics != null) {
		if (!isObj(config.metrics)) {
			warnings.push("Config: metrics debería ser un objeto");
		} else {
			const adds = config.metrics.scoreboardAddsOnBreak;
			if (adds != null && !isObj(adds)) {
				warnings.push("Config: metrics.scoreboardAddsOnBreak debería ser un objeto {OBJ: number}");
			} else if (isObj(adds)) {
				for (const [k, v] of Object.entries(adds)) {
					const obj = asStr(k);
					if (!obj) warnings.push("Config: metrics.scoreboardAddsOnBreak contiene un objetivo vacío");
					if (!isFiniteNumber(v)) warnings.push(`Config: metrics.scoreboardAddsOnBreak['${obj || "?"}'] debería ser numérico`);
				}
			}
		}
	}

	return { warnings, errors };
}
