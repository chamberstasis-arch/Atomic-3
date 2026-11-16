// combat/spawns/spawner.js
// Instanciación de mobs desde templates: selección ponderada, spawn, equipamiento,
// scores, efectos, y takeover de entidades existentes.

import { system, ItemStack, EquipmentSlot, EnchantmentType, EnchantmentTypes, world } from "@minecraft/server";

/**
 * @typedef {object} EquipmentItemConfig
 * @property {string} typeId              ID del item (vanilla o custom, e.g. "minecraft:iron_sword", "atomic:espada_rubi")
 * @property {string} [nameTag]           Nombre visible del item (soporta §-color codes)
 * @property {string[]} [lore]            Líneas de lore del item
 * @property {number} [amount]            Cantidad (default 1)
 * @property {boolean} [keepOnDeath]      Mantener al morir
 * @property {string[]} [canDestroy]      Lista de bloques que puede destruir (adventure mode)
 * @property {string[]} [canPlaceOn]      Lista de bloques donde se puede colocar (adventure mode)
 * @property {Array<{typeId?:string, id?:string, level?:number}>} [enchantments] Encantamientos
 * @property {Array<{typeId?:string, id?:string, level?:number}>} [enchants]     Alias de enchantments
 */
import { zoneTag } from "./population.js";

const DEFAULT_EFFECT_DURATION = 20000000; // Máximo de la API Bedrock addEffect()
const EQUIPMENT_RETRY_DELAYS = [0, 3, 10, 20];
export const TEMPLATE_TAG_PREFIX = "atomic_tpl_";
const weightedPoolCache = new WeakMap();

// ── Debug ──
let _debugEnabled = false;

export function setSpawnerDebug(enabled) {
	_debugEnabled = !!enabled;
}

function debugLog(msg) {
	if (!_debugEnabled) return;
	try { world.sendMessage(`§8[Spawner] ${msg}`); } catch (_e) { void _e; }
}

function createLogger(verbose) {
	return verbose === false ? () => {} : debugLog;
}

const SLOT_MAP = {
	head: EquipmentSlot.Head,
	chest: EquipmentSlot.Chest,
	legs: EquipmentSlot.Legs,
	feet: EquipmentSlot.Feet,
	mainhand: EquipmentSlot.Mainhand,
	offhand: EquipmentSlot.Offhand,
};
// Mapa de slots a nombres de comando Bedrock para /replaceitem y /item replace.
// Incluye TODOS los slots (armor + weapon), no solo armor.
const COMMAND_SLOT_MAP = {
	head: "slot.armor.head",
	chest: "slot.armor.chest",
	legs: "slot.armor.legs",
	feet: "slot.armor.feet",
	mainhand: "slot.weapon.mainhand",
	offhand: "slot.weapon.offhand",
};

/** @type {Map<string, import("@minecraft/server").ScoreboardObjective>} */
const objectiveCache = new Map();

function getObjectiveBestEffort(objectiveId) {
	const key = String(objectiveId ?? "").trim();
	if (!key) return null;

	const cached = objectiveCache.get(key);
	if (cached?.isValid) return cached;
	if (cached && !cached.isValid) objectiveCache.delete(key);

	try {
		const objective = world.scoreboard.getObjective(key)
			?? world.scoreboard.addObjective(key, key);
		if (!objective) return null;
		objectiveCache.set(key, objective);
		return objective;
	} catch (e) {
		void e;
		return null;
	}
}

function getWeightedPool(zone, templates) {
	const cached = weightedPoolCache.get(zone);
	if (cached) return cached;

	let totalWeight = 0;
	const weighted = [];
	for (const id of zone.templatePool) {
		const tpl = templates[id];
		if (!tpl) continue;
		const w = typeof tpl.weight === "number" && tpl.weight > 0 ? tpl.weight : 1;
		totalWeight += w;
		weighted.push({ id, weight: w });
	}

	const built = { weighted, totalWeight };
	weightedPoolCache.set(zone, built);
	return built;
}

