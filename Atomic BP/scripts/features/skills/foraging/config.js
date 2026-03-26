export const foragingSkillConfig = {
	enabled: true,
	debug: {
		enabled: false,
		console: false,
		tellPlayer: false,
	},

	scoreboards: {
		xp: "SkillXpTala",
		level: "SkillLvlTala",
	},

	rewards: {
		fortuneObjective: "FortTalPersonalH",
		fortunePerLevel: 4,
		defaultScoreboardAddDRanges: [
			{ fromLevel: 1, toLevel: 10, amount: 350 },
			{ fromLevel: 11, toLevel: 20, amount: 500 },
		],
		defaultScoreboardAddD: 350,
	},

	maxLevel: 20,
	titleColorFallback: "§f",

	levels: [
		{ level: 1, xpRequired: 0 },
		{ level: 2, xpRequired: 20, titleColor: "§a" },
		{ level: 3, xpRequired: 60, titleColor: "§2" },
		{ level: 4, xpRequired: 140, titleColor: "§e" },
		{
			level: 5,
			xpRequired: 260,
			titleColor: "§6",
			rewards: {
				messageAwards: ["§7Acceso a mejores recompensas de tala"],
			},
		},
		{ level: 6, xpRequired: 420, titleColor: "§b" },
		{ level: 7, xpRequired: 620, titleColor: "§3" },
		{
			level: 8,
			xpRequired: 860,
			titleColor: "§d",
			requirements: [{ type: "scoreboardMin", objective: "Acto", min: 1 }],
			rewards: {
				messageAwards: ["§7Dominas mejor la propagación de tala"],
			},
		},
		{ level: 9, xpRequired: 1140, titleColor: "§c" },
		{ level: 10, xpRequired: 1460, titleColor: "§4", scoreboardAddD: 800 },
		{ level: 11, xpRequired: 1820, titleColor: "§a" },
		{ level: 12, xpRequired: 2220, titleColor: "§2" },
		{ level: 13, xpRequired: 2660, titleColor: "§e" },
		{ level: 14, xpRequired: 3140, titleColor: "§6" },
		{
			level: 15,
			xpRequired: 3660,
			titleColor: "§b",
			requirements: [{ type: "scoreboardMin", objective: "TRONCOS", min: 50 }],
			rewards: {
				messageAwards: ["§7Mayor precisión en rutas de tala"],
			},
		},
		{ level: 16, xpRequired: 4220, titleColor: "§3" },
		{ level: 17, xpRequired: 4820, titleColor: "§d" },
		{ level: 18, xpRequired: 5460, titleColor: "§5" },
		{ level: 19, xpRequired: 6140, titleColor: "§c" },
		{ level: 20, xpRequired: 6860, titleColor: "§4", scoreboardAddD: 1250 },
	],

	levelUpMessage: [
		"§s+§2======================§s+",
		"",
		"§a§lHABILIDAD MEJORADA§r",
		"§7Habilidad: <levelUpForaging>",
		"",
		"§f>> §aAtributo",
		"   §6Fortuna de Tala §8<PreviousFortune>% §7-> §a<NextFortune>%",
		"   §7Más eficiencia al talar árboles válidos.",
		"",
		"§f>> §aRecompensas",
		"   §6+<ScoreboardAddD> §7Dinero",
		"<OtherAwards>",
		"",
		"§s+§2======================§s+",
	],

	runtime: {
		reconcileEveryTicks: 40,
		initializeOnJoin: true,
		notifyOnLevelDown: false,
		preserveHigherFortune: true,
		titles: {
			enabledByDefault: true,
			source: "skill_xp",
			id: "foraging_xp",
			priority: 40,
			durationTicks: 40,
			contentTemplate: ["+${xpGain} §8| §a${skill} §8| §7${xpActual}/${xpRequeriment}"],
			noLevelsContentTemplate: ["+${xpGain} §8| §a${skill} §8| §7${xpTotal}"],
		},
	},
};