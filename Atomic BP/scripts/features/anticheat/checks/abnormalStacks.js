import { EquipmentSlot, PlayerPermissionLevel, system, world } from "@minecraft/server";

let didStart = false;

function isOperator(player) {
	try {
		return Number(player && player.playerPermissionLevel != null ? player.playerPermissionLevel : 0) >= PlayerPermissionLevel.Operator;
	} catch (e) {
		void e;
		return false;
	}
}

function getInventoryContainer(player) {
	try {
		const comp = player.getComponent("inventory");
		return comp && comp.container ? comp.container : undefined;
	} catch (e) {
		void e;
		return undefined;
	}
}

function getEquippable(player) {
	try {
		return player.getComponent("minecraft:equippable");
	} catch (e) {
		void e;
		return undefined;
	}
}

const CONTAINER_ITEM_TYPEIDS = new Set([
	// Shulkers
	"minecraft:shulker_box",
	"minecraft:black_shulker_box",
	"minecraft:blue_shulker_box",
	"minecraft:brown_shulker_box",
	"minecraft:cyan_shulker_box",
	"minecraft:gray_shulker_box",
	"minecraft:green_shulker_box",
	"minecraft:light_blue_shulker_box",
	"minecraft:light_gray_shulker_box",
	"minecraft:lime_shulker_box",
	"minecraft:magenta_shulker_box",
	"minecraft:orange_shulker_box",
	"minecraft:pink_shulker_box",
	"minecraft:purple_shulker_box",
	"minecraft:red_shulker_box",
	"minecraft:white_shulker_box",
	"minecraft:yellow_shulker_box",

	// Bundle
	"minecraft:bundle",

	// Ender chest (como item)
	"minecraft:ender_chest",
]);

function flag(ctx, player, reason, details, severity = 1) {
	try {
		if (ctx && ctx.enforce && typeof ctx.enforce.flag === "function") {
			ctx.enforce.flag(player, reason, {
				checkId: "abnormal_stacks",
				severity: severity,
				details: details,
			});
		}
	} catch (e) {
		void e;
	}
}