function getConfiguredItemTypeId(data) {
	const typeId = String(data?.typeId ?? data?.itemId ?? "").trim();
	return typeId || "";
}

function getConfiguredEnchantments(data) {
	return Array.isArray(data?.enchantments)
		? data.enchantments
		: Array.isArray(data?.enchants)
			? data.enchants
			: [];
}

function sanitizeTemplateId(templateId) {
	return String(templateId ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
}

export function buildTemplateIdentityTag(templateId) {
	const safeId = sanitizeTemplateId(templateId);
	return safeId ? `${TEMPLATE_TAG_PREFIX}${safeId}` : "";
}

function syncTemplateIdentityTag(entity, templateId) {
	const nextTag = buildTemplateIdentityTag(templateId);
	if (!entity || !nextTag) return "";

	try {
		const tags = entity.getTags?.() ?? [];
		for (const tag of tags) {
			if (!tag.startsWith(TEMPLATE_TAG_PREFIX) || tag === nextTag) continue;
			try { entity.removeTag(tag); } catch (e) { void e; }
		}
	} catch (e) {
		void e;
	}

	try {
		entity.addTag(nextTag);
		return nextTag;
	} catch (e) {
		void e;
		return "";
	}
}

/**
 * Selecciona un template ponderado aleatoriamente del pool de la zona.
 * @param {{ templatePool: string[] }} zone
 * @param {{ [key: string]: { weight?: number } }} templates
 * @returns {string | null} templateId seleccionado, o null si no hay pool
 */
export function selectTemplate(zone, templates) {
	const pool = zone.templatePool;
	if (!Array.isArray(pool) || pool.length === 0) return null;

	const { weighted, totalWeight } = getWeightedPool(zone, templates);
	if (weighted.length === 0 || totalWeight <= 0) return null;

	let roll = Math.random() * totalWeight;
	for (const entry of weighted) {
		roll -= entry.weight;
		if (roll <= 0) return entry.id;
	}
	return weighted[weighted.length - 1].id;
}

// ──────────────────────────────────────────────────────────
// Item / Equipment
// ──────────────────────────────────────────────────────────

/**
 * Crea un ItemStack a partir de una configuración de equipamiento.
 * Soporta: typeId (vanilla/custom), nameTag, lore, amount, enchantments,
 * keepOnDeath, canDestroy, canPlaceOn.
 *
 * @param {EquipmentItemConfig | null | undefined} data
 * @returns {ItemStack | null}
 */
export function buildItemStack(data) {
	const typeId = getConfiguredItemTypeId(data);
	if (!data || !typeId) return null;
	try {
		const amount = Math.max(1, Math.trunc(Number(data.amount ?? 1))) || 1;
		const item = new ItemStack(typeId, amount);

		// Nombre visible (soporta § color codes)
		if (typeof data.nameTag === "string" && data.nameTag) {
			try { item.nameTag = data.nameTag; } catch (_e) { void _e; }
		}

		// Lore
		if (Array.isArray(data.lore) && data.lore.length > 0) {
			try { item.setLore(data.lore.map((l) => String(l))); } catch (_e) { void _e; }
		}

		// Encantamientos
		const enchantments = getConfiguredEnchantments(data);
		if (enchantments.length > 0) {
			const enchComp = item.getComponent("minecraft:enchantable");
			if (enchComp) {
				for (const e of enchantments) {
					try {
						const typeId = String(e.typeId ?? e.id ?? "").trim();
						if (!typeId) continue;
						const type = EnchantmentTypes?.get?.(typeId) ?? new EnchantmentType(typeId);
						enchComp.addEnchantment({
							type,
							level: Math.max(1, Math.trunc(Number(e.level ?? 1))),
						});
					} catch (err) {
						void err;
					}
				}
			}
		}

		// Keep on death
		if (data.keepOnDeath === true) {
			try {
				if ("keepOnDeath" in item) {
					item.keepOnDeath = true;
				}
			} catch (_e) { void _e; }
		}

		// canDestroy (adventure mode)
		if (Array.isArray(data.canDestroy) && data.canDestroy.length > 0) {
			try {
				if (typeof item.setCanDestroy === "function") {
					item.setCanDestroy(data.canDestroy.map((b) => String(b)));
				}
			} catch (_e) { void _e; }
		}

		// canPlaceOn (adventure mode)
		if (Array.isArray(data.canPlaceOn) && data.canPlaceOn.length > 0) {
			try {
				if (typeof item.setCanPlaceOn === "function") {
					item.setCanPlaceOn(data.canPlaceOn.map((b) => String(b)));
				}
			} catch (_e) { void _e; }
		}

		return item;
	} catch (e) {
		void e;
		return null;
	}
}

/**
 * Determina si un item config tiene propiedades enriquecidas (nameTag, lore, enchantments, etc.)
 * que requieren re-aplicar el item completo incluso si el typeId ya coincide.
 */
function isEnrichedItemConfig(data) {
	if (!data) return false;
	if (typeof data.nameTag === "string" && data.nameTag) return true;
	if (Array.isArray(data.lore) && data.lore.length > 0) return true;
	if (getConfiguredEnchantments(data).length > 0) return true;
	if (data.keepOnDeath === true) return true;
	if (Array.isArray(data.canDestroy) && data.canDestroy.length > 0) return true;
	if (Array.isArray(data.canPlaceOn) && data.canPlaceOn.length > 0) return true;
	return false;
}

/**
 * Aplica equipamiento al mob.
 *
 * Estrategia de 2 niveles por slot:
 *   1) Script API: getComponent("minecraft:equippable") → setEquipment()
 *   2) Comando: /replaceitem entity @s <slot> 0 <item> 1
 *                /item replace entity @s <slot> 0 with <item> 1
 *   Ambos se intentan en CADA intento, no solo en el último.
 */
function getEquippableBestEffort(entity) {
	try {
		return entity?.getComponent?.("minecraft:equippable") ?? null;
	} catch (e) {
		void e;
		return null;
	}
}

function getEquippedTypeIdBestEffort(eq, slot) {
	try {
		return String(eq?.getEquipment?.(slot)?.typeId ?? "").trim();
	} catch (e) {
		void e;
		return "";
	}
}

/**
 * Ejecuta un comando en el contexto de la entidad. Retorna true si no lanza excepción.
 */
function runEntityCommand(entity, command) {
	if (!entity || !command) return false;
	try {
		const result = entity.runCommand(command);
		// runCommand retorna CommandResult con successCount
		return (result?.successCount ?? 0) > 0;
	} catch (e) {
		debugLog(`§c    cmd falló: §7${command} §8→ ${e}`);
		void e;
		return false;
	}
}

function clearSlotByCommand(entity, slotKey) {
	const commandSlot = COMMAND_SLOT_MAP[slotKey];
	if (!commandSlot) return false;

	if (runEntityCommand(entity, `item replace entity @s ${commandSlot} 0 with air`)) return true;
	if (runEntityCommand(entity, `replaceitem entity @s ${commandSlot} 0 air 1 0`)) return true;
	return false;
}

/**
 * Intenta colocar un item en un slot usando comandos de Bedrock.
 * Prueba ambas sintaxis (moderna /item y legacy /replaceitem).
 * TODOS los slots están soportados (armor + weapon).
 */
function equipByCommand(entity, slotKey, itemTypeId) {
	const commandSlot = COMMAND_SLOT_MAP[slotKey];
	if (!commandSlot || !itemTypeId) return false;

	// Bedrock 1.21+ /item replace: slot, slotId, with, item, amount
	if (runEntityCommand(entity, `item replace entity @s ${commandSlot} 0 with ${itemTypeId} 1`)) {
		debugLog(`§a    cmd OK: §7item replace §f${commandSlot} §7→ §f${itemTypeId}`);
		return true;
	}

	// Bedrock legacy /replaceitem: slot, slotId, item, amount, data
	if (runEntityCommand(entity, `replaceitem entity @s ${commandSlot} 0 ${itemTypeId} 1 0`)) {
		debugLog(`§a    cmd OK: §7replaceitem §f${commandSlot} §7→ §f${itemTypeId}`);
		return true;
	}

	return false;
}

/**
 * Intenta colocar un item en un slot usando la Script API de equipamiento.
 * Prueba 2 métodos: setEquipment() directo y getEquipmentSlot().setItem().
 */
function setEquipmentByApi(eq, slot, item) {
	if (!eq || !item) return false;

	try {
		const ok = eq.setEquipment(slot, item);
		if (ok) return true;
	} catch (e) {
		void e;
	}

	try {
		const containerSlot = eq.getEquipmentSlot(slot);
		if (containerSlot) {
			containerSlot.setItem(item);
			return true;
		}
	} catch (e) {
		void e;
	}

	return false;
}

function clearEquipmentSlotByApi(eq, slot) {
	if (!eq) return false;

	try {
		const ok = eq.setEquipment(slot, undefined);
		if (ok) return true;
	} catch (e) {
		void e;
	}

	try {
		const containerSlot = eq.getEquipmentSlot(slot);
		if (containerSlot) {
			containerSlot.setItem(undefined);
			return true;
		}
	} catch (e) {
		void e;
	}

	return false;
}

/**
 * Verifica si un slot ya tiene el item esperado.
 */
function isSlotApplied(eq, slot, expectedTypeId) {
	if (!eq || !expectedTypeId) return false;
	return getEquippedTypeIdBestEffort(eq, slot) === expectedTypeId;
}

export function isManagedEquipmentItem(typeId) {
	const id = String(typeId ?? "").trim().toLowerCase();
	if (!id) return false;
	return (
		/_helmet(?:_(plain|glint))?$/.test(id)
		|| /_chestplate(?:_(plain|glint))?$/.test(id)
		|| /_leggings(?:_(plain|glint))?$/.test(id)
		|| /_boots(?:_(plain|glint))?$/.test(id)
		|| /_sword(?:_(plain|glint))?$/.test(id)
		|| /_axe(?:_(plain|glint))?$/.test(id)
		|| /_pickaxe(?:_(plain|glint))?$/.test(id)
		|| /_hoe(?:_(plain|glint))?$/.test(id)
		|| id.endsWith(":bow")
		|| id.endsWith(":crossbow")
		|| id.endsWith(":trident")
		|| id.endsWith(":shield")
		|| id.endsWith(":elytra")
	);
}

export function clearEquipmentSlotsBestEffort(entity, slotKeys = Object.keys(SLOT_MAP), options = {}) {
	if (!entity) return false;
	const log = createLogger(options.verbose);
	const eq = getEquippableBestEffort(entity);
	let changed = false;

	for (const slotKey of slotKeys) {
		const slot = SLOT_MAP[slotKey];
		if (!slot) continue;

		let hadItem = false;
		if (eq) {
			try {
				hadItem = !!eq.getEquipment(slot);
			} catch (e) {
				void e;
			}
		}

		let cleared = false;
		if (eq) {
			cleared = clearEquipmentSlotByApi(eq, slot);
		}
		if (!cleared) {
			cleared = clearSlotByCommand(entity, slotKey);
		}

		if (cleared || hadItem) changed = true;
		if (hadItem || cleared) {
			log(`§7    clear ${slotKey}: ${cleared ? "§aOK" : "§cfail"}`);
		}
	}

	return changed;
}

/**
 * Verifica si TODO el equipamiento del template ya está aplicado.
 */
function isEquipmentApplied(entity, equipment, options = {}) {
	if (!equipment || typeof equipment !== "object") return true;
	try {
		const eq = getEquippableBestEffort(entity);
		const requireNoUnexpected = options.clearUnexpected === true;

		for (const [key, slot] of Object.entries(SLOT_MAP)) {
			const expectedTypeId = getConfiguredItemTypeId(equipment[key]);
			const currentTypeId = eq ? getEquippedTypeIdBestEffort(eq, slot) : "";
			if (expectedTypeId) {
				if (!eq || !isSlotApplied(eq, slot, expectedTypeId)) return false;
				// Items enriquecidos siempre se consideran "no aplicados" para forzar refresh
				if (isEnrichedItemConfig(equipment[key])) return false;
				continue;
			}
			if (requireNoUnexpected && currentTypeId && isManagedEquipmentItem(currentTypeId)) return false;
		}
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

/**
 * Un solo pase de aplicación de equipamiento.
 * Para cada slot definido en el template:
 *   1. Si el slot ya tiene el item correcto → skip
 *   2. Intenta Script API (setEquipment)
 *   3. Si la API falla o no está disponible → intenta comandos
 */
export function enforceTemplateEquipmentBestEffort(entity, equipment, options = {}) {
	const log = createLogger(options.verbose);
	const clearUnexpected = options.clearUnexpected === true;
	if (!entity) return false;

	try {
		const eq = getEquippableBestEffort(entity);
		log(`§7    equippable component: ${eq ? "§aOK" : "§cNULL"}`);

		for (const [key, slot] of Object.entries(SLOT_MAP)) {
			const itemConfig = equipment?.[key];
			const expectedTypeId = getConfiguredItemTypeId(itemConfig);
			const currentTypeId = eq ? getEquippedTypeIdBestEffort(eq, slot) : "";

			if (!expectedTypeId) {
				if (clearUnexpected && currentTypeId && isManagedEquipmentItem(currentTypeId)) {
					const cleared = clearEquipmentSlotsBestEffort(entity, [key], options);
					log(`§7    ${key} clear unexpected: ${cleared ? "§aOK" : "§cfail"} §f${currentTypeId}`);
				}
				continue;
			}

			const shouldRefresh = isEnrichedItemConfig(itemConfig);
			if (!shouldRefresh && currentTypeId === expectedTypeId) {
				log(`§7    ${key}: §aya aplicado §f${expectedTypeId}`);
				continue;
			}

			let applied = false;
			if (eq) {
				const item = buildItemStack(itemConfig);
				if (item) {
					applied = setEquipmentByApi(eq, slot, item);
					log(`§7    ${key} API: ${applied ? "§aOK" : "§cfail"} §f${expectedTypeId}`);
				}
			}

			if (!applied) {
				applied = equipByCommand(entity, key, expectedTypeId);
				log(`§7    ${key} CMD: ${applied ? "§aOK" : "§cfail"} §f${expectedTypeId}`);
			}
		}
		return true;
	} catch (e) {
		log(`§c    enforceTemplateEquipment error: §7${e}`);
		void e;
		return false;
	}
}

function applyEquipmentWithRetries(entity, equipment, attempt = 0) {
	if (!equipment || typeof equipment !== "object") return;
	let valid = true;
	try { valid = entity?.isValid !== false; } catch (_e) { void _e; }
	if (!valid) {
		debugLog(`§c  Equipment intento ${attempt}: entidad inválida`);
		return;
	}

	debugLog(`§e  Equipment intento ${attempt}/${EQUIPMENT_RETRY_DELAYS.length - 1}`);
	enforceTemplateEquipmentBestEffort(entity, equipment, { clearUnexpected: true, verbose: true });

	const applied = isEquipmentApplied(entity, equipment, { clearUnexpected: true });
	debugLog(`§${applied ? "a" : "c"}  Equipment intento ${attempt} resultado: ${applied ? "§aTODO OK" : "§cpendiente"}`);
	if (applied) return;

	const nextAttempt = attempt + 1;
	if (nextAttempt >= EQUIPMENT_RETRY_DELAYS.length) {
		debugLog("§c  Equipment: TODOS los intentos agotados — verificar en-game");
		return;
	}
	const delay = EQUIPMENT_RETRY_DELAYS[nextAttempt];
	try {
		system.runTimeout(() => {
			applyEquipmentWithRetries(entity, equipment, nextAttempt);
		}, delay);
	} catch (e) {
		void e;
	}
}

// ──────────────────────────────────────────────────────────
// Scores
// ──────────────────────────────────────────────────────────

/**
 * Aplica scores de scoreboard al mob.
 * Si el template no define scores, aplica defaultScores (mínimo H: 1).
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {{ [objective: string]: number } | undefined} templateScores
 * @param {{ [objective: string]: number }} defaultScores
 */
function applyScores(entity, templateScores, defaultScores) {
	const scores = (templateScores && typeof templateScores === "object" && Object.keys(templateScores).length > 0)
		? templateScores
		: (defaultScores ?? { H: 1 });

	let applied = 0;
	let failed = 0;
	for (const [objectiveId, value] of Object.entries(scores)) {
		try {
			const obj = getObjectiveBestEffort(objectiveId);
			if (!obj) { failed++; continue; }
			obj.setScore(entity, Math.trunc(Number(value)));
			applied++;
		} catch (e) {
			failed++;
			debugLog(`§c  Score §f${objectiveId}§c falló: §7${e}`);
			void e;
		}
	}
	debugLog(`§a  Scores: §f${applied}§a ok, §c${failed}§a fail §7(${Object.keys(scores).join(", ")})`);
}

// ──────────────────────────────────────────────────────────
// Effects
// ──────────────────────────────────────────────────────────

/**
 * Aplica efectos de Minecraft al mob.
 * Formato soportado:
 *   effects: { "resistance": 1 }                    → amplifier 1, duración infinita
 *   effects: { "speed": { amplifier: 2, duration: 6000 } } → amplifier 2, 6000 ticks
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {{ [effectId: string]: number | { amplifier: number, duration?: number } } | undefined} effects
 * @param {number} defaultDuration
 */
const MAX_EFFECT_DURATION = 20000000;

function applyEffects(entity, effects, defaultDuration) {
	if (!effects || typeof effects !== "object") return;

	let applied = 0;
	let failed = 0;
	for (const [effectId, config] of Object.entries(effects)) {
		try {
			let amplifier = 0;
			let duration = Math.min(defaultDuration, MAX_EFFECT_DURATION);
			let showParticles = false;

			if (typeof config === "number") {
				amplifier = Math.max(0, Math.trunc(config));
			} else if (config && typeof config === "object") {
				amplifier = Math.max(0, Math.trunc(config.amplifier ?? 0));
				if (typeof config.duration === "number") duration = Math.max(1, Math.min(MAX_EFFECT_DURATION, Math.trunc(config.duration)));
				if (config.showParticles === true) showParticles = true;
			}

			entity.addEffect(effectId, duration, { amplifier, showParticles });
			applied++;
		} catch (e) {
			failed++;
			debugLog(`§c  Efecto §f${effectId}§c falló: §7${e}`);
			void e;
		}
	}
	if (applied + failed > 0) {
		debugLog(`§a  Efectos: §f${applied}§a ok, §c${failed}§a fail §7(${Object.keys(effects).join(", ")})`);
	}
}

function applyDeferredEquipment(entity, template, defaultEffectDuration) {
	let valid = true;
	try { valid = entity?.isValid !== false; } catch (_e) { void _e; }
	if (!valid) {
		debugLog("§c[Deferred] Entidad inválida, abortando equipamiento deferred");
		return;
	}

	// Re-aplicar nameTag como red de seguridad (puede fallar en tick 0)
	if (template.nameTag) {
		try { entity.nameTag = template.nameTag; } catch (_e) { void _e; }
	}

	// Re-aplicar efectos por si fallaron en el tick síncrono
	applyEffects(entity, template.effects, defaultEffectDuration);

	// Equipamiento con reintentos (este SÍ necesita deferirse)
	applyEquipmentWithRetries(entity, template.equipment);

	debugLog(`§a[Deferred] Equipamiento iniciado para §f${template.typeId ?? "?"}`);
}

// ──────────────────────────────────────────────────────────
// Aplicar template completo a entidad
// ──────────────────────────────────────────────────────────

/**
 * Aplica todas las propiedades de un template a una entidad existente:
 * nameTag, tags, scores, effects, equipment.
 * No cambia el typeId (la entidad ya es del tipo correcto).
 *
 * - Scores y efectos se aplican SINCRÓNICAMENTE (tick 0) para que el sistema
 *   de salud y otros sistemas detecten al mob inmediatamente.
 * - Equipamiento se aplica en el siguiente tick con reintentos, porque el
 *   componente equippable puede no responder en el mismo tick del spawn.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {string | undefined} templateId
 * @param {object} template
 * @param {{ [objective: string]: number }} defaultScores
 * @param {number} defaultEffectDuration
 * @param {string} [zoneId]
 */
export function applyTemplateToEntity(entity, templateId, template, defaultScores, defaultEffectDuration, zoneId) {
	if (!entity || !template) return;

	debugLog(`§e[Template] Aplicando §f${template.typeId ?? "?"} §7template=§f${templateId ?? "(unknown)"} §7nameTag=§f${template.nameTag ?? "(none)"} §7zone=§b${zoneId ?? "(none)"}`);

	// ── SÍNCRONO (tick 0): nameTag, tags, scores, efectos ──

	// Nombre visible
	if (template.nameTag) {
		try {
			entity.nameTag = template.nameTag;
			debugLog(`§a  nameTag = §f${template.nameTag}`);
		} catch (e) {
			debugLog(`§c  nameTag FALLÓ: §f${e}`);
			void e;
		}
	}

	// Tags globales de tracking
	try { entity.addTag("atomic_spawned"); } catch (e) { void e; }
	if (zoneId) {
		try { entity.addTag(zoneTag(zoneId)); } catch (e) { void e; }
	}
	syncTemplateIdentityTag(entity, templateId);

	// Tags custom del template
	if (Array.isArray(template.tags)) {
		for (const tag of template.tags) {
			try { entity.addTag(tag); } catch (e) { void e; }
		}
	}

	// Persistencia
	if (template.persistent === true) {
		try { entity.addTag("atomic_persistent"); } catch (e) { void e; }
	}

	// Scores: SÍNCRONO — permite que afterEvents.entitySpawn handlers
	// que dependen de H=1 (como el sistema de salud) detecten al mob en
	// el siguiente escaneo sin esperar al callback deferred.
	applyScores(entity, template.scores, defaultScores);

	// Limpiar equipo vanilla o residual antes de aplicar el template.
	clearEquipmentSlotsBestEffort(entity, Object.keys(SLOT_MAP), { verbose: true });

	// Efectos: intentar SÍNCRONO. Se re-aplican en el callback deferred
	// como red de seguridad por si fallan en tick 0.
	applyEffects(entity, template.effects, defaultEffectDuration);

	// ── DEFERRED (tick +1): equipamiento con reintentos ──
	// El componente equippable puede no responder en el mismo tick del spawn.
	try {
		system.run(() => {
			applyDeferredEquipment(entity, template, defaultEffectDuration);
		});
	} catch (e) {
		void e;
		// Fallback: intentar directamente si system.run() falla
		applyDeferredEquipment(entity, template, defaultEffectDuration);
	}
}

// ──────────────────────────────────────────────────────────
// Spawn de mob desde template
// ──────────────────────────────────────────────────────────

/**
 * Spawna un mob desde un template en la posición indicada.
 * Aplica: nameTag, tags, scores, effects, equipment.
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {string} templateId
 * @param {object} template
 * @param {{ x: number, y: number, z: number }} position
 * @param {string} zoneId
 * @param {{ [objective: string]: number }} [defaultScores]
 * @param {number} [defaultEffectDuration]
 * @returns {import("@minecraft/server").Entity | null}
 */
export function spawnMobFromTemplate(dimension, templateId, template, position, zoneId, defaultScores, defaultEffectDuration) {
	if (!dimension || !template || !template.typeId || !position) return null;
	try {
		debugLog(`§b[Spawn] §f${template.typeId} §7template=§f${templateId ?? "(unknown)"} §7at §e${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)} §7zone=§b${zoneId}`);
		const entity = dimension.spawnEntity(template.typeId, position);
		if (!entity) {
			debugLog("§c[Spawn] spawnEntity retornó null");
			return null;
		}

		applyTemplateToEntity(
			entity,
			templateId,
			template,
			defaultScores ?? { H: 1 },
			defaultEffectDuration ?? DEFAULT_EFFECT_DURATION,
			zoneId
		);

		return entity;
	} catch (e) {
		debugLog(`§c[Spawn] ERROR: §f${e}`);
		void e;
		return null;
	}
}

// ──────────────────────────────────────────────────────────
// Takeover: superposición de entidades existentes
// ──────────────────────────────────────────────────────────

/**
 * Construye un índice de templates por (typeId, nameTag) para búsqueda O(1).
 * Solo templates que tengan AMBOS typeId y nameTag definidos.
 *
 * @param {{ [id: string]: { typeId: string, nameTag?: string } }} templates
 * @returns {Map<string, Map<string, { templateId: string, template: object }>>}
 */
export function buildTakeoverIndex(templates) {
	const index = new Map();
	if (!templates || typeof templates !== "object") return index;

	for (const [id, tpl] of Object.entries(templates)) {
		if (!tpl.typeId || !tpl.nameTag) continue;
		let byName = index.get(tpl.typeId);
		if (!byName) {
			byName = new Map();
			index.set(tpl.typeId, byName);
		}
		byName.set(tpl.nameTag, { templateId: id, template: tpl });
	}
	return index;
}

/**
 * Escanea entidades en la dimensión y transforma aquellas que coincidan
 * en typeId + nameTag con un template. La entidad original se elimina
 * y se spawna una nueva con todas las especificaciones del template.
 *
 * Mobs ya procesados (con processedTag) se ignoran.
 *
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {Map<string, Map<string, { templateId: string, template: object }>>} takeoverIndex
 * @param {string} processedTag
 * @param {{ [objective: string]: number }} defaultScores
 * @param {number} defaultEffectDuration
 * @param {boolean} debugEnabled
 * @returns {number} cantidad de mobs transformados
 */
export function takeoverExistingEntities(dimension, takeoverIndex, processedTag, defaultScores, defaultEffectDuration, debugEnabled) {
	if (takeoverIndex.size === 0) return 0;

	let transformed = 0;

	for (const [typeId, byName] of takeoverIndex) {
		try {
			const candidates = dimension.getEntities({ type: typeId });
			for (const entity of candidates) {
				try {
					if (!entity?.isValid) continue;

					// Ya procesado → skip
					if (typeof entity.hasTag === "function" && entity.hasTag(processedTag)) continue;
					// Ya es un mob del sistema → skip
					if (typeof entity.hasTag === "function" && entity.hasTag("atomic_spawned")) continue;

					// Verificar nameTag exacto
					let entityName;
					try { entityName = entity.nameTag; } catch (e) { void e; continue; }
					const entry = byName.get(entityName);
					if (!entry) continue;
					const { template, templateId } = entry;

					// Match encontrado → aplicar template in-place
					const pos = entity.location;
					if (!pos) continue;

					applyTemplateToEntity(entity, templateId, template, defaultScores, defaultEffectDuration, null);
					try { entity.addTag(processedTag); } catch (e) { void e; }

					transformed++;

					debugLog(`§dTakeover: §f${templateId} §7at §e${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`);
				} catch (e) {
					void e;
				}
			}
		} catch (e) {
			void e;
		}
	}
	return transformed;
}
