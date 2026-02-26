// Config del sistema de regeneración de bloques (global para skills).
// Nota: este archivo es SOLO datos (sin lógica), para mantener responsabilidades separadas.

// import { spawnEndrodStarHorizontal } from "./particles.js";

/**
 * @typedef {{ x:number, y:number, z:number }} Vec3
 * @typedef {{ id?: string, dimensionId: string, min: Vec3, max: Vec3 }} RegenArea
 *
 * DropEntryTuple:
 * [dropId, itemId, minQty, maxQty, chancePct, nameTag, lore]
 * - lore puede ser string o string[]
 *
 * @typedef {[number|string, string, number, number, number, (string|null|undefined), (string|string[]|null|undefined)]} DropEntryTuple
 *
 * @typedef {{
 *  id: string,
 *  priority?: number,
 *  mode?: "override"|"add",
 *  when?: {
 *    all?: any[],
 *    any?: any[],
 *    not?: any,
 *    score?: { objective: string, range?: {min?:number,max?:number}, condition?: string, value?: number },
 *    area?: { id?: string, aabb?: { min: Vec3, max: Vec3 } },
 *    skill?: string|{ equals: string },
 *  },
 *  effects?: {
 *    drops?: DropEntryTuple[],
 *    scoreboardAddsOnBreak?: Record<string, number>,
	 *    xp?: { base:number, scalingObjective:string, gainObjective?:string, levelObjective?:string, stepPerPoints?:number },
	 *    title?: { enabled:boolean, source?:string, id?:string, priority?:number, durationTicks?:number, content?:string[] },
 *  },
 * }} ModifierRule
 *
 * @typedef {{
 *  id?: string,
 *  threshold: number,
 *  drops: DropEntryTuple[],
 *  effects?: {
 *    scoreboardAddsOnBreak?: Record<string, number>,
 *  },
 * }} FortuneTierEntry
 *
 * @typedef {{
 *  objective: string,
 *  step: number,
 *  tiers: FortuneTierEntry[],
 * }} FortuneTiersConfig
 *
 * @typedef {{
 *  id: string,
 *  // Identificador de skill asociada al bloque (ej: "mining", "farming", "foraging", ...)
 *  skill: string,
 *  // Nuevo (recomendado):
 *  // - exacto: "minecraft:coal_ore"
 *  // - todos: "*" (match any)
 *  // - prefijo: "minecraft:*" (match prefix)
 *  blockId?: string,
 *  // Áreas habilitadas para este bloque (referencia por id)
 *  // - string: "A"
 *  // - array: ["A", "B"]
 *  // - "*" para permitir todas
 *  areas?: string | string[],
 *  regenSeconds?: number,
 *  minedBlockId?: string,
 *  // Sonidos a reproducir al minar (opcional)
 *  // - sounds: se intentan reproducir TODOS en el mismo tick
 *  // - volumen/pitch permiten ajustar intensidad
 *  sounds?: Array<{ id: string, volume?: number, pitch?: number }>,
 *  // XP (orbes) a spawnear al minar (opcional)
 *  // - chance: 0..100 (si falla, no spawnea)
 *  // - min/max: rango inclusivo de orbes a spawnear si pasa el chance
 *  xpOrbs?: { min: number, max: number, chance: number },
 *  // Partículas al minar con Silk Touch (opcional)
 *  // - fn: función importada desde particles.js
 *  // - offset: relativo al bloque minado (0.5,0.5,0.5 => centro del bloque)
 *  // - options: parámetros específicos de la función
 *  particlesOnSilkTouch?: { fn: Function, offset?: Vec3, options?: any },
 *  // Métricas por-mineral (scoreboard players add)
 *  // - Se suma a las métricas globales (si están activas)
 *  // - Formato: { "OBJETIVO": numeroAAgregar }
 *  scoreboardAddsOnBreak?: Record<string, number>,
 *  drops: DropEntryTuple[],
 *  modifiers?: ModifierRule[],
 *  // Fortune tiers: sistema probabilístico de drops por valor de fortuna.
 *  // Reemplaza modifiers de rango para fortuna. Cada tier define drops para un umbral.
 *  // fortune % step = probabilidad de obtener el tier superior (interpolación lineal).
 *  fortuneTiers?: FortuneTiersConfig,
 *  // XP de skill (independiente de fortuna). Se aplica siempre que se mine el bloque.
 *  // Escala con scalingObjective (ej: ExpMinTotalH) pero NO varía por tier de fortuna.
 *  xp?: { base:number, scalingObjective:string, gainObjective?:string, levelObjective?:string, stepPerPoints?:number },
 *  // Título de XP (independiente de fortuna). Visual que se muestra al ganar XP.
 *  xpTitle?: { enabled:boolean, source?:string, id?:string, priority?:number, durationTicks?:number, content?:string[] },
 * }} BlockDefinition
 */

