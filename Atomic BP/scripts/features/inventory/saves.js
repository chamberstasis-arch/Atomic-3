import * as mc from "@minecraft/server";
import { world, system, EquipmentSlot } from "@minecraft/server";
//test
const DEFAULT_OPTIONS = {
  slots: 10,
  loopTicks: 5,
  keyPrefix: "atomic:inv:"
};

function keyFor(prefix, num) {
  return `${prefix}${num}`;
}

function snapshotEnchantments(item) {
  try {
    const enchComp = item && typeof item.getComponent === "function" ? item.getComponent("minecraft:enchantable") : null;
    if (!enchComp || typeof enchComp.getEnchantments !== "function") return [];
    const enchantments = enchComp.getEnchantments();
    if (!enchantments || typeof enchantments[Symbol.iterator] !== "function") return [];
    const out = [];
    for (const e of enchantments) {
      const typeId = e?.type?.id ?? e?.typeId ?? e?.id;
      const level = Math.trunc(Number(e?.level));
      if (!typeId || !Number.isFinite(level)) continue;
      out.push({ typeId: String(typeId), level });
    }
    return out;
  } catch (e) {
    void e;
    return [];
  }
}


// ---------- Item serialization ----------
function snapshotItem(it) {
  if (!it) return null;
  return {
    typeId: it.typeId,
    amount: it.amount,
    data: it.data, // Se conserva (compat), aunque no siempre se puede re-aplicar tal cual.
    nameTag: it.nameTag,
    lore: it.getLore(),
    enchantments: snapshotEnchantments(it)
  };
}

function buildItem(data) {
  if (!data) return undefined;

  let item;
  try {
    item = new mc.ItemStack(String(data.typeId), Math.max(1, Math.trunc(Number(data.amount) || 1)));
  } catch (e) {
    void e;
    return undefined;
  }

  if (data.nameTag) item.nameTag = data.nameTag;
  if (data.lore && data.lore.length) item.setLore(data.lore);

  // Restaurar encantamientos si el ítem es enchantable
  const enchComp = item.getComponent("minecraft:enchantable");
  if (enchComp && Array.isArray(data.enchantments) && data.enchantments.length) {
    for (const e of data.enchantments) {
      try {
        const type = mc.EnchantmentTypes?.get?.(String(e.typeId)) ?? new mc.EnchantmentType(String(e.typeId));
        enchComp.addEnchantment({ type, level: Math.trunc(Number(e.level)) });
      } catch (err) {
        void err;
        // Si el encantamiento no aplica o level inválido, se ignora para no romper la carga.
      }
    }
  }

  return item;
}


// ---------- Loadout serialization (inv + equipment) ----------
function snapshotPlayerLoadout(player) {
  const invComp = player && typeof player.getComponent === "function" ? player.getComponent("inventory") : null;
  const inv = invComp ? invComp.container : null;
  if (!inv) return null;

  const items = new Array(inv.size);
  for (let slot = 0; slot < inv.size; slot++) {
    items[slot] = snapshotItem(inv.getItem(slot));
  }

  // Equipo (offhand + armadura) con equippable
  const eq = player.getComponent("minecraft:equippable");

  const offhand = snapshotItem(eq ? eq.getEquipment(EquipmentSlot.Offhand) : undefined);

  const armor = {
    head: snapshotItem(eq ? eq.getEquipment(EquipmentSlot.Head) : undefined),
    chest: snapshotItem(eq ? eq.getEquipment(EquipmentSlot.Chest) : undefined),
    legs: snapshotItem(eq ? eq.getEquipment(EquipmentSlot.Legs) : undefined),
    feet: snapshotItem(eq ? eq.getEquipment(EquipmentSlot.Feet) : undefined)
  };

  return { items, offhand, armor };
}

/**
 * Hace el loadout retrocompatible para que guardados viejos no truenen:
 * - Si falta "items", crea array del tamaño del inventario.
 * - Si falta "offhand", lo pone en null.
 * - Si falta "armor" o algún slot, lo pone en null.
 */
