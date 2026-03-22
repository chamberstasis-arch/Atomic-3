import { ItemStack, system, world } from "@minecraft/server";
import { hasHEnabled, isPlayerEntity } from "./damage_dealt/scoreboard.js";
import { subscribeOnMobKilledByPlayer } from "./damage_dealt/byplayer/index.js";
import { combatSkillConfig } from "./config.js";
import { resolveMobMatch, snapshotEntityForMatch } from "./match.js";

let didInit = false;
/** @type {Map<string, number>} */
const recentlyHandledDeaths = new Map();

function asStr(value) {
	return String(value != null ? value : "").trim();
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function nowMs() {
	return Date.now();
}

function cleanupHandledDeaths() {
	const now = nowMs();
	for (const [id, ts] of recentlyHandledDeaths.entries()) {
		if (now - ts > 4000) recentlyHandledDeaths.delete(id);
	}
}

function markHandled(entity) {
	const id = asStr(entity?.id);
	if (!id) return;
	recentlyHandledDeaths.set(id, nowMs());
}

function wasHandled(entity) {
	const id = asStr(entity?.id);
	if (!id) return false;
	const ts = recentlyHandledDeaths.get(id);
	if (!ts) return false;
	if (nowMs() - ts > 4000) {
		recentlyHandledDeaths.delete(id);
		return false;
	}
	return true;
}

function isArmorOrEquipmentItem(itemTypeId) {
	const id = asStr(itemTypeId).toLowerCase();
	if (!id) return false;
	return (
		id.endsWith("_helmet") ||
		id.endsWith("_chestplate") ||
		id.endsWith("_leggings") ||
		id.endsWith("_boots") ||
		id.endsWith(":elytra") ||
		id.endsWith(":shield") ||
		id.endsWith("_sword") ||
		id.endsWith("_axe") ||
		id.endsWith("_pickaxe") ||
		id.endsWith("_hoe") ||
		id.endsWith("_trident") ||
		id.endsWith("_bow") ||
		id.endsWith("_crossbow")
	);
}

function safeKillEntity(entity) {
	try {
		if (!entity || entity.isValid === false) return false;
		if (typeof entity.kill === "function") {
			entity.kill();
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		entity?.runCommandAsync?.("kill @s");
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function rollDropEntry(entry) {
	if (!entry || typeof entry !== "object") return null;
	const itemId = asStr(entry.itemId);
	if (!itemId) return null;
	const chance = clamp(Number(entry.chance), 0, 1);
	if (!Number.isFinite(chance) || chance <= 0) return null;
	if (Math.random() > chance) return null;
	const min = Math.max(1, toInt(entry.min, 1));
	const max = Math.max(min, toInt(entry.max, min));
	const amount = Math.floor(Math.random() * (max - min + 1)) + min;
	if (amount <= 0) return null;
	return { itemId, amount };
}

function spawnCustomDrops(dimension, location, matchEntry) {
	if (!dimension || !location || !matchEntry) return;
	const drops = Array.isArray(matchEntry.drops) ? matchEntry.drops : [];
	for (const drop of drops) {
		const rolled = rollDropEntry(drop);
		if (!rolled) continue;
		try {
			const stack = new ItemStack(rolled.itemId, rolled.amount);
			dimension.spawnItem(stack, location);
		} catch (e) {
			void e;
		}
	}
}

function collectNearbyItems(dimension, location, radius) {
	try {
		return dimension.getEntities({ type: "minecraft:item", location, maxDistance: radius }) || [];
	} catch (e) {
		void e;
		return [];
	}
}

function shouldSuppressVanillaDefault(cfg, killer) {
	const allowWhenHZero = cfg?.drops?.allowVanillaWhenKillerHZero !== false;
	if (!killer || !isPlayerEntity(killer)) return true;
	if (hasHEnabled(killer)) return true;
	if (!allowWhenHZero) return true;
	return false;
}

function cleanupVanillaDrops(dimension, location, radius, suppressAll, suppressArmorOnly) {
	const items = collectNearbyItems(dimension, location, radius);
	for (const itemEntity of items) {
		try {
			const itemComp = itemEntity?.getComponent?.("minecraft:item");
			const typeId = asStr(itemComp?.itemStack?.typeId);
			if (!typeId) continue;
			if (suppressAll) {
				safeKillEntity(itemEntity);
				continue;
			}
			if (suppressArmorOnly && isArmorOrEquipmentItem(typeId)) {
				safeKillEntity(itemEntity);
			}
		} catch (e) {
			void e;
		}
	}
}

function processLoot(cfg, deadEntity, killer, snapshot) {
	if (!deadEntity || !snapshot) return;
	if (asStr(snapshot.typeId) === "minecraft:player") return;

	const dimension = deadEntity.dimension;
	const locationRaw = deadEntity.location;
	if (!dimension || !locationRaw) return;
	const location = {
		x: Number(locationRaw.x) + 0.5,
		y: Number(locationRaw.y) + 0.2,
		z: Number(locationRaw.z) + 0.5,
	};

	const match = resolveMobMatch(snapshot, cfg?.mobLoot);
	const cleanupDelayTicks = Math.max(0, toInt(cfg?.drops?.cleanupDelayTicks, 1));
	const radius = clamp(Number(cfg?.drops?.radius ?? 4), 1, 8);
	const defaultSuppress = shouldSuppressVanillaDefault(cfg, killer);
	const allowVanillaByEntry = match?.allowVanilla === true;
	const suppressVanilla = !allowVanillaByEntry && defaultSuppress;
	const alwaysSuppressArmor = cfg?.drops?.alwaysSuppressArmorVanilla !== false;
	const allowArmorByEntry = match?.allowArmorVanilla === true;
	const suppressArmorOnly = !suppressVanilla && alwaysSuppressArmor && !allowArmorByEntry;

	system.runTimeout(() => {
		cleanupVanillaDrops(dimension, location, radius, suppressVanilla, suppressArmorOnly);
		if (match) spawnCustomDrops(dimension, location, match);
	}, cleanupDelayTicks);
}

function handleMobKilledByPlayer(cfg, attacker, target) {
	if (!target) return;
	cleanupHandledDeaths();
	markHandled(target);
	const snapshot = snapshotEntityForMatch(target);
	processLoot(cfg, target, attacker, snapshot);
}

function resolveKillerFromEvent(ev) {
	const fromDamage = ev?.damageSource?.damagingEntity;
	if (fromDamage) return fromDamage;
	return null;
}

export function initCombatLoot(userConfig = undefined) {
	if (didInit) return;
	didInit = true;
	const cfg = userConfig && typeof userConfig === "object" ? userConfig : combatSkillConfig;

	subscribeOnMobKilledByPlayer((attacker, target) => {
		try {
			handleMobKilledByPlayer(cfg, attacker, target);
		} catch (e) {
			void e;
		}
	});

	try {
		world.afterEvents.entityDie.subscribe((ev) => {
			try {
				const deadEntity = ev?.deadEntity;
				if (!deadEntity || deadEntity.typeId === "minecraft:player") return;
				if (wasHandled(deadEntity)) {
					markHandled(deadEntity);
					return;
				}

				const killer = resolveKillerFromEvent(ev);
				const snapshot = snapshotEntityForMatch(deadEntity);
				processLoot(cfg, deadEntity, killer, snapshot);
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}
}
