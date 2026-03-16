// Registro de bloques por skill
// Responsabilidad: resolver blockTypeId -> definición normalizada (exact/prefix/any).

function toNumberOr(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}

function normalizeString(value) {
	return String(value != null ? value : "").trim();
}

function normalizeSkill(value) {
	const s = normalizeString(value);
	return s ? s.toLowerCase() : "";
}

function normalizeBlockMatch(value) {
	const raw = normalizeString(value);
	if (!raw) return null;
	if (raw === "*") return { kind: "any", value: "*" };
	const hasStar = raw.includes("*");
	if (hasStar) {
		// Caso simple: prefijo*
		if (raw.endsWith("*") && raw.indexOf("*") === raw.length - 1) {
			const prefix = raw.slice(0, -1);
			return { kind: "prefix", value: prefix };
		}
		// Caso general: glob con '*' en cualquier posición (ej: "minecraft:*_log")
		return { kind: "glob", value: raw, regex: compileGlobToRegExp(raw) };
	}
	return { kind: "exact", value: raw };
}

function compileGlobToRegExp(glob) {
	const src = String(glob != null ? glob : "");
	// Escapa todo excepto '*', luego lo convierte a '.*'
	const parts = src.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
	const pattern = `^${parts.join(".*")}$`;
	try {
		return new RegExp(pattern);
	} catch (e) {
		void e;
		// Fallback: si el patrón es inválido, forzamos no-match.
		return /^$/;
	}
}

function normalizeSoundEntry(value) {
	if (value && typeof value === "object") {
		const id = normalizeString(value.id);
		if (!id) return null;
		const volumeRaw = value.volume;
		const pitchRaw = value.pitch;
		const volume = Number.isFinite(Number(volumeRaw)) ? clamp(Number(volumeRaw), 0, 4) : 1;
		const pitch = Number.isFinite(Number(pitchRaw)) ? clamp(Number(pitchRaw), 0, 2) : 1;
		return { id, volume, pitch };
	}

	return null;
}

function normalizeSoundsList(value) {
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.map(normalizeSoundEntry).filter((v) => v && v.id);
	}
	return [];
}

function normalizeAreaId(value) {
	const v = String(value != null ? value : "").trim();
	return v ? v.toLowerCase() : "";
}

function normalizeAreaIds(value) {
	if (value == null) return [];
	if (typeof value === "string") {
		const id = normalizeAreaId(value);
		return id ? [id] : [];
	}
	if (Array.isArray(value)) {
		return value.map(normalizeAreaId).filter(Boolean);
	}
	return [];
}

function normalizeXpOrbs(value) {
	if (!value || typeof value !== "object") return null;
	const min = Number(value.min);
	const max = Number(value.max);
	const chance = Number(value.chance);

	if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(chance)) return null;
	const minC = clamp(Math.floor(min), 0, 100000);
	const maxC = clamp(Math.floor(max), 0, 100000);
	const chanceC = clamp(chance, 0, 100);
	return {
		min: Math.min(minC, maxC),
		max: Math.max(minC, maxC),
		chance: chanceC,
	};
}

function normalizeVec3(value, fallback) {
	if (!value || typeof value !== "object") return fallback;
	const x = Number(value.x);
	const y = Number(value.y);
	const z = Number(value.z);
	return {
		x: Number.isFinite(x) ? x : fallback.x,
		y: Number.isFinite(y) ? y : fallback.y,
		z: Number.isFinite(z) ? z : fallback.z,
	};
}

function normalizeParticlesOnSilkTouch(value) {
	if (!value || typeof value !== "object") return null;
	const fn = value.fn;
	if (typeof fn !== "function") return null;
	return {
		fn,
		offset: normalizeVec3(value.offset, { x: 0.5, y: 0.5, z: 0.5 }),
		options: value.options,
	};
}

