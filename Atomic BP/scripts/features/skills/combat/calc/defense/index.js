import { defenseCalcConfig } from "./config.js";
import { toNumberOr, floorFinite, clampMin0Int } from "../utilMath.js";

/**
 * Calcula el daño mitigado por defensa, aplicando penetración de armadura y cap de reducción.
 *
 * Fórmula:
 *   defEfectiva = defensa × (1 - clamp(penPct, 0, 100) / 100)
 *   ratio       = baseConstant / (defEfectiva + baseConstant)
 *   ratio       = max(ratio, 1 - maxReductionPercent / 100)   // cap
 *   resultado   = floor(danoBase × ratio), clamped ≥ 0
 *
 * @param {typeof defenseCalcConfig} cfg  Configuración de defensa (defenseCalcConfig o override)
 * @param {number} danoBase               Daño antes de mitigación (entero positivo)
 * @param {number} defensa                Defensa total del objetivo
 * @param {number} armorPenetrationPct    Penetración de armadura del atacante (0–100)
 * @returns {number} Daño mitigado (entero ≥ 0)
 */
export function computeDefenseMitigation(cfg, danoBase, defensa, armorPenetrationPct) {
	const base = toNumberOr(danoBase, 0);
	if (base <= 0) return 0;

	const f = cfg?.formula ?? defenseCalcConfig.formula;
	const baseConstant = toNumberOr(f.baseConstant, 75);

	// Penetración: reduce la defensa efectiva
	let def = toNumberOr(defensa, 0);
	if (def < 0) def = 0;
	const pen = Math.max(0, Math.min(100, toNumberOr(armorPenetrationPct, 0)));
	const defEfectiva = def * (1 - pen / 100);

	// Ratio de daño pasante: baseConstant / (defEfectiva + baseConstant)
	// def=0 → 1.0, def=baseConstant → 0.5, def→∞ → 0
	let ratio = baseConstant / (defEfectiva + baseConstant);
	if (!Number.isFinite(ratio)) ratio = 0;

	// Cap: ratio no puede bajar de (1 - maxReduction/100)
	const maxRedPct = toNumberOr(f.maxReductionPercent, 100);
	if (maxRedPct > 0 && maxRedPct < 100) {
		const minRatio = 1 - maxRedPct / 100;
		if (ratio < minRatio) ratio = minRatio;
	}

	return clampMin0Int(floorFinite(base * ratio));
}

/**
 * Wrapper de compatibilidad — misma firma que la función original en damage_dealt/math.js.
 * Usa config por defecto, sin penetración de armadura.
 *
 * @param {number} danoBase  Daño antes de mitigación
 * @param {number} defensa   Defensa total del objetivo
 * @returns {number} Daño mitigado (entero ≥ 0)
 */
export function applyDefenseMultiplier(danoBase, defensa) {
	return computeDefenseMitigation(defenseCalcConfig, danoBase, defensa, 0);
}
