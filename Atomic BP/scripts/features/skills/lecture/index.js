// Feature: skills/lecture

import { system, world } from "@minecraft/server";
import { lectureConfig } from "./config.js";
import { GATE_OBJECTIVE, STAT_REGISTRY } from "./statRegistry.js";
import { buildEquipmentSignature, getEquippedItemsBestEffort } from "./equipmentReader.js";
import { sumStatsFromEquippedItems } from "./totals.js";
import { getScoreIdentityOrDefault, setScoreIdentityBestEffort } from "./scoreboard.js";

/** @typedef {{
 *  enabled: boolean,
 *  signature: string,
 *  equip: Record<string, number>,
 *  personal: Record<string, number>,
 *  otros: Record<string, number>,
 *  total: Record<string, number>,
 * }} PlayerLectureCache */

/** @type {Map<string, PlayerLectureCache>} */
const cacheByPlayerKey = new Map();

/** @type {Map<string, number>} */
const lastDebugMsByPlayerKey = new Map();

let didInit = false;

function getPlayerKey(player, identity) {
	try {
		if (identity && identity.id != null) return `sb:${String(identity.id)}`;
		if (player && player.id) return `pl:${String(player.id)}`;
		if (player && player.name) return `nm:${String(player.name)}`;
	} catch (e) {
		void e;
	}
	return null;
}

function shouldDebugEmit(cfg, playerKey) {
	const dbg = cfg?.debug;
	if (!dbg?.enabled) return false;
	const throttleMs = Math.max(0, Math.trunc(dbg.throttleMs ?? 0));
	if (!playerKey || throttleMs <= 0) return true;
	const now = Date.now();
	const last = lastDebugMsByPlayerKey.get(playerKey) || 0;
	if (now - last < throttleMs) return false;
	lastDebugMsByPlayerKey.set(playerKey, now);
	return true;
}

function debugLog(cfg, msg) {
	try {
		const dbg = cfg?.debug;
		if (!dbg?.enabled || !dbg?.console) return;
		// eslint-disable-next-line no-console
		console.warn(String(msg));
	} catch (e) {
		void e;
	}
}

function debugTellPlayer(cfg, player, msg) {
	try {
		const dbg = cfg?.debug;
		if (!dbg?.enabled || !dbg?.tellPlayer) return;
		player?.sendMessage?.(String(msg));
	} catch (e) {
		void e;
	}
}

function ensurePersonalDefaults(cfg, player, identity) {
	// No crea objectives; solo setea scores si el objective ya existe.
	for (const stat of STAT_REGISTRY) {
		const def = stat.defaultPersonal;
		if (def == null) continue;
		const cur = getScoreIdentityOrDefault(stat.personal, identity, player?.name, 0);
		if (Math.trunc(cur) <= 0) setScoreIdentityBestEffort(stat.personal, identity, player?.name, def);
	}
}

function zeroOutputsIfNeeded(cfg, player, identity, prev) {
	if (!cfg?.disabledBehavior?.zeroOutputs) return;
	if (!prev) return;
	for (const stat of STAT_REGISTRY) {
		setScoreIdentityBestEffort(stat.equipamiento, identity, player?.name, 0);
		setScoreIdentityBestEffort(stat.total, identity, player?.name, 0);
	}
}

function readLayerIntoObject(layerKey, player, identity) {
	/** @type {Record<string, number>} */
	const out = {};
	for (const stat of STAT_REGISTRY) {
		const objId = stat[layerKey];
		out[stat.id] = Math.trunc(getScoreIdentityOrDefault(objId, identity, player?.name, 0));
	}
	return out;
}

function writeLayerIfChanged(layerKey, player, identity, next, prev) {
	let wrote = false;
	for (const stat of STAT_REGISTRY) {
		const objId = stat[layerKey];
		const n = Math.trunc(next[stat.id] ?? 0);
		const p = Math.trunc(prev?.[stat.id] ?? Number.MIN_SAFE_INTEGER);
		if (n === p) continue;
		setScoreIdentityBestEffort(objId, identity, player?.name, n);
		wrote = true;
	}
	return wrote;
}