function normalizeScoreboardAdds(value) {
	if (!value || typeof value !== "object") return null;
	/** @type {Record<string, number>} */
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const obj = String(k != null ? k : "").trim();
		const delta = Number(v);
		if (!obj) continue;
		if (!Number.isFinite(delta) || delta === 0) continue;
		out[obj] = Math.trunc(delta);
	}
	return Object.keys(out).length ? out : null;
}

function normalizeBlockStates(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const key = normalizeString(k);
		if (!key) continue;
		if (typeof v === "number") {
			if (!Number.isFinite(v)) continue;
			out[key] = Math.trunc(v);
			continue;
		}
		if (typeof v === "string" || typeof v === "boolean") {
			out[key] = v;
			continue;
		}
	}
	return Object.keys(out).length ? out : null;
}

function normalizeGrowthCycle(value) {
	if (!value || typeof value !== "object") return undefined;
	if (value.enabled === false) return undefined;
	const state = normalizeString(value.state ?? value.stateName ?? "growth");
	if (!state) return undefined;
	const matureValue = toNumberOr(value.matureValue ?? value.harvestValue, NaN);
	const seedValue = toNumberOr(value.seedValue ?? value.initialValue, NaN);
	if (!Number.isFinite(matureValue) || !Number.isFinite(seedValue)) return undefined;
	return {
		state,
		matureValue: Math.trunc(matureValue),
		seedValue: Math.trunc(seedValue),
		instantRestoreImmature: value.instantRestoreImmature !== false,
	};
}

function normalizeMutation(value) {
	if (!value || typeof value !== "object") return undefined;
	if (value.enabled === false) return undefined;
	const objective = normalizeString(value.objective);
	const scoreMin = Math.max(0, Math.trunc(toNumberOr(value.scoreMin, 0)));
	const scoreMax = Math.max(1, Math.trunc(toNumberOr(value.scoreMax ?? value.maxScore, 1000)));
	const drops = Array.isArray(value.drops) ? value.drops : [];
	if (!objective || drops.length === 0) return undefined;
	return {
		enabled: true,
		objective,
		scoreMin,
		scoreMax,
		drops,
	};
}

function normalizeWhenTree(node) {
	if (!node || typeof node !== "object") return undefined;
	const out = {};

	if (node.score && typeof node.score === "object") {
		const score = {};
		const objective = normalizeString(node.score.objective);
		if (objective) score.objective = objective;
		if (node.score.range && typeof node.score.range === "object") {
			const range = {};
			if (Number.isFinite(Number(node.score.range.min))) range.min = Math.trunc(Number(node.score.range.min));
			if (Number.isFinite(Number(node.score.range.max))) range.max = Math.trunc(Number(node.score.range.max));
			if (Object.keys(range).length) score.range = range;
		}
		if (node.score.condition != null) score.condition = normalizeString(node.score.condition);
		if (Number.isFinite(Number(node.score.value))) score.value = Math.trunc(Number(node.score.value));
		if (Number.isFinite(Number(node.score.int))) score.int = Math.trunc(Number(node.score.int));
		if (Object.keys(score).length) out.score = score;
	}

	if (node.area && typeof node.area === "object") {
		const area = {};
		const id = normalizeString(node.area.id);
		if (id) area.id = id;
		if (node.area.aabb && typeof node.area.aabb === "object") {
			const min = node.area.aabb.min;
			const max = node.area.aabb.max;
			if (min && max) area.aabb = { min, max };
		}
		if (Object.keys(area).length) out.area = area;
	}

	if (node.skill != null) {
		if (typeof node.skill === "string") out.skill = normalizeString(node.skill);
		else if (node.skill && typeof node.skill === "object") {
			const s = normalizeString(node.skill.equals ?? node.skill.id);
			if (s) out.skill = { equals: s };
		}
	}

	if (Array.isArray(node.all)) out.all = node.all.map(normalizeWhenTree).filter(Boolean);
	if (Array.isArray(node.all) && out.all.length === 0) return undefined;
	if (Array.isArray(node.any)) out.any = node.any.map(normalizeWhenTree).filter(Boolean);
	if (Array.isArray(node.any) && out.any.length === 0) return undefined;
	if (node.not && typeof node.not === "object") out.not = normalizeWhenTree(node.not);
	if (node.not && !out.not) return undefined;

	return Object.keys(out).length ? out : undefined;
}