export const skillRegenConfig = {
	// Modo del feature:
	// - "dev": permite debug (console/tellPlayer/traceBreak)
	// - "prod": fuerza debug OFF aunque debug.enabled=true
	mode: "prod",
	// Alias por compatibilidad (si prefieres boolean)
	production: true,

	// Flag master
	enabled: true,

	// Diagnóstico para la primera prueba (no afecta gameplay si console=false)
	debug: {
		enabled: false,
		console: false,
		// Si lo activas, manda mensajes al jugador al minar (no recomendado en producción)
		tellPlayer: false,
		// Traza: manda info del bloque detectado en cada intento de minado dentro de áreas
		traceBreak: false,
	},

	runtime: {
		xpOrbs: {
			maxSpawnPerBreak: 25,
		},
		particles: {
			// Keys de modifiers que disparan particlesOnSilkTouch.
			triggerModifierKeys: ["silk_touch_1"],
		},
		titles: {
			enabledByDefault: true,
			source: "regen_xp",
			priority: 40,
			durationTicks: 40,
			// Placeholders soportados:
			// - ${xpGain}
			// - ${xpActual}
			// - ${xpRequeriment} (compat con el naming actual)
			// - ${xpRequirement} (alias)
			// - ${xpTotal}
			// - ${skill}
			contentTemplate: ["+${xpGain}"],
			// Fallback visual cuando no hay catálogo de niveles consumible para la skill.
			noLevelsContentTemplate: ["+${xpGain} (${xpTotal})"],
			progressObjectivesBySkill: {
				mining: { xp: "SkillXpMineria", level: "SkillLvlMineria" },
				foraging: { xp: "SkillXpTala", level: "SkillLvlTala" },
				farming: { xp: "SkillXpCosecha", level: "SkillLvlCosecha" },
			},
		},
	},

	// Métricas (scoreboard players add)
	// - scoreboardAddsOnBreak: { "OBJETIVO": numeroAAgregar }
	// - Se aplica cuando el sistema procesa un minado válido (área + ore registrado + no creative)
	metrics: {
		enabled: false,
		scoreboardAddsOnBreak: {
			// "TEST": 1,
			// "BLOQUES": 1,
		},
	},

	// Usado para convertir segundos -> ticks. En Bedrock normalmente 20.
	ticksPerSecond: 20,

	// mined-state global (puede ser sobre-escrito por mineral)
	defaultMinedBlockId: "minecraft:black_concrete",

	// Áreas donde aplica el sistema (AABB inclusivo)
	/** @type {RegenArea[]} */
	areas: [
		// Ejemplo A
		{
			id: "A",
			dimensionId: "minecraft:overworld",
			min: { x: 0, y: -64, z: 0 },
			max: { x: 200, y: 120, z: 200 },
		},
		// Ejemplo B
		{
			id: "B",
			dimensionId: "minecraft:overworld",
			min: { x: 300, y: -64, z: 0 },
			max: { x: 500, y: 120, z: 200 },
		},
	],

	// Persistencia (dynamic properties)
	persistence: {
		// Key del mundo para guardar pendientes (JSON)
		key: "atomic3:mining_regen_pending",
		// Delay de reintento al fallar restore (ms)
		retryDelayMs: 2000,
		// Longitud máxima del string guardado (limita tamaño del JSON).
		// Si crece mucho, se recorta en runtime para no romper DP.
		maxStringLength: 30000,
		// Límite duro de entries guardadas (protege del crecimiento infinito)
		maxEntries: 1500,
		// Batches al cargar mundo (evita picos)
		loadBatchSize: 50,
		loadBatchDelayTicks: 1,
	},

	// Bloques: define aquí lo que aplica a cada skill.
	/** @type {BlockDefinition[]} */
	blocks: [
		// MVP: carbón regenerable (skill: mining)
		{
			id: "coal",
			skill: "mining",
			blockId: "minecraft:coal_ore",
			// Área(s) habilitadas para este bloque
			areas: ["A"],
			// Métrica específica: al minar carbón suma 1 al objective CARBON
			scoreboardAddsOnBreak: {
				CARBON: 1,
			},
			regenSeconds: 60,
			// Sonidos: se reproducen TODOS
			sounds: [
				{ id: "dig.stone", volume: 1, pitch: 1 },
				// Ejemplo extra: agrega otro si quieres validar simultáneo
				// { id: "random.pop", volume: 1, pitch: 1 },
			],
			// XP (orbes) de prueba
			xpOrbs: { min: 1, max: 3, chance: 100 },
			// Partículas de prueba: solo al minar con Silk Touch
				// particlesOnSilkTouch: {
				// 	fn: spawnEndrodStarHorizontal,
				// 	// Pegado a la cara superior del bloque (y = +1) con un pequeño extra.
				// 	offset: { x: 0.5, y: 1.02, z: 0.5 },
				// 	// Contorno punteado (menos partículas)
				// 	options: { size: 0.35, pointsPerEdge: 12, pointStep: 4, particleId: "minecraft:endrod" },
				// },
			// minedBlockId opcional: si lo omites usa defaultMinedBlockId
			// minedBlockId: "minecraft:black_concrete",
			drops: [
				// Fallback base (solo si fortuneTiers no aplica): 30% 1-2 carbón
				[1, "minecraft:coal", 1, 2, 30, "§jCarbón", ["§7Mineral regenerable"]],
				[2, "minecraft:iron_nugget", 1, 1, 70, "§fPepita", ["§7Drop de prueba"]],
			],
			// XP de skill: independiente de fortuna. Escala con ExpMinTotalH.
			xp: {
				base: 8,
				scalingObjective: "ExpMinTotalH",
				gainObjective: "SkillXpMineria",
				levelObjective: "SkillLvlMineria",
				stepPerPoints: 10,
			},
			// Título visual de XP: independiente de fortuna.
			xpTitle: {
				enabled: true,
				source: "regen_xp",
				id: "mining_xp",
				priority: 40,
				durationTicks: 40,
				content: ["§3+${xpGain} ${xpActual}/${xpRequeriment}"],
			},
			// Fortune tiers: sistema probabilístico basado en FortMinTotalH.
			// Solo afecta DROPS y scoreboardAdds por tier. XP/title son block-level.
			// Cada 100 puntos de fortuna = nuevo tier.
			// fortune % step = probabilidad de obtener el tier superior.
			// Ej: 150 fortuna → 50% tier-200, 50% tier-100.
			fortuneTiers: {
				objective: "FortMinTotalH",
				step: 100,
				tiers: [
					{
						id: "FortunaMinera_0",
						threshold: 0,
						drops: [[1, "minecraft:coal", 1, 3, 65, "§jCarbón", ["§7Fortuna Minera 0"]]],
					},
					{
						id: "FortunaMinera_1",
						threshold: 100,
						drops: [[1, "minecraft:coal", 2, 6, 85, "§jCarbón", ["§7Fortuna Minera I"]]],
						effects: {
							scoreboardAddsOnBreak: { DINERO: 2 },
						},
					},
					{
						id: "FortunaMinera_2",
						threshold: 200,
						drops: [
							[1, "minecraft:coal", 4, 8, 90, "§jCarbón", ["§7Fortuna Minera II"]],
							[2, "minecraft:iron_nugget", 1, 1, 30, "§fPepita", ["§7Fortuna Minera II"]],
						],
						effects: {
							scoreboardAddsOnBreak: { DINERO: 4 },
						},
					},
				],
			},
			// Modifiers vacío: reservado para overrides especiales (ej: silk touch)
			modifiers: [],
		}
		,
		// TEST: tronco de roble (skill: foraging)
		{
			id: "oak log",
			skill: "foraging",
			blockId: "minecraft:oak_log",
			areas: ["B"],
			// mined-state específico para este bloque
			minedBlockId: "minecraft:brown_terracotta",
			regenSeconds: 15,
			sounds: [{ id: "dig.wood", volume: 1, pitch: 1 }],
			scoreboardAddsOnBreak: {
				TRONCOS: 1,
			},
			drops: [
				[1, "minecraft:oak_log", 1, 1, 50, "MaderaTest", ["Madera."]],
				[2, "minecraft:oak_leaves", 1, 3, 33, "Hojitas", ["hojita :D"]],
			],
			modifiers: [
				{
					id: "FortunaTala_A",
					priority: 10,
					mode: "override",
					when: {
						all: [
							{ score: { objective: "FortTalTotalH", range: { min: 10, max: 120 } } },
						],
					},
					effects: {
						drops: [
							[1, "minecraft:oak_log", 1, 2, 65, "MaderaTest", ["§7Fortuna Tala A"]],
							[2, "minecraft:oak_leaves", 1, 4, 40, "Hojitas", ["§7Fortuna Tala A"]],
						],
						xp: {
							base: 6,
							scalingObjective: "ExpTalTotalH",
							gainObjective: "SkillXpTala",
							levelObjective: "SkillLvlTala",
							stepPerPoints: 10,
						},
						title: {
							enabled: true,
							source: "regen_xp",
							id: "foraging_xp_a",
							priority: 35,
							durationTicks: 30,
							content: ["§3+${xpGain}"],
						},
					},
				},
			],
		},

		// TEST: cultivo de zanahoria (skill: farming)
		{
			id: "carrots",
			skill: "farming",
			blockId: "minecraft:carrots",
			areas: ["A", "B"],
			// mined-state específico: queremos que quede vacío mientras regenera
			// Si por versión `minecraft:air` no se puede setear, usa "minecraft:structure_void".
			minedBlockId: "minecraft:air",
			regenSeconds: 12,
			sounds: [{ id: "dig.grass", volume: 0.8, pitch: 1.1 }],
			scoreboardAddsOnBreak: {
				ZANAHORIAS: 1,
			},
			// Sin xpOrbs (omitido a propósito)
			drops: [
				[1, "minecraft:carrot", 1, 3, 80, "Zanahoria", ["§7Test crop"]],
				[2, "minecraft:bone_meal", 1, 1, 15, "Fertilizante", ["§7Test crop"]],
			],
			modifiers: [
				{
					id: "FortunaCosecha_A",
					priority: 10,
					mode: "add",
					when: {
						all: [
							{ score: { objective: "FortCosTotalH", range: { min: 10, max: 200 } } },
						],
					},
					effects: {
						drops: [[99, "minecraft:carrot", 1, 1, 100, "Bonus", ["§7Fortuna Cosecha A"]]],
						xp: {
							base: 4,
							scalingObjective: "ExpCosTotalH",
							gainObjective: "SkillXpCosecha",
							levelObjective: "SkillLvlCosecha",
							stepPerPoints: 10,
						},
						title: {
							enabled: true,
							source: "regen_xp",
							id: "farming_xp_a",
							priority: 30,
							durationTicks: 30,
							content: ["§3+${xpGain}"],
						},
					},
				},
			],
		},
	],
};

// Compat: mantener nombres antiguos si otras partes del addon los usan
export const miningRegenConfig = skillRegenConfig;