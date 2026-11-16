import { world } from "@minecraft/server";
import ChestFormData from "./chestui/forms.js";
import { upgradesPrimaryMenu } from "./upgrades/upgradesMenu.js";

export { ChestFormData, upgradesPrimaryMenu };

// Exporta una función de inicialización
export function initChestUi() {
	world.afterEvents.itemUse.subscribe((evd) => {
		if (!evd.itemStack) return;

		const item = evd.itemStack;
		const isCompass =
			item.typeId === "minecraft:compass" ||
			item.typeId === "minecraft:lodestone_compass" ||
			item.typeId === "minecraft:recovery_compass";

		// Único trigger permitido: Shift + clic derecho con un item que NO sea brújula.
		if (evd.source?.isSneaking && item.typeId !== "minecraft:air" && !isCompass) {
			return upgradesPrimaryMenu(evd.source);
		}

		return;
	});
}