function normalizeModifierRuleEntry(value, index = 0) {
	if (!value || typeof value !== "object") return null;
	const id = normalizeString(value.id) || `rule_${index}`;
	const priority = Number.isFinite(Number(value.priority)) ? Number(value.priority) : 0;
	const modeRaw = String(value.mode != null ? value.mode : "override").toLowerCase();
	const mode = modeRaw === "add" ? "add" : "override";

	const effectsSrc = value.effects && typeof value.effects === "object" ? value.effects : value;
	const effects = {};

	if (Array.isArray(effectsSrc.drops)) effects.drops = effectsSrc.drops;
	const adds = normalizeScoreboardAdds(effectsSrc.scoreboardAddsOnBreak);
	if (adds) effects.scoreboardAddsOnBreak = adds;
	if (effectsSrc.xp && typeof effectsSrc.xp === "object") effects.xp = effectsSrc.xp;
	if (effectsSrc.title && typeof effectsSrc.title === "object") effects.title = effectsSrc.title;

	const when = normalizeWhenTree(value.when);
	if (value.when != null && !when) return null;

	return {
		id,
		priority,
		mode,
		...(when ? { when } : null),
		...(Object.keys(effects).length ? { effects } : null),
	};
}

function normalizeModifiers(value) {
	if (!Array.isArray(value)) return undefined;
	const out = value.map((entry, i) => normalizeModifierRuleEntry(entry, i)).filter(Boolean);
	return out.length ? out : undefined;
}

// ─── Fortune Tiers normalization ─────────────────────────────────────────────

function normalizeFortuneTierEffects(value) {
	if (!value || typeof value !== "object") return undefined;
	const out = {};
	const sbAdds = normalizeScoreboardAdds(value.scoreboardAddsOnBreak);
	if (sbAdds) out.scoreboardAddsOnBreak = sbAdds;
	// XP y title NO van en fortune tiers (son block-level, independientes de fortuna)
	return Object.keys(out).length ? out : undefined;
}

function normalizeFortuneTierEntry(value, index) {
	if (!value || typeof value !== "object") return null;
	const id = normalizeString(value.id) || `fortune_tier_${index}`;
	const threshold = toNumberOr(value.threshold, NaN);
	if (!Number.isFinite(threshold) || threshold < 0) return null;
	const drops = Array.isArray(value.drops) ? value.drops : [];
	const effects = normalizeFortuneTierEffects(value.effects);
	return {
		id,
		threshold: Math.trunc(threshold),
		drops,
		...(effects ? { effects } : {}),
	};
}

function normalizeFortuneTiers(value) {
	if (!value || typeof value !== "object") return undefined;
	const objective = normalizeString(value.objective);
	if (!objective) return undefined;
	const step = toNumberOr(value.step, 100);
	if (step <= 0) return undefined;
	const rawTiers = Array.isArray(value.tiers) ? value.tiers : [];
	const tiers = rawTiers
		.map((t, i) => normalizeFortuneTierEntry(t, i))
		.filter(Boolean)
		.sort((a, b) => a.threshold - b.threshold);
	if (tiers.length === 0) return undefined;
	return {
		objective,
		step: Math.trunc(step),
		tiers,
	};
}

/**
 * Normaliza una definición de mineral para que el runtime no tenga que hacer checks repetidos.
 * @param {any} oreDef
 * @param {any} config
 */
