// Arquitectura AntiCheat (solo estructura)
// Aquí se define la configuración central y los toggles por sección.

export const anticheatConfig = {
	enabled: true,

	// Sanciones (arquitectura)
	// Si una sanción se asigna a un jugador, debe aplicarse inmediatamente.
	// Nota: algunas acciones (ban real en Realm/servidor) pueden depender de permisos/entorno.
	sanctions: {
		// sanción 1: /clear
		1: {
			name: "Clear",
			actions: [{ type: "ClearInventory" }],
		},

		// sanción 2: Ban de 7d sin wipe
		2: {
			name: "Ban 7d (sin wipe)",
			banDays: 7,
			wipe: false,
		},

		// sanción 3: Ban de 15d sin wipe
		3: {
			name: "Ban 15d (sin wipe)",
			banDays: 15,
			wipe: false,
		},

		// sanción 4: reset de scoreboards (Dinero, Niveles, todo)
		4: {
			name: "Reset scoreboards",
			// Resetea todos los scoreboards del jugador. Se ejecuta como jugador:
			// `/scoreboard players reset @s *`
			mode: "All",
		},

		// sanción 5: reset completo (wipe)
		5: {
			name: "Wipe",
			wipe: true,
		},

		// sanción 6: Ban de 30d con wipe
		6: {
			name: "Ban 30d (con wipe)",
			banDays: 30,
			wipe: true,
		},

		// sanción 7: Ban permanente del servidor/Realm/mundo
		7: {
			name: "Ban permanente",
			banDays: null,
			permanent: true,
			wipe: false,
		},
	},

	// Logging (arquitectura)
	logging: {
		console: true,
		bufferSize: 250,
	},

	// Script events (scriptevent)
	// Permite control manual sin quitar/agregar el script.
	// Comandos sugeridos:
	// - `/scriptevent atomic:ban ban:true` (activa ban-kick)
	// - `/scriptevent atomic:ban ban:false` (desactiva ban-kick)
	// - `/scriptevent atomic:ban unban:NombreJugador`
	// - `/scriptevent atomic:anticheat enabled:false` (solo host/owner)
	// - `/scriptevent atomic:anticheat enabled:true` (solo host/owner)
	//
	// Actualizado: el control del kick a baneados ahora es:
	// - `/scriptevent atomic:kick true` (activa kick a jugadores baneados)  [requiere tag SX]
	// - `/scriptevent atomic:kick false` (desactiva kick a jugadores baneados) [requiere tag SX]
	scriptevents: {
		enabled: true,

		// Host/owner: requiere OP + (nombre o tag). Ajusta a tu caso.
		ownerNames: ["Anthe4743"],
		ownerTag: "SX",

		// Ban control: por defecto permite a OP (además del owner).
		allowOperatorsBanControl: true,
	},

	// Storage (persistencia) - Scoreboards configurables
	// Objetivo: almacenar datos por jugador sin usar el script como "base de datos".
	// Nota: "type" se conserva por consistencia con comandos, aunque el Script API crea objectives tipo dummy.
	storage: {
		scoreboards: {
			// Feature flags globales (persistencia de toggles)
			// Almacena valores 0/1 en "fake players" dentro de este objective:
			// - ac_enabled
			// - ac_ban_kick_enabled
			featureFlags: {
				scoreboard: "ac_feature_flags",
				type: "dummy",
				display: "ac_feature_flags",
			},

			// Advertencias del jugador (persistentes)
			playerWarnings: {
				scoreboard: "advertencias",
				type: "dummy",
				display: "advertencias",
			},

			// Ban best-effort: fecha fin (epoch seconds)
			banUntil: {
				scoreboard: "ac_ban_until",
				type: "dummy",
				display: "ac_ban_until",
			},

			// Ban best-effort: SEGUNDOS RESTANTES del ban (por jugador)
			// Se mantiene actualizado por script (reloj) y permite verificar con comandos.
			banSeconds: {
				scoreboard: "ac_ban_seconds",
				type: "dummy",
				display: "ac_ban_seconds",
			},

			// Ban best-effort: id de la sanción (2/3/6/7)
			banSanction: {
				scoreboard: "ac_ban_sanction",
				type: "dummy",
				display: "ac_ban_sanction",
			},
		},
	},

	// Advertencias internas (reglas anti falsos-positivos)
	warnings: {
		// Advertencias internas: se resetean automáticamente.
		internal: {
			// Si pasan N segundos sin nuevas flags, se reinicia el acumulador interno.
			decaySeconds: 1800,

			// Cuántos puntos internos equivalen a 1 advertencia al jugador.
			pointsPerPlayerWarning: 4,

			// Limita memoria (cantidad de jugadores trackeados).
			maxStoredPlayers: 500,
		},

		// Advertencias al jugador: NO se resetean (solo manual o por reporte).
		player: {
			// Al llegar a 3 advertencias, se aplica sanción temporal.
			sanctionAtWarnings: 3,

			// Sanción a aplicar cuando se llega al umbral.
			// Puede ser distinta por check mediante hard-flag (ej: abnormalStacks -> 2).
			sanctionId: 2,
		},
	},

	// 1) Catálogo de Items vanilla ilegales o no permitidos
	illegalItems: {
		enabled: true,
		catalogPath: "./catalogs/illegal-items.json",
	},

	// 2) Bloques vanilla ilegales
	illegalBlocks: {
		enabled: true,
		catalogPath: "./catalogs/illegal-blocks.json",
	},

	// 3) Detección de encantamientos ilegales
	illegalEnchants: {
		enabled: true,
	},

	// 4) Prevención de entidades masivas
	entityFlood: {
		enabled: true,
		maxEntitiesPerChunk: 0, // TODO: definir
	},

	// 5) Anti no-clip
	noclip: {
		enabled: true,
	},

	// 6) Detección de Fly
	fly: {
		enabled: true,

		// Muestreo
		sampleEveryTicks: 1,
		cleanupEveryTicks: 200,

		// Evidencia acumulada
		decayPerSecond: 0.6,
		evidenceEveryTicks: 10,
		flagThreshold: 12,
		flagCooldownTicks: 240,
		flagSeverity: 1,
		logEvidence: false,

		// Airtime / física
		jumpGraceAirTicks: 8,
		suspiciousAirTicks: 14,

		// Ascenso / hover
		sustainedAscentMinDy: 0.04,
		sustainedAscentMinTicks: 5,
		hoverMaxAbsDy: 0.02,
		hoverMinTicks: 8,

		// Caídas largas: umbral (dy por tick) bajo el cual NO se suma evidencia por airtime/strafe.
		// Default ~ gravedad vanilla por tick.
		fastFallDyThreshold: -0.08,

		// Impulsos legítimos (wind_charge, explosiones, wind_burst, dashes tipo "Lunge")
		impulseExemptTicks: 14,
		impulseUpwardDyThreshold: 0.6,
		dashHorizontalBlocks: 1.25,
		dashMaxAbsDy: 0.25,
		itemUseImpulseTicks: 14,
		itemUseImpulseItems: ["minecraft:wind_charge", "minecraft:mace", "minecraft:trident"],

		// Movimiento horizontal en el aire
		airStrafeMinHorizontal: 0.12,
		airStrafeMinTicks: 10,

		// Exenciones anti falsos-positivos
		teleportDistanceBlocks: 6,
		afterTeleportExemptTicks: 20,
		hurtExemptTicks: 12,
		bounceExemptTicks: 12,

		// Lag spike tolerance
		freezeEpsilon: 0.0001,
		freezeMinTicks: 4,
		lagJumpDistanceBlocks: 4,
		lagExemptTicks: 20,

		// Repetición (patrón reiterado)
		repetitionWindowTicks: 200,
		repetitionMinEvents: 3,
	},

	// 7) Cambios bruscos de Y (Teletransporte)
	// NOTA: teleportY (check) está removido temporalmente por inestabilidad.
	teleportY: {
		enabled: true,
	},

	// 9) Anti Kill-aura
	// NOTA: killAura (check) está removido temporalmente por inestabilidad.
	killAura: {
		enabled: true,
	},

	// 10) Detección de autoclicker (removido temporalmente por inestabilidad)
	autoclicker: {
		enabled: true,

		// Ventanas / limpieza
		analysisWindowMs: 2000,
		resetGapMs: 1500,
		minIntervalMs: 35,
		maxIntervals: 30,
		maxHitTimes: 40,
		cleanupEveryTicks: 200,
		minIntervalsForAnalysis: 12,

		// Evidencia acumulada
		decayPerSecond: 0.5,
		flagThreshold: 18,
		flagCooldownTicks: 300,
		flagSeverity: 1,
		logEvidence: false,

		// Reglas CPS (ignorar <= 9 para reducir falsos positivos)
		ignoreCpsBelowOrEqual: 9,
		observeCpsMin: 10,
		analyzeCpsMin: 16,
		suspiciousCpsMin: 18,
		highCpsMin: 20,

		// Regularidad (coeficiente de variación: std/mean)
		cvAnalyzeMax: 0.05,
		cvSuspiciousMax: 0.04,
		cvHighMax: 0.03,

		// Repetición de patrones de intervalos
		patternLength: 5,
		patternQuantizeMs: 2,
		patternMinRepeats: 3,
		patternDecayMs: 5000,
		// Modo conservador: exige repetición de patrón para sumar evidencia.
		requirePatternRepeat: true,
	},

	// 11) Detección de Reach (removido temporalmente por inestabilidad)
	reach: {
		enabled: true,
	},

	// 12) Detección de Aimassist (removido temporalmente por inestabilidad)
	aimAssist: {
		enabled: true,

		// Muestreo (rotación por ventana de tiempo)
		sampleEveryTicks: 1,
		sampleWindowTicks: 40,

		// Violation Level (acumula evidencia y decae con el tiempo)
		decayPerSecond: 0.25,
		flagThreshold: 8,
		flagCooldownTicks: 200,
		flagSeverity: 1,

		// Métrica 1: Error angular antes del golpe
		errorCriticalDeg: 0.5,
		errorMaxConsiderDeg: 10,

		// Métrica 2: Snap angular antes del golpe
		snapAngleDeg: 20,
		snapWindowTicks: 2,
		snapRequiresErrorBelowDeg: 3,

		// Alcance razonable para calcular dirección al objetivo (reduce ruido/FP)
		minTargetDistance: 1.5,
		maxTargetDistance: 6,

		// Métrica 3: Tracking “demasiado perfecto” (heurística)
		trackingWindowTicks: 10,
		trackingErrorDeg: 2,
		trackingHitsWindowTicks: 200,
		trackingHitsMin: 3,
		trackingMeanSpeedDeg: 1.2,
		trackingSpeedVarianceDeg2: 0.25,

		// Métrica 4: Repetición estadística (firma de micro-ajustes)
		repetitionWindow: 4,
		repetitionQuantizeDeg: 0.5,
		repetitionMinRepeats: 3,
		repetitionDecayTicks: 600,
	},

	// 13) Stack sizes anómalos
	abnormalStacks: {
		enabled: true,
		checkEveryTicks: 20,
		// Si true: al detectar un stack imposible, se considera evidencia 100% y se pide sanción inmediata.
		immediateSanction: true,
		// Sanción a aplicar cuando se detecta un stack imposible (hard-flag)
		sanctionId: 2,
		// Si true, reduce automáticamente a maxAmount cuando detecta stack ilegal.
		clampToMax: true,
		// Si true, elimina del inventario items contenedores (shulkers/bundle/ender_chest)
		// para evitar ocultar stacks ilegales en su contenido.
		// Nota: inspeccionar el contenido de esos items no siempre es posible vía Script API.
		removeContainerItems: true,
	},

	// 14) TPS del servidor
	tps: {
		enabled: true,
		// Cada cuántos ticks muestrear (>=10 recomendado)
		checkEveryTicks: 20,
		// Suavizado (EMA): 0.2 = reacciona, pero evita ruido
		emaAlpha: 0.2,
		initialTps: 20,
		maxTps: 20,
		logToConsole: false,

		// Cuando el TPS baja, el anticheat en general debe ser menos estricto.
		// Se aplica como multiplicador a la severidad de los flags (no afecta hard-flags).
		// Orden: se toma la primera regla cuyo minTps sea <= al TPS actual.
		severityScalingRules: [
			{ minTps: 18, multiplier: 1 },
			{ minTps: 14, multiplier: 0.75 },
			{ minTps: 10, multiplier: 0.5 },
			{ minTps: 0, multiplier: 0.25 },
		],
	},

	// 15) Permisos de Administrador por nombres
	adminAllowlist: {
		enabled: true,

		// Si este tag es "none"/"null"/"" no hay excepción por tag.
		// Si es un string (ej: "staff"), cualquier jugador con esa tag podrá usar creativo/espectador
		// además de los operadores.
		exceptionTag: "none",

		// Modo de juego (arquitectura): restringe modos no permitidos.
		gameModes: {
			denyCreative: true,
			denySpectator: true,
			// Acción sugerida cuando un jugador no permitido está en creativo/espectador.
			// Por ahora se intenta forzar Survival, y siempre se registra warning.
			action: "ForceSurvival", // ForceSurvival | WarnOnly
			checkEveryTicks: 20,
		},

		admins: [
			"antheuss",
			"ElianNOSFW",
			"Anthe4743"
		],
	},
};
