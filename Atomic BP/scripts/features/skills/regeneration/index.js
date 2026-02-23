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
	selectActiveModifier,
} from "./modifiers.js";
import { runDropsTable } from "./drops.js";
import { validateMiningRegenConfig } from "./validate.js";
import { upsertTemporaryTitle } from "../../../systems/titlesPriority/index.js";
import {
	computeRemainingTicks,
	initSkillRegenDynamicProperties,
	isExpired,
	loadPendingEntries,
	makePendingKey,
	processEntriesInBatches,
	savePendingEntries,
} from "./persistence.js";

let didInit = false;

function nowMs() {
	return Date.now();
}

function makeKeyFromPos(dimensionId, pos) {
	// Formato único de key para runtime y persistencia.
	return `${String(dimensionId)}:${pos.x}:${pos.y}:${pos.z}`;
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

function getSkillProgressObjectiveIds(config, skill, xpRule) {
	const bySkill = config?.runtime?.titles?.progressObjectivesBySkill;
	const key = normalizeSkillId(skill);
	const runtimeSkill = bySkill && typeof bySkill === "object" ? bySkill[key] : null;

	const fallbackBySkill = {
		mining: { xp: "SkillXpMineria", level: "SkillLvlMineria" },
		foraging: { xp: "SkillXpTala", level: "SkillLvlTala" },
		farming: { xp: "SkillXpCosecha", level: "SkillLvlCosecha" },
	};

	const fallback = fallbackBySkill[key] || null;
	const xpObjective = String(xpRule?.gainObjective ?? runtimeSkill?.xp ?? fallback?.xp ?? "").trim();
	const levelObjective = String(xpRule?.levelObjective ?? runtimeSkill?.level ?? fallback?.level ?? "").trim();
	return { xpObjective, levelObjective };
}

function getProvisionalRequirementPerLevel(config) {
	const raw = Number(config?.runtime?.titles?.provisional?.requirementPerLevel);
	if (!Number.isFinite(raw) || raw <= 0) return 50;
	return Math.max(1, Math.trunc(raw));
}

function computeProvisionalXpRequirement(config, level) {
	const lvl = Math.max(0, Math.trunc(Number(level) || 0));
	const base = getProvisionalRequirementPerLevel(config);
	return Math.max(base, (lvl + 1) * base);
}

function buildXpTitlePayload(config, player, blockDef, xpRule, xpGain) {
	const skill = normalizeSkillId(blockDef?.skill);
	const gain = Math.max(0, Math.trunc(Number(xpGain?.gain) || 0));
	const objectiveIds = getSkillProgressObjectiveIds(config, skill, xpRule);

	const currentXp = objectiveIds.xpObjective ? (getScoreBestEffort(player, objectiveIds.xpObjective) ?? 0) : 0;
	const currentLevel = objectiveIds.levelObjective ? (getScoreBestEffort(player, objectiveIds.levelObjective) ?? 0) : 0;
	const xpActual = Math.max(0, currentXp + gain);
	const xpRequeriment = computeProvisionalXpRequirement(config, currentLevel);

	return {
		xpGain: gain,
		xpActual,
		xpRequeriment,
		xpRequirement: xpRequeriment,
		skill,
		skillXpObjective: objectiveIds.xpObjective,
		skillLvlObjective: objectiveIds.levelObjective,
	};
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

function resolveXpGain(xpRule, player) {
	if (!xpRule || typeof xpRule !== "object") return null;
	const base = Math.trunc(Number(xpRule.base));
	if (!Number.isFinite(base) || base <= 0) return null;

	const per = Math.max(1, Math.trunc(Number(xpRule.stepPerPoints ?? xpRule.perPoints ?? 10) || 10));
	const objective = String(xpRule.scalingObjective ?? "").trim();
	if (!objective) return { gain: base, stat: 0, multiplier: 1 };

	const stat = getScoreBestEffort(player, objective) ?? 0;
	const multiplier = Math.max(1, Math.trunc(stat / per));
	const gain = Math.max(0, Math.trunc(base * multiplier));
	return { gain, stat, multiplier };
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
	if (!player || !selected || !xpGain || xpGain.gain <= 0) return;
	const titleRule = getModifierTitleRule(selected);
	const defaults = getTitleDefaults(config);
	if (titleRule && titleRule.enabled !== true) return;
	if (!titleRule && !defaults.enabledByDefault) return;

	const payload = buildXpTitlePayload(config, player, blockDef, xpRule, xpGain);
	const content = renderTitleContent(titleRule.content ?? defaults.contentTemplate, payload);

	upsertTemporaryTitle({
		target: player,
		source: String(titleRule.source ?? defaults.source),
		id: String(titleRule.id ?? `xp_${String(blockDef?.skill ?? "unknown")}`),
		priority: Number.isFinite(Number(titleRule.priority)) ? Number(titleRule.priority) : defaults.priority,
		durationTicks: Number.isFinite(Number(titleRule.durationTicks)) ? Number(titleRule.durationTicks) : defaults.durationTicks,
		durationMs: Number.isFinite(Number(titleRule.durationMs)) ? Number(titleRule.durationMs) : undefined,
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

function isTraceTargetBlock(blockTypeId) {
	const t = String(blockTypeId != null ? blockTypeId : "");
	return t === "minecraft:coal_ore" || t === "minecraft:deepslate_coal_ore";
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
				tell(player, `§8[mining] sounds=${played}/${sounds.length} via=${via}`);
			}
			if (debugEnabled(config) && played === 0) dbg(config, "sound: no se pudo reproducir ningún sonido");
		});
	} catch (e) {
		void e;
		dbg(config, "sound: excepción inesperada");
	}
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

function setBlockTypeSafe(dimension, pos, blockTypeId) {
	try {
		const block = dimension.getBlock(pos);
		if (!block) return false;

		// Preferir permutation (más estable en varias versiones)
		if (mc?.BlockPermutation?.resolve && typeof block.setPermutation === "function") {
			const perm = mc.BlockPermutation.resolve(String(blockTypeId));
			block.setPermutation(perm);
			return true;
		}

		// Fallback
		if (typeof block.setType === "function") {
			block.setType(String(blockTypeId));
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
			const blocksCount = Array.isArray(config.blocks)
				? config.blocks.length
				: 0;
			dbg(config, `Config recargada: areas=${Array.isArray(config.areas) ? config.areas.length : 0} blocks=${blocksCount}`);
		}
	}

	// Cache runtime: evita doble drop en el mismo bloque durante cooldown.
	/** @type {Map<string, any>} */
	const pendingByKey = new Map();
	// Keys "en vuelo": un evento ya cancelado que se procesará en el siguiente tick.
	/** @type {Set<string>} */
	const processingKeys = new Set();

	function snapshotPendingEntries() {
		return Array.from(pendingByKey.values());
	}

	function persist() {
		savePendingEntries(config, snapshotPendingEntries());
	}

	function removePendingByKey(key) {
		pendingByKey.delete(key);
		persist();
	}

	function scheduleRestore(entry) {
		const key = makePendingKey(entry);
		pendingByKey.set(key, entry);
		const ticks = computeRemainingTicks(entry, ticksPerSecond);

		system.runTimeout(() => {
			try {
				// Verificación final: solo restaurar si aún está el minedBlockId.
				const dim = safeGetDimension(entry.dimensionId);
				if (!dim) {
					// Si la dimensión no existe, reintentar más adelante.
					entry.restoreAt = nowMs() + getPersistenceRetryDelayMs(config);
					scheduleRestore(entry);
					persist();
					return;
				}

				const pos = { x: entry.x, y: entry.y, z: entry.z };
				const current = getBlockTypeIdSafe(dim, pos);
				if (current !== entry.minedBlockId) {
					// Se cambió externamente: no restaurar.
					removePendingByKey(key);
					return;
				}

				setBlockTypeSafe(dim, pos, entry.blockId);
				removePendingByKey(key);
			} catch (e) {
				void e;
				// Reintento suave
				try {
					entry.restoreAt = nowMs() + getPersistenceRetryDelayMs(config);
					pendingByKey.set(key, entry);
					scheduleRestore(entry);
					persist();
				} catch (e2) {
					void e2;
				}
			}
		}, ticks);
	}

	function addPending(entry) {
		const key = makePendingKey(entry);
		if (pendingByKey.has(key)) return false;
		pendingByKey.set(key, entry);
		persist();
		scheduleRestore(entry);
		return true;
	}

	// Boot restore:
	// - Si el mundo se cerró con bloques en mined-state, al volver a entrar los restauramos ENSEGUIDA.
	// - Esto evita acumulación de entries y elimina el caso "se queda eterno" si un timer no se reprograma.
	function restoreAllPendingImmediately(reason) {
		try {
			dbg(config, `${reason}: cargando pendientes...`);
			const loaded = loadPendingEntries(config);
			pendingByKey.clear();
			for (const e of loaded) {
				const k = makePendingKey(e);
				const prev = pendingByKey.get(k);
				if (!prev || Number(e.restoreAt) < Number(prev.restoreAt)) pendingByKey.set(k, e);
			}
			dbg(config, `${reason}: pendientes=${pendingByKey.size}`);

			processEntriesInBatches(
				config,
				snapshotPendingEntries(),
				(entry) => {
					const key = makePendingKey(entry);
					const dim = safeGetDimension(entry.dimensionId);
					if (!dim) {
						removePendingByKey(key);
						return;
					}

					const pos = { x: entry.x, y: entry.y, z: entry.z };
					const current = getBlockTypeIdSafe(dim, pos);
					if (current !== entry.minedBlockId) {
						removePendingByKey(key);
						return;
					}

					// Restaurar SIEMPRE al iniciar (sin importar restoreAt)
					setBlockTypeSafe(dim, pos, entry.blockId);
					removePendingByKey(key);
				},
				() => {
					// Al final, persistimos la lista actual (idealmente vacía)
					persist();
					dbg(config, `${reason}: restore complete`);
				}
			);
		} catch (e) {
			void e;
		}
	}

	// Ejecutar restore en el primer tick (evita early_execution)
	system.run(() => restoreAllPendingImmediately("boot"));

	// Mantener worldLoad como redundancia (según versión/API puede o no disparar)
	try {
		world?.afterEvents?.worldLoad?.subscribe?.(() => {
			system.run(() => restoreAllPendingImmediately("worldLoad"));
		});
	} catch (e) {
		void e;
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

			// Traza gamemode (solo si está en modo trace)
			if (debugTellPlayer(config) && debugTraceBreak(config)) {
				const gmName = getGameModeNameBestEffort(player);
				if (gmName) tell(player, `§8[mining] gm=${gmName}`);
			}

			// Bypass Creative
			if (isCreativeBestEffort(player)) return;

			const block = ev.block;
			const blockPos = block.location;
			const dimensionId = String(dim.id != null ? dim.id : "");

			// Traza de prueba: confirmar que el evento corre y qué datos entrega.
			if (debugTellPlayer(config) && debugTraceBreak(config)) {
				tell(player, `§8[mining] dim=${dimensionId} block=${block.typeId} @ ${blockPos.x},${blockPos.y},${blockPos.z}`);
			}

			const isTargetTrace = debugTellPlayer(config) && debugTraceBreak(config) && isTraceTargetBlock(block.typeId);
			if (isTargetTrace) {
				const areasCount = Array.isArray(config.areas) ? config.areas.length : 0;
				const blocksCount = Array.isArray(config.blocks)
					? config.blocks.length
					: 0;
				tell(player, `§8[mining] cfg areas=${areasCount} blocks=${blocksCount}`);
			}

			const blockDef = getBlockDefinition(registry, block.typeId);
			if (!blockDef) {
				if (isTargetTrace) tell(player, "§c[mining] ore NO registrado en config");
				return;
			}

			// Validación de área (soporta áreas dinámicas por bloque)
			const inArea = isInAnyArea(dimensionId, blockPos, config.areas, blockDef.areaIds);
			if (!inArea) {
				if (isTargetTrace) tell(player, "§c[mining] fuera de area (no aplica)");
				return;
			}
			if (isTargetTrace) tell(player, "§a[mining] area=ok");
			if (isTargetTrace) tell(player, `§a[mining] block=ok skill=${blockDef.skill} regen=${blockDef.regenSeconds}s mined=${blockDef.minedBlockId}`);

			const key = makeKeyFromPos(dimensionId, blockPos);
			const originalBlockTypeId = String(block.typeId != null ? block.typeId : "");

			// Si ya está pendiente, cancelamos el break para evitar drops vanilla y duplicación.
			if (pendingByKey.has(key) || processingKeys.has(key)) {
				if (isTargetTrace) tell(player, "§e[mining] ya pendiente => cancel");
				ev.cancel = true;
				return;
			}

			// Cancelar el break vanilla (evita drops vanilla)
			ev.cancel = true;
			if (isTargetTrace) tell(player, "§a[mining] cancel=true (procesando next tick)");

			// Importante (2.4.0 stable): en early_execution, cambiar bloques puede fallar.
			// Por eso, hacemos el procesamiento en el siguiente tick.
			// Reservamos la key solo como "en procesamiento" para evitar spam/duplicación por mantener click.
			processingKeys.add(key);

			// Sonido inmediato (antes del set mined-state), para que suene al instante.
			// En modo trace, mostramos qué ruta se usó.
			playMineSoundBestEffort(config, player, dim, blockPos, blockDef, isTargetTrace);

			system.run(() => {
				try {
					if (!config || !config.enabled) {
						processingKeys.delete(key);
						return;
					}

					// Seguridad extra: si el jugador está en Creative, no aplicar mined-state/drops.
					if (isCreativeBestEffort(player)) {
						processingKeys.delete(key);
						return;
					}

					// Verificar que el bloque sigue siendo el original (si otro sistema lo cambió, abortar)
					const current = getBlockTypeIdSafe(dim, blockPos);
					if (current !== originalBlockTypeId) {
						if (isTargetTrace) tell(player, `§c[mining] abort: bloque cambió (${current})`);
						processingKeys.delete(key);
						return;
					}

					const didSetMinedState = setBlockTypeSafe(dim, blockPos, blockDef.minedBlockId);
					if (!didSetMinedState) {
						dbg(config, `No se pudo setear minedState=${blockDef.minedBlockId} en ${key}`);
						if (isTargetTrace) tell(player, "§c[mining] mined-state FAIL (no se puede aplicar)" );
						processingKeys.delete(key);
						return;
					}
					if (isTargetTrace) tell(player, "§a[mining] mined-state=ok" );

						// Sonido configurable: ya se intentó inmediato arriba.
						// (No lo repetimos aquí para evitar doble sonido.)

					// Resolver modifier scoreboard-driven.
					const selected = selectActiveModifier(blockDef, {
						player,
						blockDef,
						dimensionId,
						blockPos,
						areas: Array.isArray(config?.areas) ? config.areas : [],
					});
					const dropsTable = resolveDropsTable(blockDef, selected);

					// Partículas: best-effort (keys configurables)
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
						// best-effort: no rompemos el minado por partículas
					}

					// Dropear items custom
					const spawned = runDropsTable(dim, blockPos, dropsTable);

						// XP (orbes) configurable
						spawnXpOrbsBestEffort(config, dim, blockPos, blockDef);
					if (debugTellPlayer(config)) {
							tell(player, `§7[mining] drops=${spawned} skill=${blockDef.skill} regen=${blockDef.regenSeconds}s`);
					}

					// Métricas (scoreboards) + XP skill-aware - best-effort
					{
						const globalAdds = metricsEnabled(config) ? getScoreboardAddsOnBreak(config) : null;
						const blockAdds = blockDef && blockDef.scoreboardAddsOnBreak && typeof blockDef.scoreboardAddsOnBreak === "object" ? blockDef.scoreboardAddsOnBreak : null;
						const modifierAdds = getModifierScoreboardAdds(selected);

						let xpAdds = null;
						const xpRule = getModifierXpRule(selected);
						const xpGain = resolveXpGain(xpRule, player);
							if (xpRule && xpGain && xpGain.gain > 0) {
							const gainObjective = String(xpRule.gainObjective ?? "").trim();
							if (gainObjective) xpAdds = { [gainObjective]: xpGain.gain };
								emitXpTitleBestEffort(config, player, blockDef, selected, xpRule, xpGain);
						}

						const merged = mergeScoreboardAdds(mergeScoreboardAdds(mergeScoreboardAdds(globalAdds, blockAdds), modifierAdds), xpAdds);
						if (merged) applyScoreboardAddsBestEffort(config, dim, player, merged);
					}

					// Registrar regeneración (esto también mete key en persistencia)
					const entry = {
						dimensionId,
						x: blockPos.x,
						y: blockPos.y,
						z: blockPos.z,
						// Guardamos el bloque original real (importante para matches prefix/any)
						blockId: originalBlockTypeId,
						minedBlockId: blockDef.minedBlockId,
						restoreAt: nowMs() + blockDef.regenSeconds * 1000,
					};
					// Pasamos de "processing" a "pending" real.
					processingKeys.delete(key);
					addPending(entry);
				} catch (e) {
					void e;
					processingKeys.delete(key);
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