export function normalizeBlockDefinition(blockDef, config) {
	const id = normalizeString(blockDef && blockDef.id);
	const skill = normalizeSkill(blockDef && blockDef.skill) || normalizeSkill(config && config.defaultSkill) || "mining";

	const blockIdRaw = normalizeString(blockDef && blockDef.blockId);
	const match = normalizeBlockMatch(blockIdRaw || "");
	if (!id || !match || !skill) return null;

	const ticksPerSecond = toNumberOr(config && config.ticksPerSecond, 20);
	const regenSeconds = clamp(toNumberOr(blockDef && blockDef.regenSeconds, 60), 1, 60 * 60 * 24);
	const minedBlockId =
		normalizeString(blockDef && blockDef.minedBlockId) || normalizeString(config && config.defaultMinedBlockId) || "minecraft:black_concrete";

	const sounds = normalizeSoundsList(blockDef && blockDef.sounds);
	const xpOrbs = normalizeXpOrbs(blockDef && blockDef.xpOrbs);
	const particlesOnSilkTouch = normalizeParticlesOnSilkTouch(blockDef && blockDef.particlesOnSilkTouch);
	const scoreboardAddsOnBreak = normalizeScoreboardAdds(blockDef && blockDef.scoreboardAddsOnBreak);
	const areaIds = normalizeAreaIds(blockDef && blockDef.areas);

	const drops = Array.isArray(blockDef && blockDef.drops) ? blockDef.drops : [];
	const modifiers = normalizeModifiers(blockDef && blockDef.modifiers);
	const fortuneTiers = normalizeFortuneTiers(blockDef && blockDef.fortuneTiers);
	const spread = blockDef && blockDef.spread && typeof blockDef.spread === "object" ? blockDef.spread : undefined;
	const mutation = normalizeMutation(blockDef && blockDef.mutation);
	const growthCycle = normalizeGrowthCycle(blockDef && blockDef.growthCycle);

	// XP y xpTitle block-level (independientes de fortuna)
	const xp = blockDef && blockDef.xp && typeof blockDef.xp === "object" ? blockDef.xp : undefined;
	const xpTitle = blockDef && blockDef.xpTitle && typeof blockDef.xpTitle === "object" ? blockDef.xpTitle : undefined;

	return {
		id,
		skill,
		match,
		// Guardamos blockId exacto si aplica (útil para persistencia y debug)
		blockId: match.kind === "exact" ? match.value : null,
		regenSeconds,
		regenTicks: Math.max(1, Math.floor(regenSeconds * ticksPerSecond)),
		minedBlockId,
		sounds,
		xpOrbs,
		particlesOnSilkTouch,
		scoreboardAddsOnBreak,
		areaIds,
		drops,
		modifiers,
		fortuneTiers,
		spread,
		xp,
		xpTitle,
		mutation,
		growthCycle,
	};
}

/**
 * Construye un registro de blockId -> blockDef normalizado.
 * @param {any} config
 */
export function buildBlockRegistry(config) {
	/** @type {Map<string, any>} */
	const exact = new Map();
	/** @type {any[]} */
	const patterns = [];
	const blocks = Array.isArray(config && config.blocks) ? config.blocks : [];

	for (const b of blocks) {
		const norm = normalizeBlockDefinition(b, config);
		if (!norm) continue;
		if (norm.match.kind === "exact") exact.set(norm.match.value, norm);
		else patterns.push(norm);
	}
	return { exact, patterns };
}

/**
 * Helper DX: obtiene definición por blockTypeId.
 * @param {Map<string, any>} registry
 * @param {string} blockTypeId
 */
export function getBlockDefinition(registry, blockTypeId) {
	if (!registry || typeof registry !== "object") return null;
	const key = String(blockTypeId != null ? blockTypeId : "");
	const exact = registry.exact;
	if (exact && exact instanceof Map) {
		const hit = exact.get(key);
		if (hit) return hit;
	}
	const patterns = Array.isArray(registry.patterns) ? registry.patterns : [];
	for (const def of patterns) {
		const m = def && def.match;
		if (!m) continue;
		if (m.kind === "any") return def;
		if (m.kind === "prefix" && typeof m.value === "string" && key.startsWith(m.value)) return def;
		if (m.kind === "glob" && m.regex && typeof m.regex.test === "function" && m.regex.test(key)) return def;
	}
	return null;
}
