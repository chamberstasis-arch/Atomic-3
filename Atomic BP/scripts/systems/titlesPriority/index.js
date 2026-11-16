import { system, world } from "@minecraft/server";
import configDefault from "./config.js";
import { applyCustomEmojisToText } from "../../features/custom-emojis/index.js";

let didInit = false;
let activeConfig = configDefault;
let tickInProgress = false;
const TEMP_DEFAULT_DURATION_MS = 3000;
const TARGET_GLOBAL = "*";
const LOOP_TICKS_DEFAULT = 10;
const TEMP_SOURCE_DEFAULT = "anonymous";

let tempOrderCounter = 0;
let tempAutoIdCounter = 0;

/** @type {Map<string, Map<string, any>>} */
const temporaryTitlesByTarget = new Map();

function asStr(v) {
	return String(v != null ? v : "");
}

function safeString(v) {
	return String(v != null ? v : "").trim();
}

function isFiniteNumber(n) {
	return typeof n === "number" && Number.isFinite(n);
}

function debugLog(cfg, msg) {
	if (!cfg?.debug) return;
	try {
		console.log(`[titlesPriority] ${String(msg ?? "")}`);
	} catch (e) {
		void e;
	}
}

function applyEmojisIfEnabled(cfg, text) {
	if (!cfg?.emojis?.enabled) return asStr(text);
	try {
		return applyCustomEmojisToText(asStr(text));
	} catch (e) {
		void e;
		return asStr(text);
	}
}

function getRuntimeLoopTicks(cfg) {
	const raw = Number(cfg?.runtime?.loopTicks);
	if (!Number.isFinite(raw) || raw <= 0) return LOOP_TICKS_DEFAULT;
	return Math.max(1, Math.trunc(raw));
}

function getRuntimeTempDefaultDurationMs(cfg) {
	const raw = Number(cfg?.runtime?.temporary?.defaultDurationMs);
	if (!Number.isFinite(raw) || raw <= 0) return TEMP_DEFAULT_DURATION_MS;
	return Math.max(1, Math.trunc(raw));
}

function getRuntimeTempDefaultSource(cfg) {
	const value = safeString(cfg?.runtime?.temporary?.defaultSource);
	return value || TEMP_SOURCE_DEFAULT;
}

function normalizeTitles(config) {
	const t = config?.titles;
	if (Array.isArray(t)) return t;
	if (t && typeof t === "object") {
		// Alternativa documentada: titles como mapa por id
		const out = [];
		for (const [id, def] of Object.entries(t)) {
			if (!def || typeof def !== "object") continue;
			out.push({ id, ...def });
		}
		return out;
	}
	return [];
}

function normalizeAabb(area) {
	const at = area?.at;
	const to = area?.to;
	if (!at || !to) return null;
	const ax = Number(at.x), ay = Number(at.y), az = Number(at.z);
	const bx = Number(to.x), by = Number(to.y), bz = Number(to.z);
	if (![ax, ay, az, bx, by, bz].every((v) => Number.isFinite(v))) return null;
	return {
		minX: Math.min(ax, bx),
		minY: Math.min(ay, by),
		minZ: Math.min(az, bz),
		maxX: Math.max(ax, bx),
		maxY: Math.max(ay, by),
		maxZ: Math.max(az, bz),
	};
}

function isInAabb(loc, aabb) {
	if (!loc || !aabb) return false;
	const x = Number(loc.x), y = Number(loc.y), z = Number(loc.z);
	if (![x, y, z].every((v) => Number.isFinite(v))) return false;
	return x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY && z >= aabb.minZ && z <= aabb.maxZ;
}

function compareInt(left, op, right) {
	const a = Math.trunc(Number(left));
	const b = Math.trunc(Number(right));
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
	const o = safeString(op);
	switch (o) {
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

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function getObjectiveCached(id) {
	const objectiveId = safeString(id);
	if (!objectiveId) return null;
	if (objectiveCache.has(objectiveId)) return objectiveCache.get(objectiveId) ?? null;
	try {
		const obj = world.scoreboard.getObjective(objectiveId) ?? null;
		if (obj) objectiveCache.set(objectiveId, obj);
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
		const v = obj.getScore(identity);
		if (v === undefined || v === null) return null;
		const n = Math.trunc(Number(v));
		return Number.isFinite(n) ? n : null;
	} catch (e) {
		void e;
		return null;
	}
}

const PLACEHOLDER_RE = /\$\{([^:}]+):([^}]+)\}/g;