function clampInventoryItem(container, slot, item, targetAmount) {
	try {
		item.amount = targetAmount;
		container.setItem(slot, item);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function removeInventoryItem(container, slot) {
	try {
		container.setItem(slot, undefined);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function scanAndFixPlayer(ctx, player, cfg) {
	if (!player) return;
	if (isOperator(player)) return;

	const container = getInventoryContainer(player);
	if (!container) return;

	const clampToMax = Boolean(cfg && cfg.clampToMax != null ? cfg.clampToMax : true);
	const removeContainerItems = Boolean(cfg && cfg.removeContainerItems != null ? cfg.removeContainerItems : true);
	const immediateSanction = Boolean(cfg && cfg.immediateSanction != null ? cfg.immediateSanction : true);
	const sanctionId = Number(cfg && cfg.sanctionId != null ? cfg.sanctionId : 2);

	for (let slot = 0; slot < container.size; slot++) {
		const item = container.getItem(slot);
		if (!item) continue;

		const typeId = item.typeId;
		if (removeContainerItems && CONTAINER_ITEM_TYPEIDS.has(typeId)) {
			// Nota: inspeccionar el contenido de estos items (shulker/bundle/ender chest) no siempre es posible vía Script API.
			// Para evitar ocultar stacks ilegales, se bloquean del inventario.
			try {
				if (ctx && ctx.enforce && typeof ctx.enforce.flag === "function") {
					ctx.enforce.flag(player, "container_item_not_allowed", {
						checkId: "abnormal_stacks",
						severity: 2,
						tpsSensitive: false,
						details: { typeId: typeId, slot: slot },
						// Esto NO es sanción inmediata; es una mitigación para evitar ocultar stacks ilegales.
						immediateSanction: false,
					});
				}
			} catch (e) {
				void e;
			}
			const removed = removeInventoryItem(container, slot);
			try {
				if (ctx && ctx.logger && typeof ctx.logger.warn === "function") {
					ctx.logger.warn({
						checkId: "abnormal_stacks",
						player: player,
						message: "Contenedor prohibido removido del inventario",
						data: { typeId: typeId, slot: slot, removed: removed },
					});
				}
			} catch (e) {
				void e;
			}
			continue;
		}

		const max = Number(item.maxAmount != null ? item.maxAmount : 0);
		const amount = Number(item.amount != null ? item.amount : 0);
		if (!Number.isFinite(max) || max <= 0) continue;
		if (!Number.isFinite(amount) || amount <= 0) continue;
		if (amount <= max) continue;

		// Un stack mayor a maxAmount es un indicativo 100% (editor/hack) porque el juego no lo permite de forma normal.
		try {
			if (ctx && ctx.enforce && typeof ctx.enforce.flag === "function") {
				ctx.enforce.flag(player, "abnormal_stack", {
					checkId: "abnormal_stacks",
					severity: 2,
					tpsSensitive: false,
					details: { typeId: typeId, slot: slot, amount: amount, max: max },
					immediateSanction: immediateSanction,
					sanctionId: sanctionId,
				});
			}
		} catch (e) {
			void e;
		}
		let fixed = false;
		if (clampToMax) fixed = clampInventoryItem(container, slot, item, max);
		try {
			if (ctx && ctx.logger && typeof ctx.logger.warn === "function") {
				ctx.logger.warn({
					checkId: "abnormal_stacks",
					player: player,
					message: "Stack anómalo detectado",
					data: { typeId: typeId, slot: slot, amount: amount, max: max, fixed: fixed },
				});
			}
		} catch (e) {
			void e;
		}
	}

	// Extra: validar equipo por si llega a existir un stack ilegal ahí.
	const eq = getEquippable(player);
	if (!eq) return;

	const slots = [
		EquipmentSlot.Mainhand,
		EquipmentSlot.Offhand,
		EquipmentSlot.Head,
		EquipmentSlot.Chest,
		EquipmentSlot.Legs,
		EquipmentSlot.Feet,
	];

	for (const s of slots) {
		let item;
		try {
			item = eq.getEquipment(s);
		} catch (e) {
			void e;
			item = undefined;
		}
		if (!item) continue;
		const max = Number(item.maxAmount != null ? item.maxAmount : 0);
		const amount = Number(item.amount != null ? item.amount : 0);
		if (!Number.isFinite(max) || max <= 0) continue;
		if (!Number.isFinite(amount) || amount <= 0) continue;
		if (amount <= max) continue;

		try {
			if (ctx && ctx.enforce && typeof ctx.enforce.flag === "function") {
				ctx.enforce.flag(player, "abnormal_equipment_stack", {
					checkId: "abnormal_stacks",
					severity: 3,
					tpsSensitive: false,
					details: { typeId: item.typeId, equipmentSlot: String(s), amount: amount, max: max },
					immediateSanction: immediateSanction,
					sanctionId: sanctionId,
				});
			}
		} catch (e) {
			void e;
		}
		// En equipo, por seguridad removemos el item si detectamos stack ilegal.
		try {
			eq.setEquipment(s, undefined);
		} catch (e) {
			void e;
			// ignore
		}
	}
}

export const abnormalStacksCheck = {
	id: "abnormal_stacks",
	section: 13,
	name: "Abnormal stack sizes",

	start(ctx) {
		if (didStart) return;
		didStart = true;

		const cfg = ctx && ctx.config && ctx.config.abnormalStacks ? ctx.config.abnormalStacks : {};
		if (!cfg || !cfg.enabled) return;

		const everyTicks = Math.max(5, Number(cfg && cfg.checkEveryTicks != null ? cfg.checkEveryTicks : 20));

		system.runInterval(() => {
			for (const player of world.getPlayers()) {
				try {
					scanAndFixPlayer(ctx, player, cfg);
				} catch (e) {
					try {
						if (ctx && ctx.logger && typeof ctx.logger.error === "function") {
							ctx.logger.error({
								checkId: "abnormal_stacks",
								player: player,
								message: "Error in abnormalStacks check",
								data: { error: String(e) },
							});
						}
					} catch (e2) {
						void e2;
					}
				}
			}
		}, everyTicks);
	},
};
