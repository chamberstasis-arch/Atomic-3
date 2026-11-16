/**
 * Configuración centralizada del módulo de mitigación de defensa.
 *
 * Para agregar nuevos modificadores que afecten la fórmula:
 *   1. Añadir el scoreboard en `scores` siguiendo convención `*TotalH`
 *   2. Agregar una entrada en `modifiers[]` con { type, source, value }
 *   3. El consumidor lee el score y pasa el valor a computeDefenseMitigation()
 *
 * Interfaz de modifier (futuro):
 *   { type: "flat"|"percent", source: string, value: number }
 *   - "flat"    → resta directa a defensa antes de fórmula
 *   - "percent" → reduce defensa por porcentaje (como armorPenetration)
 */
export const defenseCalcConfig = {
	formula: {
		// Constante base de la curva: baseConstant / (def + baseConstant)
		// def=0 → ratio=1.0 (sin reducción), def=baseConstant → ratio=0.5 (50% reducción)
		baseConstant: 75,

		// Cap máximo de reducción de daño (1–100). Previene que defensa muy alta
		// reduzca daño a casi 0. Ej: 90 → la defensa nunca reduce más del 90%.
		// Usar 100 para desactivar el cap (la curva asintótica lo limita naturalmente).
		maxReductionPercent: 90,
	},

	// Scoreboards consumidos/referenciados por este módulo.
	// Los valores los lee el consumidor (funciones puras); aquí se documentan como contrato.
	scores: {
		// Defensa total del objetivo (producido por lecture/)
		defenseTotal: "DefensaTotalH",
		// Fallback legacy para defensa
		defenseTotalLegacy: "DtotalH",
		// Penetración de armadura del atacante (% de defensa ignorada, 0–100)
		// Producido por lecture/ en fase futura; por ahora se usa como score manual.
		armorPenetration: "PenArmorTotalH",
	},

	// Modificadores adicionales extensibles (vacío por ahora).
	// Cada entrada describe una fuente de mitigación adicional que un consumidor
	// puede resolver y pasar a computeDefenseMitigation() en el futuro.
	//
	// Ejemplo de uso futuro con effects/:
	//   { type: "percent", source: "EffDebilidad", value: 0 }
	//   → effects/ leería EffDebilidad y pasaría el % de reducción extra
	modifiers: [],
};
