// Feature: skills/lecture
// Registry único de estadísticas + IDs de scoreboards por capa.

/**
 * @typedef {"int"|"float"} StatType
 *
 * @typedef {{
 *  id: string,
 *  label: string,
 *  type: StatType,
 *  // Si true, el scoreboard almacena valor * 10 (enteros).
 *  x10?: boolean,
 *  // Escalado especial para stats puntuales.
 *  scale?: "percent_to_1000",
 *  // Defaults por jugador (solo para capa Personal).
 *  defaultPersonal?: number,
 *  personal: string,
 *  equipamiento: string,
 *  otros: string,
 *  total: string,
 * }} StatDef
 */

/** @type {StatDef[]} */
export const STAT_REGISTRY = [
	{
		id: "Poder",
		label: "Poder:",
		type: "int",
		personal: "PoderPersonalH",
		equipamiento: "PoderEquipamientoH",
		otros: "PoderOtrosH",
		total: "PoderTotalH",
	},
	{
		id: "Vida",
		label: "Vida:",
		type: "int",
		// Retrocompat con health/
		personal: "VidaMaxH",
		equipamiento: "VidaEquipamientoH",
		otros: "VidaOtrosH",
		// Retrocompat con health/
		total: "VidaMaxTotalH",
	},
	{
		id: "Defensa",
		label: "Defensa:",
		type: "int",
		// Retrocompat con el sistema actual (base personal legacy)
		personal: "DH",
		equipamiento: "DefensaEquipamientoH",
		otros: "DefensaOtrosH",
		total: "DefensaTotalH",
	},
	{
		id: "Dano",
		label: "Daño:",
		type: "int",
		// Retrocompat con el sistema actual (base personal legacy)
		personal: "DMGH",
		equipamiento: "DanoEquipamientoH",
		otros: "DanoOtrosH",
		total: "DanoTotalH",
	},
	{
		id: "DanoCrit",
		label: "Daño Crítico:",
		type: "float",
		// Retrocompat con el sistema actual (base personal legacy)
		personal: "CDH",
		equipamiento: "DanoCritEquipamientoH",
		otros: "DanoCritOtrosH",
		total: "DanoCritTotalH",
	},
	{
		id: "ProbCrit",
		label: "Probabilidad Crítica:",
		type: "float",
		// Retrocompat con el sistema actual (base personal legacy)
		personal: "CCH",
		equipamiento: "ProbCritEquipamientoH",
		otros: "ProbCritOtrosH",
		total: "ProbCritTotalH",
	},
	{
		id: "DanoVerd",
		label: "Daño Verdadero:",
		type: "int",
		personal: "DanoVerdPersonalH",
		equipamiento: "DanoVerdEquipamientoH",
		otros: "DanoVerdOtrosH",
		total: "DanoVerdTotalH",
	},
	{
		id: "Mana",
		label: "Mana:",
		type: "int",
		// Retrocompat con el sistema actual (base personal legacy)
		personal: "MH",
		equipamiento: "ManaEquipamientoH",
		otros: "ManaOtrosH",
		total: "ManaTotalH",
	},
	{
		id: "FortMin",
		label: "Fortuna Minera:",
		type: "int",
		personal: "FortMinPersonalH",
		equipamiento: "FortMinEquipamientoH",
		otros: "FortMinOtrosH",
		total: "FortMinTotalH",
	},
	{
		id: "ExpMin",
		label: "Experiencia Minera:",
		type: "int",
		personal: "ExpMinPersonalH",
		equipamiento: "ExpMinEquipamientoH",
		otros: "ExpMinOtrosH",
		total: "ExpMinTotalH",
	},
	{
		id: "FortTal",
		label: "Fortuna de Tala:",
		type: "int",
		personal: "FortTalPersonalH",
		equipamiento: "FortTalEquipamientoH",
		otros: "FortTalOtrosH",
		total: "FortTalTotalH",
	},
	{
		id: "FrenTal",
		label: "Frenesí de Tala:",
		type: "int",
		personal: "FrenTalPersonalH",
		equipamiento: "FrenTalEquipamientoH",
		otros: "FrenTalOtrosH",
		total: "FrenTalTotalH",
	},
	{
		id: "ExpTal",
		label: "Experiencia de Talado:",
		type: "int",
		personal: "ExpTalPersonalH",
		equipamiento: "ExpTalEquipamientoH",
		otros: "ExpTalOtrosH",
		total: "ExpTalTotalH",
	},
	{
		id: "FortCos",
		label: "Fortuna de Cosecha:",
		type: "int",
		personal: "FortCosPersonalH",
		equipamiento: "FortCosEquipamientoH",
		otros: "FortCosOtrosH",
		total: "FortCosTotalH",
	},
	{
		id: "MutAct",
		label: "Mutación Activa:",
		type: "float",
		scale: "percent_to_1000",
		personal: "MutActPersonalH",
		equipamiento: "MutActEquipamientoH",
		otros: "MutActOtrosH",
		total: "MutActTotalH",
	},
	{
		id: "ExpCos",
		label: "Experiencia de Cosecha:",
		type: "int",
		personal: "ExpCosPersonalH",
		equipamiento: "ExpCosEquipamientoH",
		otros: "ExpCosOtrosH",
		total: "ExpCosTotalH",
	},
	{
		id: "ExpCombate",
		label: "Experiencia de Combate:",
		type: "int",
		personal: "ExpCombatePersonalH",
		equipamiento: "ExpCombateEquipamientoH",
		otros: "ExpCombateOtrosH",
		total: "ExpCombateTotalH",
	},
	{
		id: "MA",
		label: "Multiplicador Aditivo:",
		type: "float",
		x10: true,
		defaultPersonal: 10,
		// Retrocompat con calc/
		personal: "MAH",
		equipamiento: "MAEquipamientoH",
		otros: "MAOtrosH",
		total: "MATotalH",
	},
	{
		id: "MM",
		label: "Multiplicador Multiplicativo:",
		type: "float",
		x10: true,
		defaultPersonal: 10,
		// Retrocompat con calc/
		personal: "MMH",
		equipamiento: "MMEquipamientoH",
		otros: "MMOtrosH",
		total: "MMTotalH",
	},
];

export const GATE_OBJECTIVE = "H";
