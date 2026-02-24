export const miningSkillConfig = {
	enabled: true,
	debug: {
		enabled: false,
		console: false,
		tellPlayer: false,
	},

	scoreboards: {
		xp: "SkillXpMineria",
		level: "SkillLvlMineria",
	},

	rewards: {
		fortuneObjective: "FortMinPersonalH",
		fortunePerLevel: 4,
	},

	maxLevel: 60,

	// Catálogo base de niveles (declarativo):
	// - define umbrales y requisitos especiales.
	// - el runtime puede completar niveles faltantes con levelGeneration.
	levels: [
		{ level: 1, xpRequired: 0 },
		{ level: 2, xpRequired: 20 },
		{ level: 3, xpRequired: 100 },
		{
			level: 4,
			xpRequired: 500,
			requirements: [{ type: "scoreboardMin", objective: "Acto", min: 1 }],
			rewards: {
				messageAwards: ["Acceso a zona de minería avanzada"],
			},
		},
	],

	// Catálogo de generación declarativa para niveles faltantes.
	// El runtime completa desde max(base+1, startLevel) hasta maxLevel.
	levelGeneration: {
		enabled: true,
		startLevel: 5,
		xpStep: 250,
	},

	levelUpMessage: [
		"Habilidad mejorada!!!",
		"RECOMPENSAS",
		"+<PreviousFortune> -> <NextFortune> de Fortuna Minera",
		"<OtherAwards>",
	],

	runtime: {
		reconcileEveryTicks: 40,
		initializeOnJoin: true,
		notifyOnLevelDown: false,
		preserveHigherFortune: true,
	},
};
