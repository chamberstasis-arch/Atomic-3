// Persistencia de regeneraciones pendientes (world dynamic properties).
// Responsabilidad: guardar/cargar/normalizar; NO manejar eventos de break.

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

function normalizeEntry(e) {
	if (!e || typeof e !== "object") return null;
	const dimensionId = String(e.dimensionId != null ? e.dimensionId : "").trim();
	const blockId = String(e.blockId != null ? e.blockId : "").trim();
	const minedBlockId = String(e.minedBlockId != null ? e.minedBlockId : "").trim();

	const x = Number(e.x);
	const y = Number(e.y);
	const z = Number(e.z);
	const restoreAt = Number(e.restoreAt);

	if (!dimensionId || !blockId || !minedBlockId) return null;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
	if (!Number.isFinite(restoreAt)) return null;

	const normalizeStates = (value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			const key = String(k != null ? k : "").trim();
			if (!key) continue;
			if (typeof v === "number") {
				if (!Number.isFinite(v)) continue;
				out[key] = Math.trunc(v);
				continue;
			}
			if (typeof v === "string" || typeof v === "boolean") {
				out[key] = v;
			}
		}
		return Object.keys(out).length ? out : undefined;
	};

	const blockStates = normalizeStates(e.blockStates);
	const minedBlockStates = normalizeStates(e.minedBlockStates);

	return {
		dimensionId,
		x: Math.floor(x),
		y: Math.floor(y),
		z: Math.floor(z),
		blockId,
		...(blockStates ? { blockStates } : {}),
		minedBlockId,
		...(minedBlockStates ? { minedBlockStates } : {}),
		restoreAt,
	};
}

export function makePendingKey(entry) {
	return `${entry.dimensionId}:${entry.x}:${entry.y}:${entry.z}`;
}

/**
 * Registra la dynamic property del mundo (string) para persistir el JSON.
 * Esto se debe llamar una vez al iniciar.
 */
export function initMiningRegenDynamicProperties(config) {
	const key = String(config && config.persistence && config.persistence.key ? config.persistence.key : "atomic3:mining_regen_pending");
	const maxLen = Math.max(1000, Number(config && config.persistence && config.persistence.maxStringLength != null ? config.persistence.maxStringLength : 30000));

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
						def.defineString(key, maxLen);
					} else if (typeof def.defineNumber === "function") {
						// Fallback extremo: no persistimos lista, solo flag. (Se deja definido por compat.)
						def.defineNumber(key, 0, 1);
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

// Alias (nuevo nombre) para reflejar que este sistema ya no es solo mining.
export function initSkillRegenDynamicProperties(config) {
	return initMiningRegenDynamicProperties(config);
}

export function loadPendingEntries(config) {
	const key = String(config && config.persistence && config.persistence.key ? config.persistence.key : "atomic3:mining_regen_pending");
	let raw;
	try {
		raw = world.getDynamicProperty(key);
	} catch (e) {
		void e;
		raw = undefined;
	}
	if (typeof raw !== "string") return [];

	const parsed = safeJsonParse(raw);
	const list = Array.isArray(parsed) ? parsed : [];

	/** @type {any[]} */
	const out = [];
	for (const e of list) {
		const n = normalizeEntry(e);
		if (n) out.push(n);
	}
	return out;
}

export function savePendingEntries(config, entries) {
	const key = String(config && config.persistence && config.persistence.key ? config.persistence.key : "atomic3:mining_regen_pending");
	const maxLen = Math.max(1000, Number(config && config.persistence && config.persistence.maxStringLength != null ? config.persistence.maxStringLength : 30000));
	const maxEntries = Math.max(1, Number(config && config.persistence && config.persistence.maxEntries != null ? config.persistence.maxEntries : 1500));

	const list = Array.isArray(entries) ? entries.slice(0, maxEntries) : [];
	let json = safeJsonStringify(list);
	if (json.length > maxLen) {
		// Recorte best-effort: mantener los primeros N entries.
		// (Evita crash por DP demasiado grande)
		const trimmed = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
		json = safeJsonStringify(trimmed);
		if (json.length > maxLen) {
			// Último recurso
			json = "[]";
		}
	}

	try {
		world.setDynamicProperty(key, json);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

/**
 * Utilidad: procesa al cargar mundo en batches para evitar picos.
 * @param {any} config
 * @param {any[]} entries
 * @param {(entry:any)=>void} onEntry
 * @param {()=>void} onDone
 */
export function processEntriesInBatches(config, entries, onEntry, onDone) {
	const batchSize = Math.max(1, Number(config?.persistence?.loadBatchSize ?? 50));
	const delay = Math.max(0, Number(config?.persistence?.loadBatchDelayTicks ?? 1));

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
	const remainingMs = Math.max(0, Number(entry.restoreAt) - nowMs());
	return Math.max(1, Math.ceil((remainingMs / 1000) * tps));
}
