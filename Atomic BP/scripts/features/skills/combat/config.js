export const combatSkillConfig = {
	enabled: true,
	debug: {
		enabled: false,
		console: false,
		tellPlayer: false,
	},

	scoreboards: {
		xp: "SkillXpCombate",
		level: "SkillLvlCombate",
	},

	xp: {
		loreBonusObjective: "ExpCombateTotalH",
		minBonusPercent: -100,
		maxBonusPercent: 10000,
	},

	rewards: {
		primaryObjective: "DMGH",
		primaryPerLevel: 2,
		defaultScoreboardAddDRanges: [
			{ fromLevel: 1, toLevel: 20, amount: 300 },
			{ fromLevel: 21, toLevel: 40, amount: 500 },
			{ fromLevel: 41, toLevel: 60, amount: 800 },
		],
		defaultScoreboardAddD: 300,
	},

	maxLevel: 60,
	titleColorFallback: "§c",

	levels: [
		{ level: 1, xpRequired: 0 },
		{ level: 2, xpRequired: 50 },
		{ level: 3, xpRequired: 150 },
		{ level: 4, xpRequired: 300 },
		{ level: 5, xpRequired: 500 },
		{ level: 6, xpRequired: 750 },
		{ level: 7, xpRequired: 1050 },
		{ level: 8, xpRequired: 1400 },
		{ level: 9, xpRequired: 1800 },
		{ level: 10, xpRequired: 2250 },
		{ level: 11, xpRequired: 2750 },
		{ level: 12, xpRequired: 3300 },
		{ level: 13, xpRequired: 3900 },
		{ level: 14, xpRequired: 4550 },
		{ level: 15, xpRequired: 5250 },
		{ level: 16, xpRequired: 6000 },
		{ level: 17, xpRequired: 6800 },
		{ level: 18, xpRequired: 7650 },
		{ level: 19, xpRequired: 8550 },
		{ level: 20, xpRequired: 9500 },
		{ level: 21, xpRequired: 10500 },
		{ level: 22, xpRequired: 11550 },
		{ level: 23, xpRequired: 12650 },
		{ level: 24, xpRequired: 13800 },
		{ level: 25, xpRequired: 15000 },
		{ level: 26, xpRequired: 16250 },
		{ level: 27, xpRequired: 17550 },
		{ level: 28, xpRequired: 18900 },
		{ level: 29, xpRequired: 20300 },
		{ level: 30, xpRequired: 21750 },
		{ level: 31, xpRequired: 23250 },
		{ level: 32, xpRequired: 24800 },
		{ level: 33, xpRequired: 26400 },
		{ level: 34, xpRequired: 28050 },
		{ level: 35, xpRequired: 29750 },
		{ level: 36, xpRequired: 31500 },
		{ level: 37, xpRequired: 33300 },
		{ level: 38, xpRequired: 35150 },
		{ level: 39, xpRequired: 37050 },
		{ level: 40, xpRequired: 39000 },
		{ level: 41, xpRequired: 41000 },
		{ level: 42, xpRequired: 43050 },
		{ level: 43, xpRequired: 45150 },
		{ level: 44, xpRequired: 47300 },
		{ level: 45, xpRequired: 49500 },
		{ level: 46, xpRequired: 51750 },
		{ level: 47, xpRequired: 54050 },
		{ level: 48, xpRequired: 56400 },
		{ level: 49, xpRequired: 58800 },
		{ level: 50, xpRequired: 61250 },
		{ level: 51, xpRequired: 63750 },
		{ level: 52, xpRequired: 66300 },
		{ level: 53, xpRequired: 68900 },
		{ level: 54, xpRequired: 71550 },
		{ level: 55, xpRequired: 74250 },
		{ level: 56, xpRequired: 77000 },
		{ level: 57, xpRequired: 79800 },
		{ level: 58, xpRequired: 82650 },
		{ level: 59, xpRequired: 85550 },
		{ level: 60, xpRequired: 88500 },
	],

	levelUpMessage: [
		"§s+§4======================§s+",
		"",
		"§c§lHABILIDAD MEJORADA§r",
		"§7Habilidad: <levelUpCombat>",
		"",
		"§f>> §cAtributo",
		"   §6Daño Base §8<PreviousPrimary> §7-> §a<NextPrimary>",
		"",
		"§f>> §cRecompensas",
		"   §6+<ScoreboardAddD> §7Dinero",
		"<OtherAwards>",
		"",
		"§s+§4======================§s+",
	],

	runtime: {
		reconcileEveryTicks: 40,
		initializeOnJoin: true,
		notifyOnLevelDown: false,
		preserveHigherPrimary: true,
		titles: {
			enabledByDefault: true,
			source: "skill_xp",
			id: "combat_xp",
			priority: 40,
			durationTicks: 40,
			contentTemplate: ["+${xpGain} §8| §c${skill} §8| §7${xpActual}/${xpRequeriment}"],
			noLevelsContentTemplate: ["+${xpGain} §8| §c${skill} §8| §7${xpTotal}"],
		},
	},

	mobXp: [
		{ typeId: "minecraft:zombie", baseXp: 8 },
		{ typeId: "minecraft:skeleton", baseXp: 10 },
		{ typeId: "minecraft:creeper", baseXp: 12 },
		{ typeId: "minecraft:spider", baseXp: 8 },
		{ typeId: "minecraft:enderman", baseXp: 18 },
		{ typeId: "minecraft:blaze", baseXp: 20 },
		{ typeId: "minecraft:wither_skeleton", baseXp: 25 },
	],

	mobLoot: [
		{ typeId: "minecraft:zombie", drops: [{ itemId: "minecraft:rotten_flesh", chance: 1, min: 1, max: 2 }] },
		{ typeId: "minecraft:skeleton", drops: [{ itemId: "minecraft:bone", chance: 1, min: 1, max: 3 }] },
	],

	drops: {
		cleanupDelayTicks: 1,
		radius: 4,
		allowVanillaWhenKillerHZero: true,
		alwaysSuppressArmorVanilla: true,
	},

	mobs: {
		trimMode: "hybrid",
		templates: {
			guerrero_corrupto: {
				typeId: "minecraft:zombie",
				nameTag: "§cGuerrero Corrupto",
				weight: 10,
				tags: ["combat_mob"],
				// Scores que se aplican al mob al spawnear.
				// H: 1 es OBLIGATORIO para que el sistema de combate lo reconozca.
				// Si no se define scores, se aplica { H: 1 } por defecto.
				scores: { H: 1, DMGH: 15, VidaMaxTotalH: 200 },
				// Efectos de Minecraft aplicados al mob. Clave = effectId, valor = amplifier (0-based).
				// Duration es infinita (configurable con objeto { amplifier, duration }).
				effects: {
					resistance: 1,
				},
				equipment: {
					head: { typeId: "minecraft:iron_helmet" },
					chest: { typeId: "minecraft:iron_chestplate" },
					mainhand: { typeId: "minecraft:iron_sword" },
				},
			},
			arquero_maldito: {
				typeId: "minecraft:skeleton",
				nameTag: "§5Arquero Maldito",
				weight: 8,
				tags: ["combat_mob"],
				scores: { H: 1, DMGH: 12, VidaMaxTotalH: 150 },
				effects: {},
				equipment: {
					head: { typeId: "minecraft:chainmail_helmet" },
					mainhand: { typeId: "minecraft:bow" },
				},
			},
			aracnido_venenoso: {
				typeId: "minecraft:spider",
				nameTag: "§2Arácnido Venenoso",
				weight: 6,
				tags: ["combat_mob"],
				scores: { H: 1, DMGH: 8, VidaMaxTotalH: 100 },
				// Ejemplo: efecto con amplifier y duración custom (ticks). Sin duration = infinito.
				effects: {
					speed: 1,
				},
			},
			bruto_infernal: {
				typeId: "minecraft:wither_skeleton",
				nameTag: "§4Bruto Infernal",
				weight: 3,
				tags: ["combat_mob", "elite"],
				scores: { H: 1, DMGH: 25, VidaMaxTotalH: 500 },
				effects: {
					resistance: 2,
					strength: 1,
				},
				// Equipment acepta items vanilla y custom:
				//   typeId: string        — ID del item ("minecraft:diamond_sword", "atomic:espada_rubi")
				//   nameTag?: string      — Nombre visible del item (soporta §-colores)
				//   lore?: string[]       — Líneas de lore
				//   enchantments?: array  — [{typeId, level}] o alias "enchants"
				//   amount?: number       — Cantidad (default 1)
				//   keepOnDeath?: boolean  — Mantener al morir
				//   canDestroy?: string[] — Bloques que puede destruir (adventure mode)
				//   canPlaceOn?: string[] — Bloques donde se puede colocar
				equipment: {
					head: {
						typeId: "minecraft:diamond_helmet",
						nameTag: "§4Casco Infernal",
						lore: ["§7Forjado en el Nether"],
					},
					chest: { typeId: "minecraft:diamond_chestplate" },
					mainhand: {
						typeId: "minecraft:diamond_sword",
						nameTag: "§4Hoja Infernal",
						enchantments: [{ typeId: "sharpness", level: 2 }],
					},
				},
			},
			centinela_nocturno: {
				typeId: "minecraft:enderman",
				nameTag: "§1Centinela Nocturno",
				weight: 2,
				tags: ["combat_mob", "elite"],
				scores: { H: 1, DMGH: 20, VidaMaxTotalH: 350 },
				effects: {
					speed: 2,
				},
			},
		},
	},

	// ──────────────────────────────────────────────────────────
	// SISTEMA DE SPAWNS
	// ──────────────────────────────────────────────────────────
	spawns: {
		// Master switch
		enabled: true,

		// Dimensión donde opera el sistema
		dimensionId: "minecraft:overworld",

		// ── Intervalos (ticks) ──
		spawnTickInterval: 60,            // Cada cuántos ticks se intenta spawnear
		cleanupTickInterval: 100,         // Cada cuántos ticks se hace cleanup/despawn
		fullDespawnTickInterval: 200,     // Cada cuántos ticks se hace despawn completo de zonas sin jugadores

		// ── Caps de población ──
		globalMaxMobs: 40,                // Máximo total de mobs custom en todo el mundo
		budgetPerPlayer: 12,              // Capacidad de spawn que "aporta" cada jugador al presupuesto global
		// El presupuesto efectivo es: min(globalMaxMobs, players.length * budgetPerPlayer)
		// Esto evita que 1 jugador llene todas las zonas y que N jugadores produzcan N*globalMax mobs.

		// ── Distancias de jugador ──
		activationRadius: 64,             // Radio desde el centro del área para considerarla "activa" (jugador cercano)
		minPlayerDistance: 16,            // Distancia mínima al jugador más cercano para spawnear (evitar pop-in)
		despawnDistance: 96,              // Distancia a la cual un mob se remueve si ningún jugador está dentro
		instantDespawnDistance: 160,      // Distancia a la cual un mob se remueve inmediatamente (sin esperar cleanup)

		// ── Intentos por ciclo ──
		maxAttemptsPerZone: 6,            // Intentos de posición por zona por tick de spawn
		maxSpawnsPerTick: 4,              // Máximo de mobs spawneados en un solo tick (todas las zonas combinadas)

		// ── Takeover (superposición de mobs existentes) ──
		// Si una entidad en el mundo coincide en typeId + nameTag con un template,
		// se elimina y se reemplaza por el mob del template con todas sus specs.
		// Esto aplica sin importar el origen de la entidad.
		takeover: {
			enabled: true,
			tickInterval: 100,            // Cada cuántos ticks se escanea el mundo
			// Tag que se pone a los mobs ya procesados para no re-procesarlos
			processedTag: "atomic_takeover_done",
		},

		// ── Scores por defecto ──
		// Scores que se aplican a TODOS los mobs spawneados por este sistema
		// si el template no define sus propios scores.
		// H: 1 es obligatorio para que el sistema de combate los reconozca.
		defaultScores: { H: 1 },

		// ── Duración por defecto de efectos (ticks) ──
		// Si un efecto en el template no especifica duración, se usa este valor.
		// 2000000000 ≈ infinito en Bedrock (max safe int for effects)
		defaultEffectDuration: 20000000,

		// ── Áreas reutilizables ──
		// Definidas una sola vez, referenciadas por ID desde las zonas.
		// Permite que múltiples zonas (con distintos mobs) compartan el mismo volumen 3D.
		areas: {
			bosque_sur: {
				min: { x: 19, y: 31, z: 20 },
				max: { x: -23, y: 51, z: -20 },
			},
			mazmorra_norte: {
				min: { x: -24, y: 51, z: -14 },
				max: { x: -30, y: 58, z: -8 },
			},
			colina_este: {
				min: { x: -24, y: 52, z: 2 },
				max: { x: -30, y: 58, z: -7 },
			},
		},

		// ── Zonas de spawn ──
		// Cada zona vincula un área (por ID) con un pool de templates y configuración propia.
		// Varias zonas pueden usar la MISMA área → distintos mobs en el mismo lugar.
		// maxPopulation de la zona se aplica DENTRO del presupuesto global.
		zones: [
			{
				id: "bosque_sur_normales",
				enabled: true,
				areaId: "bosque_sur",                  // Referencia a areas.bosque_sur

				// Pool de templates (IDs de mobs.templates)
				templatePool: ["guerrero_corrupto", "arquero_maldito", "aracnido_venenoso"],

				// Cap de población de ESTA zona (independiente del global)
				maxPopulation: 8,

				// Cuántos mobs intentar spawnear por tick (dentro del budget)
				spawnBatchSize: 2,

				// Intentos de posición para esta zona (override del global si se define)
				// maxAttemptsPerZone: 6, // ← usa el default global si no se define

				// Condiciones de activación de esta zona
				conditions: {
					// Si true, la zona solo se activa si hay un jugador dentro del activationRadius
					// Default: true — SIEMPRE se requiere jugador cercano (principio core del sistema)
					requirePlayersNearby: true,

					// Radio de activación (override del global si se define)
					// activationRadius: 64, // ← usa el default global si no se define

					// Hora del día: "any" | "day" | "night"
					timeOfDay: "any",

					// Nivel mínimo de combate del jugador más cercano
					// Si se define, la zona solo se activa si el jugador tiene >= este nivel
					// minPlayerCombatLevel: 0, // ← sin restricción
				},
			},
			{
				id: "bosque_sur_elites",
				enabled: true,
				areaId: "bosque_sur",                  // MISMA área que bosque_sur_normales

				templatePool: ["bruto_infernal", "centinela_nocturno"],
				maxPopulation: 3,
				spawnBatchSize: 1,

				conditions: {
					requirePlayersNearby: true,
					timeOfDay: "night",
					// Solo si el jugador tiene nivel 10+
					minPlayerCombatLevel: 10,
				},
			},
			{
				id: "mazmorra_norte_guardias",
				enabled: true,
				areaId: "mazmorra_norte",

				templatePool: ["guerrero_corrupto", "arquero_maldito", "bruto_infernal"],
				maxPopulation: 6,
				spawnBatchSize: 1,

				conditions: {
					requirePlayersNearby: true,
					// activationRadius override para mazmorras (más corto)
					activationRadius: 40,
					timeOfDay: "any",
				},
			},
		],
	},
};