function tickLecture(cfg) {
	/** @type {Set<string>} */
	const active = new Set();

	for (const player of world.getPlayers()) {
		const identity = player.scoreboardIdentity;
		const playerKey = getPlayerKey(player, identity);
		if (playerKey) active.add(playerKey);

		const enabledScore = getScoreIdentityOrDefault(GATE_OBJECTIVE, identity, player.name, 0);
		const enabled = Number(enabledScore) >= 1;

		const prev = playerKey ? cacheByPlayerKey.get(playerKey) || null : null;

		if (!enabled) {
			zeroOutputsIfNeeded(cfg, player, identity, prev);
			if (shouldDebugEmit(cfg, playerKey)) {
				const msg = `§8[lecture] disabled: H=${Math.trunc(enabledScore)}`;
				debugLog(cfg, msg);
				debugTellPlayer(cfg, player, msg);
			}
			if (playerKey) {
				cacheByPlayerKey.set(playerKey, {
					enabled: false,
					signature: "",
					equip: {},
					personal: {},
					otros: {},
					total: {},
				});
			}
			continue;
		}

		// Defaults (solo si H==1)
		ensurePersonalDefaults(cfg, player, identity);

		const equipped = getEquippedItemsBestEffort(player);
		const signature = buildEquipmentSignature(equipped.items);

		// 1) Equipamiento: solo re-parsea lore si cambió la firma
		let equipTotals = prev?.equip ?? null;
		if (!prev || prev.signature !== signature || !equipTotals) {
			equipTotals = sumStatsFromEquippedItems(equipped.items, STAT_REGISTRY);
		}

		// 2) Personal + Otros: siempre se leen (pueden cambiar por comandos/buffs)
		const personal = readLayerIntoObject("personal", player, identity);
		const otros = readLayerIntoObject("otros", player, identity);

		// 3) Total = Personal + Equipamiento + Otros
		/** @type {Record<string, number>} */
		const total = {};
		for (const stat of STAT_REGISTRY) {
			total[stat.id] = Math.trunc(Number(personal[stat.id] ?? 0) + Number(equipTotals[stat.id] ?? 0) + Number(otros[stat.id] ?? 0));
		}

		// Skip si nada cambió
		const canSkip =
			prev &&
			prev.enabled === true &&
			prev.signature === signature &&
			JSON.stringify(prev.personal) === JSON.stringify(personal) &&
			JSON.stringify(prev.otros) === JSON.stringify(otros) &&
			JSON.stringify(prev.equip) === JSON.stringify(equipTotals) &&
			JSON.stringify(prev.total) === JSON.stringify(total);
		if (canSkip) continue;

		writeLayerIfChanged("equipamiento", player, identity, equipTotals, prev?.equip);
		writeLayerIfChanged("total", player, identity, total, prev?.total);

		if (shouldDebugEmit(cfg, playerKey)) {
			const msg = `§8[lecture] wrote layers (signatureChanged=${prev?.signature !== signature})`;
			debugLog(cfg, msg);
			debugTellPlayer(cfg, player, msg);
		}

		if (playerKey) {
			cacheByPlayerKey.set(playerKey, {
				enabled: true,
				signature,
				equip: equipTotals,
				personal,
				otros,
				total,
			});
		}
	}

	// Limpieza cache
	for (const key of cacheByPlayerKey.keys()) {
		if (!active.has(key)) cacheByPlayerKey.delete(key);
	}
}

export function initLecture(userConfig = lectureConfig) {
	if (didInit) return;
	didInit = true;

	const cfg = userConfig ?? lectureConfig;

	// Asegura defaults por jugador cuando spawnea (pero sin crear objectives).
	try {
		world.afterEvents.playerSpawn.subscribe((ev) => {
			try {
				const player = ev?.player;
				if (!player) return;
				const identity = player.scoreboardIdentity;
				const enabledScore = getScoreIdentityOrDefault(GATE_OBJECTIVE, identity, player.name, 0);
				if (Number(enabledScore) < 1) return;
				ensurePersonalDefaults(cfg, player, identity);
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}

	const loopTicks = Math.max(1, Math.trunc(cfg?.loopTicks ?? 10));
	system.runInterval(() => tickLecture(cfg), loopTicks);
}