function parseLineToRawtext(cfg, line) {
	const s = asStr(line);
	/** @type {any[]} */
	const raw = [];
	let last = 0;
	PLACEHOLDER_RE.lastIndex = 0;
	for (let m = PLACEHOLDER_RE.exec(s); m; m = PLACEHOLDER_RE.exec(s)) {
		const start = m.index;
		const end = m.index + m[0].length;
		if (start > last) {
			const chunk = s.slice(last, start);
			if (chunk) raw.push({ text: applyEmojisIfEnabled(cfg, chunk) });
		}

		const objective = safeString(m[1]);
		const name = safeString(m[2]);
		if (objective && name) raw.push({ score: { name, objective } });
		else raw.push({ text: applyEmojisIfEnabled(cfg, m[0]) });

		last = end;
	}
	if (last < s.length) {
		const tail = s.slice(last);
		if (tail) raw.push({ text: applyEmojisIfEnabled(cfg, tail) });
	}
	if (raw.length === 0) raw.push({ text: applyEmojisIfEnabled(cfg, s) });
	return raw;
}

function buildActionbarRawtext(cfg, contentLines) {
	const lines = Array.isArray(contentLines) ? contentLines : [contentLines];
	/** @type {any[]} */
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		out.push(...parseLineToRawtext(cfg, line));
		if (i !== lines.length - 1) out.push({ text: "\n" });
	}
	return out;
}

function playerIsInOverworld(player) {
	try {
		return player?.dimension?.id === "minecraft:overworld";
	} catch (e) {
		void e;
		return false;
	}
}

function matchesDisplayIf(player, displayIf) {
	const di = displayIf && typeof displayIf === "object" ? displayIf : null;
	if (!di) return true;

	if (di.area != null) {
		if (!playerIsInOverworld(player)) return false;
		const aabb = normalizeAabb(di.area);
		if (!aabb) return false;
		const loc = player?.location;
		if (!isInAabb(loc, aabb)) return false;
	}

	if (di.score != null) {
		const sc = di.score && typeof di.score === "object" ? di.score : null;
		if (!sc) return false;
		const objectiveId = safeString(sc.objective);
		const cond = safeString(sc.condition);
		const rhs = Math.trunc(Number(sc.int));
		if (!objectiveId || !cond || !Number.isFinite(rhs)) return false;
		const lhs = getScoreBestEffort(player, objectiveId);
		if (lhs == null) return false;
		if (!compareInt(lhs, cond, rhs)) return false;
	}

	return true;
}

function pickBestTitle(cfg, titles, player) {
	let best = null;
	let bestPriority = -Infinity;

	for (const entry of titles) {
		if (!entry || typeof entry !== "object") continue;
		const id = safeString(entry.id);
		const priority = Number(entry.priority);
		const pr = isFiniteNumber(priority) ? priority : 0;
		if (!id) continue;
		if (!matchesDisplayIf(player, entry.display_if)) continue;
		if (best == null || pr > bestPriority) {
			best = entry;
			bestPriority = pr;
		}
		// Desempate por orden: si pr == bestPriority, NO reemplazamos.
	}

	return best;
}