function normalizeLoadout(loadout, invSize) {
  const out = (loadout && typeof loadout === "object") ? loadout : {};

  if (!Array.isArray(out.items)) out.items = new Array(invSize).fill(null);
  if (!("offhand" in out)) out.offhand = null;

  if (!out.armor || typeof out.armor !== "object") {
    out.armor = { head: null, chest: null, legs: null, feet: null };
  } else {
    if (out.armor.head === undefined || out.armor.head === null) out.armor.head = null;
    if (out.armor.chest === undefined || out.armor.chest === null) out.armor.chest = null;
    if (out.armor.legs === undefined || out.armor.legs === null) out.armor.legs = null;
    if (out.armor.feet === undefined || out.armor.feet === null) out.armor.feet = null;
  }

  return out;
}

function applyPlayerLoadout(player, loadout) {
  const invComp = player && typeof player.getComponent === "function" ? player.getComponent("inventory") : null;
  const inv = invComp ? invComp.container : null;
  if (!inv) return false;

  const data = normalizeLoadout(loadout, inv.size);

  // Inventario principal
  for (let slot = 0; slot < inv.size; slot++) {
    inv.setItem(slot, buildItem(data.items[slot]));
  }

  // Equipo con equippable (incluye offhand)
  const eq = player.getComponent("minecraft:equippable");
  if (eq) {
    eq.setEquipment(EquipmentSlot.Offhand, buildItem(data.offhand));

    eq.setEquipment(EquipmentSlot.Head, buildItem(data.armor.head));
    eq.setEquipment(EquipmentSlot.Chest, buildItem(data.armor.chest));
    eq.setEquipment(EquipmentSlot.Legs, buildItem(data.armor.legs));
    eq.setEquipment(EquipmentSlot.Feet, buildItem(data.armor.feet));
  }

  return true;
}

// ---------- Storage (dynamic properties) ----------
function trySave(player, num, options) {
  const loadout = snapshotPlayerLoadout(player);
  if (!loadout) return;

  const jsonStr = JSON.stringify(loadout);
  player.setDynamicProperty(keyFor(options.keyPrefix, num), jsonStr);
}

function tryLoad(player, num, options) {
  const raw = player.getDynamicProperty(keyFor(options.keyPrefix, num));
  if (typeof raw !== "string" || raw.length === 0) return;

  let loadout;
  try {
    loadout = JSON.parse(raw);
  } catch (e) {
    void e;
    return;
  }

  applyPlayerLoadout(player, loadout);
}

// ---------- Public API ----------
/**
 * Inicializa guardado/carga por tags:
 * - save_item1..save_itemN => guarda inventario + offhand + armadura en dynamic properties
 * - load_item1..load_itemN => carga inventario + offhand + armadura desde dynamic properties
 */
export function initInventorySaves(userOptions = {}) {
  const options = {
    slots: DEFAULT_OPTIONS.slots,
    loopTicks: DEFAULT_OPTIONS.loopTicks,
    keyPrefix: DEFAULT_OPTIONS.keyPrefix,
  };
  if (userOptions && typeof userOptions === "object") {
    if (userOptions.slots != null) options.slots = userOptions.slots;
    if (userOptions.loopTicks != null) options.loopTicks = userOptions.loopTicks;
    if (userOptions.keyPrefix != null) options.keyPrefix = userOptions.keyPrefix;
  }

  world.afterEvents.worldLoad.subscribe(() => {
    system.runInterval(() => {
      for (const player of world.getPlayers()) {
        // Optimización: si no hay triggers, no hagas nada
        const tags = player.getTags();
        const hasTrigger = tags.some(
          t => t.startsWith("save_item") || t.startsWith("load_item")
        );
        if (!hasTrigger) continue;

        for (let num = 1; num <= options.slots; num++) {
          const saveTag = `save_item${num}`;
          if (player.hasTag(saveTag)) {
            trySave(player, num, options);
            player.removeTag(saveTag);
          }
        }

        for (let num = 1; num <= options.slots; num++) {
          const loadTag = `load_item${num}`;
          if (player.hasTag(loadTag)) {
            tryLoad(player, num, options);
            player.removeTag(loadTag);
          }
        }
      }
    }, options.loopTicks);
  });
}
