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
		// Recompensa base de dinero por rango de niveles (objetivo D).
		// Prioridad en runtime: nivel personalizado (scoreboardAddD/scoreboardAdd/rewards.scoreboardAdds)
		// > rango > default global.
		defaultScoreboardAddDRanges: [
			{ fromLevel: 1, toLevel: 20, amount: 500 },
			{ fromLevel: 21, toLevel: 60, amount: 500 },
		],
		// Fallback global si un nivel no cae en ningún rango.
		defaultScoreboardAddD: 500,
	},

	maxLevel: 60,
	titleColorFallback: "§f",

	// Catálogo explícito de niveles 1..60 (forzado, sin generación automática).
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

		// Casos de prueba in-game (requirements + rewards + mensajes)
		{
			level: 5,
			xpRequired: 750,
			titleColor: "§e",
			scoreboardAddD: 700,
			rewards: {
				messageAwards: ["§7[TEST] Nivel 5: override D=700"],
			},
		},
		{
			level: 6,
			xpRequired: 1000,
			titleColor: "§b",
			scoreboardAddD: 900,
			rewards: {
				messageAwards: [
					"§7[TEST] Recompensa secundaria visual (sin scoreboard add extra)",
					"§7[TEST] Recompensa doble (2 líneas)",
				],
			},
		},
		{
			level: 7,
			xpRequired: 1250,
			titleColor: "§a",
			scoreboardAddD: 1000,
			rewards: {
				messageAwards: [
					"§7[TEST] Recompensa extra visual A",
					"§7[TEST] Recompensa extra visual B",
					"§7[TEST] Recompensa triple (3 líneas)",
				],
			},
		},
		{
			level: 8,
			xpRequired: 1500,
			titleColor: "§d",
			requirements: [{ type: "scoreboardMin", objective: "Acto", min: 2 }],
			rewards: {
				messageAwards: ["§7[TEST] Requiere Acto >= 2"],
			},
		},
		{
			level: 9,
			xpRequired: 1750,
			titleColor: "§3",
			requirements: [{ type: "scoreboardMin", objective: "FamaMin", min: 10 }],
			scoreboardAddD: 1200,
			rewards: {
				messageAwards: ["§7[TEST] Requiere FamaMin >= 10"],
			},
		},
		{
			level: 10,
			xpRequired: 2000,
			titleColor: "§6",
			scoreboardAdd: { objective: "D", amount: 1500 },
			rewards: {
				messageAwards: ["§7[TEST] scoreboardAdd en objeto único"],
			},
		},
		{
			level: 11,
			xpRequired: 2250,
			titleColor: "§c",
			rewards: {
				messageAwards: ["§7[TEST] Usa recompensa por rango (sin override)"],
			},
		},
		{
			level: 12,
			xpRequired: 2500,
			titleColor: "§5",
			requirements: [{ type: "scoreboardMin", objective: "BossKills", min: 1 }],
			scoreboardAddD: 2000,
			rewards: {
				messageAwards: [
					"§7[TEST] Requiere BossKills >= 1",
					"§7[TEST] Recompensa secundaria visual",
				],
			},
		},
		{ level: 13, xpRequired: 2750 },
		{ level: 14, xpRequired: 3000 },
		{ level: 15, xpRequired: 3250 },
		{ level: 16, xpRequired: 3500 },
		{ level: 17, xpRequired: 3750 },
		{ level: 18, xpRequired: 4000 },
		{ level: 19, xpRequired: 4250 },
		{ level: 20, xpRequired: 4500 },
		{ level: 21, xpRequired: 4750 },
		{ level: 22, xpRequired: 5000 },
		{ level: 23, xpRequired: 5250 },
		{ level: 24, xpRequired: 5500 },
		{ level: 25, xpRequired: 5750 },
		{ level: 26, xpRequired: 6000 },
		{ level: 27, xpRequired: 6250 },
		{ level: 28, xpRequired: 6500 },
		{ level: 29, xpRequired: 6750 },
		{ level: 30, xpRequired: 7000 },
		{ level: 31, xpRequired: 7250 },
		{ level: 32, xpRequired: 7500 },
		{ level: 33, xpRequired: 7750 },
		{ level: 34, xpRequired: 8000 },
		{ level: 35, xpRequired: 8250 },
		{ level: 36, xpRequired: 8500 },
		{ level: 37, xpRequired: 8750 },
		{ level: 38, xpRequired: 9000 },
		{ level: 39, xpRequired: 9250 },
		{ level: 40, xpRequired: 9500 },
		{ level: 41, xpRequired: 9750 },
		{ level: 42, xpRequired: 10000 },
		{ level: 43, xpRequired: 10250 },
		{ level: 44, xpRequired: 10500 },
		{ level: 45, xpRequired: 10750 },
		{ level: 46, xpRequired: 11000 },
		{ level: 47, xpRequired: 11250 },
		{ level: 48, xpRequired: 11500 },
		{ level: 49, xpRequired: 11750 },
		{ level: 50, xpRequired: 12000 },
		{ level: 51, xpRequired: 12250 },
		{ level: 52, xpRequired: 12500 },
		{ level: 53, xpRequired: 12750 },
		{ level: 54, xpRequired: 13000 },
		{ level: 55, xpRequired: 13250 },
		{ level: 56, xpRequired: 13500 },
		{ level: 57, xpRequired: 13750 },
		{ level: 58, xpRequired: 14000 },
		{ level: 59, xpRequired: 14250 },
		{ level: 60, xpRequired: 14500 },
	],

	levelUpMessage: [
		"§s+§3======================§s+",
		"",
		"§b§lHABILIDAD MEJORADA§r",
		"§7Habilidad: <levelUpMining>",
		"",
		"§f>> §bAtributo",
		"   §6Fortuna §8<PreviousFortune>% §7-> §a<NextFortune>%",
		"   §7Más minerales mientras más alto.",
		"",
		"§f>> §bRecompensas",
		"   §6+<ScoreboardAddD> §7Dinero",
		"<OtherAwards>",
		"",
		"§s+§3======================§s+",
	],

	runtime: {
		reconcileEveryTicks: 40,
		initializeOnJoin: true,
		notifyOnLevelDown: false,
		preserveHigherFortune: true,
		titles: {
			enabledByDefault: true,
			source: "skill_xp",
			id: "mining_xp",
			priority: 40,
			durationTicks: 40,
			contentTemplate: ["+${xpGain} §8| §b${skill} §8| §7${xpActual}/${xpRequeriment}"],
			noLevelsContentTemplate: ["+${xpGain} §8| §b${skill} §8| §7${xpTotal}"],
		},
	},
};
