// Data-driven config for the Upgrades (Chest UI) feature.
// Keep this file Script-API-free so it can be imported by unit tests.

export const upgradesUiConfig = {
	// Slots for the 3x3 actions grid (row-major):
	actionSlots: [14, 15, 16, 23, 24, 25, 32, 33, 34],

	// Layout tokens
	layout: {
		defaultItem: { itemName: "§8", texture: "g/black" },
		pattern: [
			"xxxxxxxxx",
			"xyyyx___x",
			"xy_yx___x",
			"xy_yx___x",
			"xxxxxxxxx",
		],
		patternLegend: {
			x: {
				itemName: { rawtext: [{ text: "§8" }] },
				itemDesc: ["§8"],
				enchanted: false,
				stackAmount: 0,
				texture: "g/black",
			},
		},
		// Fallback if no rarity is detected
		fallbackPaneY: {
			// paneName is used to dynamically name the panel item.
			paneName: "§8",
			itemName: { rawtext: [{ text: "§8" }] },
			itemDesc: ["§8"],
			enchanted: false,
			stackAmount: 0,
			texture: "g/blue",
		},
	},

	// Buttons driven by the 5-digit code. Keys are 1-based indexes.
	actionsByCodeIndex: {
		1: {
			actionId: "tool_enchants",
			title: "§r§aEncantamientos de herramienta",
			texture: "i/enchanted_book",
			descriptionLines: [
				"§r§7¡El conocimiento es §6poder!§r§7",
				"§r§7aplica los libros más poderosos",
				"§r§7pero recuerda que conseguirlos",
				"§r§7puede ser todo un reto.",
			],
			clickHint: "§r§eClic para ver más",
			variantsByDigit: {
				// 1 = debug/all categories (temporal)
				1: { variantId: "debug_all", categoryMode: "all" },
				// 2..9 = categorías
				2: { variantId: "sword", categoryMode: "sword" },
				3: { variantId: "bow", categoryMode: "bow" },
				4: { variantId: "armor", categoryMode: "armor" },
				5: { variantId: "hoe", categoryMode: "hoe" },
				6: { variantId: "axe", categoryMode: "axe" },
				7: { variantId: "pickaxe", categoryMode: "pickaxe" },
				8: { variantId: "helmet", categoryMode: "helmet" },
				9: { variantId: "boots", categoryMode: "boots" },
			},
		},

		2: {
			actionId: "tool_modifiers",
			title: "§r§aModificadores de herramienta",
			texture: "i/book",
			descriptionLines: [
				"§r§7Aplica modificadores especiales tales como",
				"§r§7los §6Sellos effrenatus§7, las §5Runas tier III",
				"§r§7y §cMeliorems maestros§7 necesitan un",
				"§r§7poco de §6ayuda§r§7 extra.",
			],
			clickHint: "§r§eClic para detalles",
			categories: {
				effrenatus: { label: "§r§6 Sellos effrenatus", max: 10 },
				rune_t3: { label: "§r§5 Runas tier III", max: 1 },
				meliorem_master: { label: "§r§c Meliorems maestros", max: 3 },
			},
			variantsByDigit: {
				1: { variantId: "default", supportedCategories: ["effrenatus", "rune_t3", "meliorem_master"] },
				2: { variantId: "no_effrenatus", supportedCategories: ["rune_t3", "meliorem_master"] },
				3: { variantId: "no_rune_t3", supportedCategories: ["effrenatus", "meliorem_master"] },
				4: { variantId: "no_meliorem_master", supportedCategories: ["effrenatus", "rune_t3"] },
				5: { variantId: "only_rune_t3", supportedCategories: ["rune_t3"] },
				6: { variantId: "only_meliorem_master", supportedCategories: ["meliorem_master"] },
				7: { variantId: "only_effrenatus", supportedCategories: ["effrenatus"] },
			},
			// Reading rules (kept here to remain data-driven)
			readRules: {
				effrenatus: { statKey: "damage", channel: "S2", step: 4, rounding: "ceil" },
				meliorem_master: { statKey: "damage", channel: "S1", step: 20, rounding: "ceil" },
				// rune_t3: intentionally not interpreted yet (dev)
			},
		},

		3: {
			actionId: "tool_info",
			title: "§r§aInformación de herramienta",
			texture: "i/clock",
			descriptionLines: [
				"§r§7Puedes encontra la información y",
				"§r§7también encontrarás estadisticas",
				"§r§7dependiendo de su tipo ",
				"§7(§gPico§7, §gHacha§7, §gEspada§7, §getc§7).",
			],
			clickHint: "§r§eClic para ver más",
			variantsByDigit: {
				1: { variantId: "default" },
				2: { variantId: "default" },
			},
		},

		4: {
			actionId: "tool_attributes",
			title: "§r§aAtributos de herramienta",
			texture: "i/brewing_stand",
			descriptionLines: [
				"§r§7Con ayuda de los §6Atributos§r§7, los",
				"§r§7objetos pueden alcanzar sus limites y",
				"§r§7expandir sus estadisticas",
			],
			clickHint: "§r§eClic para ver más",
			variantsByDigit: {
				1: { variantId: "default" },
			},
		},
	},

	// Enchantment pools: base names only (levels ignored). Matching should be diacritic-insensitive.
	enchantmentPoolsByCategory: {
		sword: [
			"Filo",
			"Primer Golpe",
			"Critico",
			"Aspecto Ígneo",
			"Castigo",
			"Perdición de los Artrópodos",
			"Discordancia",
			"Corte Veloz",
			"Oxidación",
			"Asesino del Fin",
			"Saqueo",
			"Lux",
			"Nux",
			"Verosimilitud",
		],
		bow: [
			"Poder",
			"Llama",
			"Golpe",
			"Salvación",
			"Sobrecarga",
			"Caprificación",
			"Obliteración",
			"Terminación",
			"Artigeno",
			"Magmatismo",
			"Tormenta",
		],
		armor: ["Protección", "Rejuvenecimiento"],
		helmet: ["Afinidad acuática", "Respiración"],
		boots: ["Caída de pluma", "Lijereza"],
		pickaxe: ["Eficiencia", "Fortuna", "Prisa espontánea", "Linaje", "Convicción"],
		axe: ["Eficiencia", "Fortuna", "Prisa espontánea", "Convicción"],
		hoe: ["Eficiencia", "Fortuna", "Cultivador", "Convicción"],
	},

	// Category inheritance (union without duplicates)
	categoryUnions: {
		boots: ["boots", "armor"],
		helmet: ["helmet", "armor"],
	},

	// Rarity → panel-Y style. `qualityText` must match the lore (including § codes).
	rarities: [
		{ key: "common", qualityText: "§f§lCOMÚN", paneName: "§f§lCOMÚN", paneTexture: "g/white", paneDescription: ["Rareza común"] },
		{ key: "uncommon", qualityText: "§q§lPOCO COMÚN", paneName: "§q§lPOCO COMÚN", paneTexture: "g/lime", paneDescription: ["Poco común"] },
		{ key: "rare", qualityText: "§t§lRARO", paneName: "§t§lRARO", paneTexture: "g/blue", paneDescription: ["Raro"] },
		{ key: "very_rare", qualityText: "§u§lMUY RARO", paneName: "§u§lMUY RARO", paneTexture: "g/magenta", paneDescription: ["Muy raro"] },
		{ key: "epic", qualityText: "§5§lÉPICO", paneName: "§5§lÉPICO", paneTexture: "g/purple", paneDescription: ["Épico"] },
		{ key: "legendary", qualityText: "§6§lLEGENDARIO", paneName: "§6§lLEGENDARIO", paneTexture: "g/orange", paneDescription: ["Legendario"] },
		{ key: "ascended", qualityText: "§e§lASCENDIDO", paneName: "§e§lASCENDIDO", paneTexture: "g/yellow", paneDescription: ["Ascendido"] },
		{ key: "mythic", qualityText: "§d§lMÍTICO", paneName: "§d§lMÍTICO", paneTexture: "g/pink", paneDescription: ["Mítico"] },

		// Additional rarities seen in the project (can be extended)
		{ key: "unic", qualityText: "§v§lÚNICO", paneName: "§v§lÚNICO", paneTexture: "g/orange", paneDescription: ["Único"] },
		{ key: "forgotten", qualityText: "§j§lOLVIDADO", paneName: "§j§lOLVIDADO", paneTexture: "g/gray", paneDescription: ["Olvidado"] },
		{ key: "relic", qualityText: "§s§lRELIQUÍA", paneName: "§s§lRELIQUÍA", paneTexture: "g/cyan", paneDescription: ["Reliquía"] },
		{ key: "special", qualityText: "§c§lESPECIAL", paneName: "§c§lESPECIAL", paneTexture: "g/red", paneDescription: ["Especial"] },

		// Rarezas maximas
		{ key: "anatema", qualityText: "§m§lANA§4TEMA", paneName: "§m§lANA§4TEMA", paneTexture: "g/red", paneDescription: ["Anatema"] },
		{ key: "absolute", qualityText: "§b§lABSO§fLUTO", paneName: "§b§lABSO§fLUTO", paneTexture: "g/light_blue", paneDescription: ["Absoluto"] },
		{ key: "limitless", qualityText: "§4§lL§cI§vM§gI§eT§aL§qE§sS§9S", paneName: "§4§lL§cI§vM§gI§eT§aL§qE§sS§9S", paneTexture: "g/white", paneDescription: ["Sin límites"] },
	],
};

// Menu layout/spec (kept data-driven so menus remain configuration-oriented)
export const upgradesMenusConfig = {
	primary: {
		mirrorSlot: 20,
		reforgeSlot: 29,
		actionSlots: upgradesUiConfig.actionSlots,
		features: {
			rarityPane: true,
			actionGrid: true,
			reforgeButton: true,
		},
	},
	submenu: {
		size: "45",
		framePattern: [
			"xxxxxxxxx",
			"x_______x",
			"x_______x",
			"x_______x",
			"xxxxxxxxx",
		],
		frameKey: {
			x: {
				itemName: { rawtext: [{ text: "§8" }] },
				itemDesc: ["§8"],
				enchanted: false,
				stackAmount: 0,
				durability: 0,
				texture: "g/black",
			},
		},
		back: {
			slot: 36,
			itemName: "§r§cVolver",
			itemDesc: [],
			texture: "barrier",
			stackAmount: 0,
			durability: 0,
			enchanted: false,
		},
		detailsSlot: 22,
	},
};
