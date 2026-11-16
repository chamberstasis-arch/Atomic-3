import { NAMESPACE } from "../../shared/namespace.js";

export const customItemsConfig = {
	NAMESPACE,
	defaults: {
		displayName: "",
		lore: [],
	},
	items: {
		wooden_pickaxe_plain: {
			id: `${NAMESPACE}:wooden_pickaxe_plain`,
		},
		wooden_pickaxe_glint: {
			id: `${NAMESPACE}:wooden_pickaxe_glint`,
		},
		stone_pickaxe_plain: {
			id: `${NAMESPACE}:stone_pickaxe_plain`,
		},
		stone_pickaxe_glint: {
			id: `${NAMESPACE}:stone_pickaxe_glint`,
		},
		copper_pickaxe_plain: {
			id: `${NAMESPACE}:copper_pickaxe_plain`,
		},
		copper_pickaxe_glint: {
			id: `${NAMESPACE}:copper_pickaxe_glint`,
		},
		iron_pickaxe_plain: {
			id: `${NAMESPACE}:iron_pickaxe_plain`,
		},
		iron_pickaxe_glint: {
			id: `${NAMESPACE}:iron_pickaxe_glint`,
		},
		golden_pickaxe_plain: {
			id: `${NAMESPACE}:golden_pickaxe_plain`,
		},
		golden_pickaxe_glint: {
			id: `${NAMESPACE}:golden_pickaxe_glint`,
		},
		diamond_pickaxe_plain: {
			id: `${NAMESPACE}:diamond_pickaxe_plain`,
		},
		diamond_pickaxe_glint: {
			id: `${NAMESPACE}:diamond_pickaxe_glint`,
		},
		netherite_pickaxe_plain: {
			id: `${NAMESPACE}:netherite_pickaxe_plain`,
		},
		netherite_pickaxe_glint: {
			id: `${NAMESPACE}:netherite_pickaxe_glint`,
		},
	},
	// Cada cuántos ticks se revisan inventarios para aplicar nombre/lore.
	// Mantenerlo alto para no impactar TPS.
	scanEveryTicks: 40,
};
