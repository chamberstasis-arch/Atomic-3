// Persistencia de regeneración por grupos locales de veta (world dynamic properties).
// Responsabilidad: normalizar/guardar/cargar estado persistente de grupos y migrar pending legacy.

import * as mc from "@minecraft/server";
import { system, world } from "@minecraft/server";

function safeJsonParse(str) {
	if (typeof str !== "string" || !str) return null;
	try {
		return JSON.parse(str);
	} catch (e) {
		void e;
		return null;
	}
}

function safeJsonStringify(obj) {
	try {
		return JSON.stringify(obj);
	} catch (e) {
		void e;
		return "[]";
	}
}

function nowMs() {
	return Date.now();
}

function asStr(value) {
	return String(value != null ? value : "").trim();
}

function normalizeToken(value) {
	const base = asStr(value).toLowerCase();
	if (!base) return "_";
	return base.replace(/[^a-z0-9:_\-]/g, "_").slice(0, 40) || "_";
}

function normalizeAreaId(value) {
	return normalizeToken(value);
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function getPersistenceConfig(config) {
	const persistence = config?.persistence ?? {};
	const legacyKey = asStr(persistence.key) || "atomic3:mining_regen_pending";
	const indexKey = asStr(persistence.groupIndexKey) || "atomic3:regen_groups_index";
	const fallbackKey = asStr(persistence.groupFallbackKey) || "atomic3:regen_groups_fallback";
	const shardPrefix = asStr(persistence.groupShardPrefix) || "atomic3:regen_gs_";
	const maxLen = Math.max(1000, toInt(persistence.maxStringLength, 30000));
	const maxEntries = Math.max(1, toInt(persistence.maxEntries, 1500));
	const loadBatchSize = Math.max(1, toInt(persistence.loadBatchSize, 50));
	const loadBatchDelayTicks = Math.max(0, toInt(persistence.loadBatchDelayTicks, 1));
	return {
		legacyKey,
		indexKey,
		fallbackKey,
		shardPrefix,
		maxLen,
		maxEntries,
		loadBatchSize,
		loadBatchDelayTicks,
	};
}

function normalizeAreaIds(value) {
	if (value == null) return [];
	if (typeof value === "string") {
		const id = normalizeAreaId(value);
		return id ? [id] : [];
	}
	if (Array.isArray(value)) return value.map(normalizeAreaId).filter(Boolean);
	return [];
}

function getScopeCandidatesFromConfig(config) {
	const out = new Set();
	const blocks = Array.isArray(config?.blocks) ? config.blocks : [];
	const areas = Array.isArray(config?.areas) ? config.areas : [];
	const areaById = new Map();
	for (const area of areas) {
		if (!area || typeof area !== "object") continue;
		const areaId = normalizeAreaId(area.id ?? area.name);
		const dimensionId = normalizeToken(area.dimensionId);
		if (!areaId || !dimensionId) continue;
		areaById.set(areaId, dimensionId);
	}

	for (const block of blocks) {
		if (!block || typeof block !== "object") continue;
		const skillId = normalizeToken(block.skill);
		if (!skillId) continue;
		const familyId = normalizeToken(block.familyId ?? block.id ?? block.blockId ?? skillId);
		const declared = normalizeAreaIds(block.areas);
		const areaIds = declared.length === 0 || declared.includes("*") ? Array.from(areaById.keys()) : declared;
		for (const areaId of areaIds) {
			const dim = areaById.get(areaId);
			if (!dim) continue;
			const scopeId = makeGroupScopeId({ dimensionId: dim, areaId, skillId, familyId });
			out.add(scopeId);
		}
	}

	return out;
}

function hashScopeId(scopeId) {
	let hash = 5381;
	for (let i = 0; i < scopeId.length; i++) {
		hash = ((hash << 5) + hash) + scopeId.charCodeAt(i);
		hash = hash >>> 0;
	}
	return hash.toString(36);
}

function buildScopeShardMap(config, persistenceCfg) {
	const scopes = Array.from(getScopeCandidatesFromConfig(config)).sort();
	const scopeToDpKey = new Map();
	const usedKeys = new Set();
	for (const scopeId of scopes) {
		const hash = hashScopeId(scopeId);
		let key = `${persistenceCfg.shardPrefix}${hash}`;
		let salt = 0;
		while (usedKeys.has(key)) {
			salt++;
			key = `${persistenceCfg.shardPrefix}${hash}_${salt}`;
		}
		usedKeys.add(key);
		scopeToDpKey.set(scopeId, key);
	}
	return scopeToDpKey;
}

function getWorldDynamicProperty(key) {
	try {
		return world.getDynamicProperty(key);
	} catch (e) {
		void e;
		return undefined;
	}
}

function setWorldDynamicProperty(key, value) {
	try {
		world.setDynamicProperty(key, value);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function loadScopeIndex(persistenceCfg) {
	const raw = getWorldDynamicProperty(persistenceCfg.indexKey);
	if (typeof raw !== "string") return { scopes: {} };
	const parsed = safeJsonParse(raw);
	if (!parsed || typeof parsed !== "object") return { scopes: {} };
	const scopes = parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {};
	const out = {};
	for (const [scopeIdRaw, dpKeyRaw] of Object.entries(scopes)) {
		const scopeId = asStr(scopeIdRaw);
		const dpKey = asStr(dpKeyRaw);
		if (!scopeId || !dpKey) continue;
		out[scopeId] = dpKey;
	}
	return { scopes: out };
}

function saveScopeIndex(context) {
	const scopes = {};
	for (const [scopeId, dpKey] of context.scopeToDpKey.entries()) {
		if (!scopeId || !dpKey) continue;
		scopes[scopeId] = dpKey;
	}
	const payload = {
		version: 2,
		updatedAt: nowMs(),
		scopes,
	};
	let json = safeJsonStringify(payload);
	if (json.length > context.persistence.maxLen) {
		json = safeJsonStringify({ version: 2, updatedAt: nowMs(), scopes: {} });
	}
	return setWorldDynamicProperty(context.persistence.indexKey, json);
}

function normalizeStates(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const key = asStr(k);
		if (!key) continue;
		if (typeof v === "number") {
			if (!Number.isFinite(v)) continue;
			out[key] = Math.trunc(v);
			continue;
		}
		if (typeof v === "string" || typeof v === "boolean") out[key] = v;
	}
	return Object.keys(out).length ? out : undefined;
}

function normalizeGroupMember(entry) {
	if (!entry || typeof entry !== "object") return null;
	const x = Number(entry.x);
	const y = Number(entry.y);
	const z = Number(entry.z);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	const blockId = asStr(entry.blockId);
	const minedBlockId = asStr(entry.minedBlockId);
	if (!blockId || !minedBlockId) return null;
	const blockStates = normalizeStates(entry.blockStates);
	const minedBlockStates = normalizeStates(entry.minedBlockStates);
	return {
		x: Math.floor(x),
		y: Math.floor(y),
		z: Math.floor(z),
		blockId,
		...(blockStates ? { blockStates } : {}),
		minedBlockId,
		...(minedBlockStates ? { minedBlockStates } : {}),
	};
}

function normalizeGroupStatus(value) {
	const s = asStr(value).toLowerCase();
	if (s === "closed" || s === "restoring") return s;
	return "open";
}

function normalizePersistedGroup(group, fallbackScopeId = "") {
	if (!group || typeof group !== "object") return null;
	const id = asStr(group.id);
	if (!id) return null;
	const scopeId = asStr(group.scopeId || fallbackScopeId);
	const dimensionId = asStr(group.dimensionId);
	const areaId = normalizeAreaId(group.areaId);
	const skillId = normalizeToken(group.skillId);
	const familyId = normalizeToken(group.familyId);
	if (!scopeId || !dimensionId || !areaId || !skillId || !familyId) return null;
	const createdAt = Number(group.createdAt);
	const closeAt = Number(group.closeAt);
	const restoreAt = Number(group.restoreAt);
	if (!Number.isFinite(createdAt) || !Number.isFinite(closeAt) || !Number.isFinite(restoreAt)) return null;
	const status = normalizeGroupStatus(group.status);
	const rawMembers = Array.isArray(group.members) ? group.members : [];
	const members = rawMembers.map(normalizeGroupMember).filter(Boolean);
	if (members.length === 0) return null;
	return {
		id,
		scopeId,
		dimensionId,
		areaId,
		skillId,
		familyId,
		status,
		createdAt: Math.trunc(createdAt),
		closeAt: Math.trunc(closeAt),
		restoreAt: Math.trunc(restoreAt),
		members,
		owner: group.owner && typeof group.owner === "object"
			? {
				firstPlayerId: asStr(group.owner.firstPlayerId),
				contributors: Math.max(1, toInt(group.owner.contributors, 1)),
			}
			: undefined,
	};
}

function serializeGroupForPersistence(group) {
	return {
		id: group.id,
		scopeId: group.scopeId,
		dimensionId: group.dimensionId,
		areaId: group.areaId,
		skillId: group.skillId,
		familyId: group.familyId,
		status: normalizeGroupStatus(group.status),
		createdAt: Math.trunc(Number(group.createdAt) || nowMs()),
		closeAt: Math.trunc(Number(group.closeAt) || nowMs()),
		restoreAt: Math.trunc(Number(group.restoreAt) || nowMs()),
		members: Array.isArray(group.members)
			? group.members.map((m) => ({
				x: Math.trunc(Number(m.x) || 0),
				y: Math.trunc(Number(m.y) || 0),
				z: Math.trunc(Number(m.z) || 0),
				blockId: asStr(m.blockId),
				...(normalizeStates(m.blockStates) ? { blockStates: normalizeStates(m.blockStates) } : {}),
				minedBlockId: asStr(m.minedBlockId),
				...(normalizeStates(m.minedBlockStates) ? { minedBlockStates: normalizeStates(m.minedBlockStates) } : {}),
			})).filter((m) => m.blockId && m.minedBlockId)
			: [],
		owner: group.owner && typeof group.owner === "object"
			? {
				firstPlayerId: asStr(group.owner.firstPlayerId),
				contributors: Math.max(1, toInt(group.owner.contributors, 1)),
			}
			: undefined,
	};
}

function statusWeight(status) {
	const s = normalizeGroupStatus(status);
	if (s === "restoring") return 3;
	if (s === "open") return 2;
	return 1;
}

function trimGroupListForBudget(groups, persistenceCfg) {
	const raw = Array.isArray(groups) ? groups : [];
	const normalized = raw
		.map(serializeGroupForPersistence)
		.filter((g) => Array.isArray(g.members) && g.members.length > 0)
		.sort((a, b) => {
			const sw = statusWeight(b.status) - statusWeight(a.status);
			if (sw !== 0) return sw;
			return Number(b.closeAt || 0) - Number(a.closeAt || 0);
		});

	let list = normalized.slice(0, persistenceCfg.maxEntries);
	let json = safeJsonStringify(list);
	while (json.length > persistenceCfg.maxLen && list.length > 0) {
		list.pop();
		json = safeJsonStringify(list);
	}

	return {
		list,
		json,
		trimmed: normalized.length - list.length,
	};
}

function loadFallbackPayload(persistenceCfg) {
	const raw = getWorldDynamicProperty(persistenceCfg.fallbackKey);
	if (typeof raw !== "string") return { scopes: {} };
	const parsed = safeJsonParse(raw);
	if (!parsed || typeof parsed !== "object") return { scopes: {} };
	const scopes = parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {};
	return { scopes };
}

function saveFallbackPayload(persistenceCfg, payload) {
	let json = safeJsonStringify(payload);
	if (json.length > persistenceCfg.maxLen) {
		json = safeJsonStringify({ version: 2, scopes: {} });
	}
	return setWorldDynamicProperty(persistenceCfg.fallbackKey, json);
}

function resolveScopeDpKey(context, scopeId) {
	const known = context.scopeToDpKey.get(scopeId);
	if (known) return known;
	context.scopeToDpKey.set(scopeId, context.persistence.fallbackKey);
	return context.persistence.fallbackKey;
}

function normalizeLegacyEntry(e) {
	if (!e || typeof e !== "object") return null;
	const dimensionId = asStr(e.dimensionId);
	const blockId = asStr(e.blockId);
	const minedBlockId = asStr(e.minedBlockId);
	const x = Number(e.x);
	const y = Number(e.y);
	const z = Number(e.z);
	const restoreAt = Number(e.restoreAt);
	if (!dimensionId || !blockId || !minedBlockId) return null;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	if (!Number.isFinite(restoreAt)) return null;
	return {
		dimensionId,
		x: Math.floor(x),
		y: Math.floor(y),
		z: Math.floor(z),
		blockId,
		...(normalizeStates(e.blockStates) ? { blockStates: normalizeStates(e.blockStates) } : {}),
		minedBlockId,
		...(normalizeStates(e.minedBlockStates) ? { minedBlockStates: normalizeStates(e.minedBlockStates) } : {}),
		restoreAt,
	};
}

export function makeBlockPendingKey(dimensionId, pos) {
	const x = Math.floor(Number(pos?.x) || 0);
	const y = Math.floor(Number(pos?.y) || 0);
	const z = Math.floor(Number(pos?.z) || 0);
	return `${asStr(dimensionId)}:${x}:${y}:${z}`;
}

export function makeGroupScopeId(scope) {
	return `${normalizeToken(scope?.dimensionId)}|${normalizeAreaId(scope?.areaId)}|${normalizeToken(scope?.skillId)}|${normalizeToken(scope?.familyId)}`;
}

export function makeGroupId(scopeId) {
	const ts = nowMs();
	const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
	return `g:${hashScopeId(scopeId)}:${ts}:${rand}`;
}

export function createGroupPersistenceContext(config) {
	const persistence = getPersistenceConfig(config);
	const deterministic = buildScopeShardMap(config, persistence);
	const index = loadScopeIndex(persistence);
	const scopeToDpKey = new Map(deterministic);
	for (const [scopeIdRaw, dpKeyRaw] of Object.entries(index.scopes)) {
		const scopeId = asStr(scopeIdRaw);
		const dpKey = asStr(dpKeyRaw);
		if (!scopeId || !dpKey || scopeToDpKey.has(scopeId)) continue;
		scopeToDpKey.set(scopeId, dpKey);
	}
	const context = {
		persistence,
		scopeToDpKey,
	};
	saveScopeIndex(context);
	return context;
}

export function loadPersistedGroups(context) {
	if (!context || typeof context !== "object") return [];
	const byId = new Map();
	const fallbackScopeIds = [];

	for (const [scopeId, dpKey] of context.scopeToDpKey.entries()) {
		if (dpKey === context.persistence.fallbackKey) {
			fallbackScopeIds.push(scopeId);
			continue;
		}
		const raw = getWorldDynamicProperty(dpKey);
		if (typeof raw !== "string") continue;
		const parsed = safeJsonParse(raw);
		const list = Array.isArray(parsed) ? parsed : [];
		for (const item of list) {
			const group = normalizePersistedGroup(item, scopeId);
			if (!group) continue;
			byId.set(group.id, group);
		}
	}

	const fallbackPayload = loadFallbackPayload(context.persistence);
	for (const scopeId of fallbackScopeIds) {
		const list = Array.isArray(fallbackPayload?.scopes?.[scopeId]) ? fallbackPayload.scopes[scopeId] : [];
		for (const item of list) {
			const group = normalizePersistedGroup(item, scopeId);
			if (!group) continue;
			byId.set(group.id, group);
		}
	}

	return Array.from(byId.values());
}

export function saveScopeGroups(context, scopeId, groups) {
	if (!context || typeof context !== "object") return { ok: false, trimmed: 0 };
	const normalizedScopeId = asStr(scopeId);
	if (!normalizedScopeId) return { ok: false, trimmed: 0 };
	const dpKey = resolveScopeDpKey(context, normalizedScopeId);
	const budget = trimGroupListForBudget(groups, context.persistence);

	let ok = false;
	if (dpKey === context.persistence.fallbackKey) {
		const payload = loadFallbackPayload(context.persistence);
		if (!payload.scopes || typeof payload.scopes !== "object") payload.scopes = {};
		if (budget.list.length === 0) delete payload.scopes[normalizedScopeId];
		else payload.scopes[normalizedScopeId] = budget.list;
		payload.version = 2;
		payload.updatedAt = nowMs();
		ok = saveFallbackPayload(context.persistence, payload);
	} else {
		ok = setWorldDynamicProperty(dpKey, budget.json);
	}

	if (!saveScopeIndex(context)) ok = false;
	return { ok, trimmed: Math.max(0, budget.trimmed) };
}

export function loadLegacyPendingEntries(config) {
	const persistence = getPersistenceConfig(config);
	const raw = getWorldDynamicProperty(persistence.legacyKey);
	if (typeof raw !== "string") return [];
	const parsed = safeJsonParse(raw);
	const list = Array.isArray(parsed) ? parsed : [];
	const out = [];
	for (const entry of list) {
		const normalized = normalizeLegacyEntry(entry);
		if (!normalized) continue;
		out.push(normalized);
	}
	return out;
}

export function clearLegacyPendingEntries(config) {
	const persistence = getPersistenceConfig(config);
	return setWorldDynamicProperty(persistence.legacyKey, "[]");
}

export function initMiningRegenDynamicProperties(config) {
	const persistence = getPersistenceConfig(config);
	const scopeMap = buildScopeShardMap(config, persistence);
	const keys = new Set([
		persistence.legacyKey,
		persistence.indexKey,
		persistence.fallbackKey,
		...scopeMap.values(),
	]);

	try {
		const initEv = world?.afterEvents?.worldInitialize?.subscribe
			? world.afterEvents.worldInitialize
			: world?.beforeEvents?.worldInitialize?.subscribe
				? world.beforeEvents.worldInitialize
				: null;

		if (initEv && typeof initEv.subscribe === "function") {
			initEv.subscribe((ev) => {
				try {
					if (!ev || !ev.propertyRegistry) return;
					const DefCtor = mc && mc.DynamicPropertiesDefinition ? mc.DynamicPropertiesDefinition : null;
					if (!DefCtor) return;
					const def = new DefCtor();
					if (typeof def.defineString === "function") {
						for (const key of keys) def.defineString(key, persistence.maxLen);
					} else if (typeof def.defineNumber === "function") {
						def.defineNumber(persistence.indexKey, 0, 1);
					}
					ev.propertyRegistry.registerWorldDynamicProperties(def);
				} catch (e) {
					void e;
				}
			});
		}
	} catch (e) {
		void e;
	}
}

export function initSkillRegenDynamicProperties(config) {
	return initMiningRegenDynamicProperties(config);
}

export function processEntriesInBatches(config, entries, onEntry, onDone) {
	const persistence = getPersistenceConfig(config);
	const batchSize = persistence.loadBatchSize;
	const delay = persistence.loadBatchDelayTicks;

	let i = 0;
	function step() {
		const end = Math.min(entries.length, i + batchSize);
		for (; i < end; i++) {
			try {
				onEntry(entries[i]);
			} catch (e) {
				void e;
			}
		}
		if (i >= entries.length) {
			try {
				onDone();
			} catch (e) {
				void e;
			}
			return;
		}
		system.runTimeout(step, delay);
	}
	step();
}

export function isExpired(entry) {
	return nowMs() >= Number(entry && entry.restoreAt != null ? entry.restoreAt : 0);
}

export function computeRemainingTicks(entry, ticksPerSecond) {
	const tps = Math.max(1, Number(ticksPerSecond != null ? ticksPerSecond : 20));
	const remainingMs = Math.max(0, Number(entry?.restoreAt) - nowMs());
	return Math.max(1, Math.ceil((remainingMs / 1000) * tps));
}