async function sendActionbarTitleraw(player, rawtext) {
	try {
		if (!player?.runCommand) return false;
		const payload = JSON.stringify({ rawtext });
		player.runCommand(`titleraw @s actionbar ${payload}`);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function rawtextToPlainText(rawtext) {
	if (!Array.isArray(rawtext)) return null;
	let out = "";
	for (const part of rawtext) {
		if (!part || typeof part !== "object") return null;
		if (typeof part.text === "string") {
			out += part.text;
			continue;
		}
		// Si hay score/selectores no podemos convertir de forma fiable.
		return null;
	}
	return out;
}

function sendActionbarPlainBestEffort(player, rawtext) {
	try {
		const plain = rawtextToPlainText(rawtext);
		if (plain == null) return false;
		const display = player?.onScreenDisplay;
		if (!display || typeof display.setActionBar !== "function") return false;
		display.setActionBar(plain);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function getPlayerId(player) {
	try {
		return safeString(player?.id) || safeString(player?.name);
	} catch (e) {
		void e;
		return "";
	}
}

function nextTempAutoId() {
	tempAutoIdCounter += 1;
	return `tmp_${tempAutoIdCounter}`;
}

function nextTempOrder() {
	tempOrderCounter += 1;
	return tempOrderCounter;
}

function resolveTargetKey(target) {
	if (target == null) return TARGET_GLOBAL;
	if (typeof target === "string") {
		const fromString = safeString(target);
		return fromString || TARGET_GLOBAL;
	}
	const fromPlayer = getPlayerId(target);
	return fromPlayer || TARGET_GLOBAL;
}

function getTemporaryStoreByTarget(targetKey, create = false) {
	if (!temporaryTitlesByTarget.has(targetKey)) {
		if (!create) return null;
		temporaryTitlesByTarget.set(targetKey, new Map());
	}
	return temporaryTitlesByTarget.get(targetKey) ?? null;
}

function normalizeTemporaryContent(content) {
	if (Array.isArray(content)) return content.map((line) => asStr(line));
	return [asStr(content ?? "")];
}

function normalizeTemporaryDurationMs(cfg, input) {
	const expiresAt = Number(input?.expiresAtMs);
	if (Number.isFinite(expiresAt) && expiresAt > 0) {
		const msLeft = Math.trunc(expiresAt - Date.now());
		return msLeft > 0 ? msLeft : 0;
	}

	const durationMs = Number(input?.durationMs);
	if (Number.isFinite(durationMs) && durationMs > 0) return Math.trunc(durationMs);

	const durationTicks = Number(input?.durationTicks);
	if (Number.isFinite(durationTicks) && durationTicks > 0) return Math.trunc(durationTicks * 50);

	return getRuntimeTempDefaultDurationMs(cfg);
}

function normalizeTemporaryTitleInput(cfg, input) {
	const src = input && typeof input === "object" ? input : null;
	if (!src) return null;

	const id = safeString(src.id) || nextTempAutoId();
	const source = safeString(src.source) || getRuntimeTempDefaultSource(cfg);
	const priorityRaw = Number(src.priority);
	const priority = isFiniteNumber(priorityRaw) ? priorityRaw : 0;
	const content = normalizeTemporaryContent(src.content);
	const displayIf = src.display_if && typeof src.display_if === "object" ? src.display_if : undefined;
	const durationMs = normalizeTemporaryDurationMs(cfg, src);
	if (durationMs <= 0) return null;

	return {
		id,
		source,
		priority,
		content,
		display_if: displayIf,
		durationMs,
	};
}

function buildTempStoreKey(source, id) {
	return `${safeString(source)}:${safeString(id)}`;
}

function buildTempHandle(targetKey, storeKey) {
	return `${safeString(targetKey)}::${safeString(storeKey)}`;
}

function parseTempHandle(handle) {
	const raw = safeString(handle);
	if (!raw) return null;
	const sep = raw.indexOf("::");
	if (sep <= 0) return null;
	const targetKey = safeString(raw.slice(0, sep));
	const storeKey = safeString(raw.slice(sep + 2));
	if (!targetKey || !storeKey) return null;
	return { targetKey, storeKey };
}

function pruneExpiredInStore(store, nowMs) {
	if (!store || store.size === 0) return;
	for (const [storeKey, entry] of store.entries()) {
		if (!entry || typeof entry !== "object") {
			store.delete(storeKey);
			continue;
		}
		const expiresAtMs = Number(entry.expiresAtMs);
		if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) store.delete(storeKey);
	}
}

function pruneExpiredTemporaryTitles(nowMs = Date.now()) {
	for (const [targetKey, store] of temporaryTitlesByTarget.entries()) {
		pruneExpiredInStore(store, nowMs);
		if (!store || store.size === 0) temporaryTitlesByTarget.delete(targetKey);
	}
}

function getTemporaryTitlesForPlayer(player, nowMs = Date.now()) {
	pruneExpiredTemporaryTitles(nowMs);

	const out = [];
	const globalStore = getTemporaryStoreByTarget(TARGET_GLOBAL, false);
	if (globalStore && globalStore.size > 0) {
		for (const entry of globalStore.values()) out.push(entry);
	}

	const playerKey = getPlayerId(player);
	if (!playerKey) return out;

	const playerStore = getTemporaryStoreByTarget(playerKey, false);
	if (playerStore && playerStore.size > 0) {
		for (const entry of playerStore.values()) out.push(entry);
	}

	return out;
}

function getActiveConfig() {
	return didInit && activeConfig && typeof activeConfig === "object" ? activeConfig : configDefault;
}

export function upsertTemporaryTitle(request = undefined) {
	const cfg = getActiveConfig();
	const normalized = normalizeTemporaryTitleInput(cfg, request);
	if (!normalized) return null;

	const targetKey = resolveTargetKey(request?.target);
	const store = getTemporaryStoreByTarget(targetKey, true);
	if (!store) return null;

	const storeKey = buildTempStoreKey(normalized.source, normalized.id);
	const existing = store.get(storeKey);
	const createdOrder = Number(existing?.createdOrder);
	const nowMs = Date.now();

	store.set(storeKey, {
		id: normalized.id,
		source: normalized.source,
		priority: normalized.priority,
		content: normalized.content,
		display_if: normalized.display_if,
		createdOrder: Number.isFinite(createdOrder) ? createdOrder : nextTempOrder(),
		expiresAtMs: nowMs + normalized.durationMs,
		temp: true,
	});

	return {
		handle: buildTempHandle(targetKey, storeKey),
		target: targetKey,
		id: normalized.id,
		source: normalized.source,
		expiresAtMs: nowMs + normalized.durationMs,
	};
}

export function removeTemporaryTitle(input = undefined) {
	const cfg = getActiveConfig();
	if (typeof input === "string") {
		const parsed = parseTempHandle(input);
		if (!parsed) return false;
		const store = getTemporaryStoreByTarget(parsed.targetKey, false);
		if (!store) return false;
		const deleted = store.delete(parsed.storeKey);
		if (store.size === 0) temporaryTitlesByTarget.delete(parsed.targetKey);
		return deleted;
	}

	const src = input && typeof input === "object" ? input : null;
	if (!src) return false;
	const id = safeString(src.id);
	const source = safeString(src.source) || getRuntimeTempDefaultSource(cfg);
	if (!id) return false;

	const targetKey = resolveTargetKey(src.target);
	const store = getTemporaryStoreByTarget(targetKey, false);
	if (!store) return false;

	const storeKey = buildTempStoreKey(source, id);
	const deleted = store.delete(storeKey);
	if (store.size === 0) temporaryTitlesByTarget.delete(targetKey);
	return deleted;
}

export function clearTemporaryTitles(filter = undefined) {
	const src = filter && typeof filter === "object" ? filter : null;
	const sourceFilter = safeString(src?.source);
	const hasTargetFilter = src && Object.prototype.hasOwnProperty.call(src, "target");
	const targetFilter = hasTargetFilter ? resolveTargetKey(src?.target) : "";

	let deletedCount = 0;
	for (const [targetKey, store] of temporaryTitlesByTarget.entries()) {
		if (targetFilter && targetKey !== targetFilter) continue;
		for (const [storeKey, entry] of store.entries()) {
			if (sourceFilter && safeString(entry?.source) !== sourceFilter) continue;
			store.delete(storeKey);
			deletedCount += 1;
		}
		if (store.size === 0) temporaryTitlesByTarget.delete(targetKey);
	}

	return deletedCount;
}

async function tickTitlesPriority(cfg) {
	const staticTitles = normalizeTitles(cfg);
	const nowMs = Date.now();

	const players = world.getPlayers();
	for (const player of players) {
		const temporaryTitles = getTemporaryTitlesForPlayer(player, nowMs);
		const candidates = staticTitles.length > 0 ? [...staticTitles, ...temporaryTitles] : temporaryTitles;
		if (!candidates.length) continue;

		const best = pickBestTitle(cfg, candidates, player);
		if (!best) continue;

		// Importante: el actionbar se desvanece y los scores se resuelven al ejecutar el comando.
		// Por eso se re-emite el titleraw en cada tick del loop.
		const rawtext = buildActionbarRawtext(cfg, best.content ?? "");
		const ok = await sendActionbarTitleraw(player, rawtext);
		if (!ok) {
			const fallbackOk = sendActionbarPlainBestEffort(player, rawtext);
			if (!fallbackOk) debugLog(cfg, `sendActionbar failed player=${safeString(player?.name) || safeString(player?.id) || "?"} title=${safeString(best?.id)}`);
		}
	}
}

export function initTitlesPrioritySystem(userConfig = undefined) {
	if (didInit) return;
	didInit = true;

	const cfg = userConfig && typeof userConfig === "object" ? userConfig : configDefault;
	activeConfig = cfg;
	const loopTicks = getRuntimeLoopTicks(cfg);
	debugLog(cfg, `init loopTicks=${loopTicks}`);

	system.runInterval(() => {
		if (tickInProgress) return;
		tickInProgress = true;
		void tickTitlesPriority(cfg)
			.catch((e) => {
				void e;
			})
			.finally(() => {
				tickInProgress = false;
			});
	}, loopTicks);
}
