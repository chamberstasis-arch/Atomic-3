import { anticheatConfig } from "../features/anticheat/anticheat.config.js";
import { damageCalcConfig } from "../features/skills/combat/calc/config.js";
import { STAT_REGISTRY } from "../features/skills/lecture/statRegistry.js";
import { foragingSkillConfig } from "../features/skills/foraging/config.js";
import { miningSkillConfig } from "../features/skills/mining/config.js";
import { skillRegenConfig } from "../features/skills/regeneration/config.js";
import achievementsConfig from "../features/achievements/config.js";
import titlesPriorityConfig from "../systems/titlesPriority/config.js";

function safeString(value) {
	return String(value != null ? value : "").trim();
}

/**
 * @typedef {{ id: string, displayName?: string }} ObjectiveDef
 */

function addObjective(list, seen, id, displayName = undefined) {
	const objId = safeString(id);
	if (!objId) return;
	if (seen.has(objId)) return;
	seen.add(objId);
	list.push({ id: objId, displayName: displayName != null ? String(displayName) : undefined });
}

function addObjectivesFromMap(list, seen, mapObj) {
	if (!mapObj || typeof mapObj !== "object") return;
	for (const key of Object.keys(mapObj)) {
		addObjective(list, seen, key, key);
	}
}

function addRegenObjectives(list, seen, config) {
	const metrics = config?.metrics?.scoreboardAddsOnBreak;
	addObjectivesFromMap(list, seen, metrics);

	const blocks = Array.isArray(config?.blocks) ? config.blocks : [];
	for (const block of blocks) {
		addObjectivesFromMap(list, seen, block?.scoreboardAddsOnBreak);

		const modifiers = block?.modifiers;
		if (!modifiers) {
			// noop: no modifiers to scan
		} else if (Array.isArray(modifiers)) {
			for (const rule of modifiers) {
				if (!rule || typeof rule !== "object") continue;
				const effects = rule?.effects && typeof rule.effects === "object" ? rule.effects : rule;
				addObjectivesFromMap(list, seen, effects?.scoreboardAddsOnBreak);

				const xp = effects?.xp && typeof effects.xp === "object" ? effects.xp : null;
				const gainObjective = xp ? safeString(xp.gainObjective) : "";
				if (gainObjective) addObjective(list, seen, gainObjective, gainObjective);
			}
		} else if (typeof modifiers === "object") {
			for (const mod of Object.values(modifiers)) {
				addObjectivesFromMap(list, seen, mod?.scoreboardAddsOnBreak);
			}
		}

		// XP block-level (independiente de fortuna)
		const blockXp = block?.xp && typeof block.xp === "object" ? block.xp : null;
		if (blockXp) {
			const go = safeString(blockXp.gainObjective);
			if (go) addObjective(list, seen, go, go);
		}

		const spread = block?.spread && typeof block.spread === "object" ? block.spread : null;
		const spreadObjective = safeString(spread?.objective);
		if (spreadObjective) addObjective(list, seen, spreadObjective, spreadObjective);

		// Fortune tiers: escanear tiers para scoreboards (solo scoreboardAddsOnBreak)
		const ft = block?.fortuneTiers;
		if (ft && typeof ft === "object") {
			const tiers = Array.isArray(ft.tiers) ? ft.tiers : [];
			for (const tier of tiers) {
				if (!tier || typeof tier !== "object") continue;
				const te = tier.effects && typeof tier.effects === "object" ? tier.effects : null;
				if (!te) continue;
				addObjectivesFromMap(list, seen, te.scoreboardAddsOnBreak);
			}
		}
	}

	const bySkill = config?.runtime?.titles?.progressObjectivesBySkill;
	if (bySkill && typeof bySkill === "object") {
		for (const def of Object.values(bySkill)) {
			if (!def || typeof def !== "object") continue;
			const xpObjective = safeString(def.xp);
			const lvlObjective = safeString(def.level);
			if (xpObjective) addObjective(list, seen, xpObjective, xpObjective);
			if (lvlObjective) addObjective(list, seen, lvlObjective, lvlObjective);
		}
	}

	const spreadDefaults = config?.runtime?.spread;
	const spreadDefaultObjective = safeString(spreadDefaults?.objective);
	if (spreadDefaultObjective) addObjective(list, seen, spreadDefaultObjective, spreadDefaultObjective);
}

const PLACEHOLDER_RE = /\$\{([^:}]+):([^}]+)\}/g;

function addTitlesPriorityObjectives(list, seen, config) {
	const t = config?.titles;
	let titles = [];
	if (Array.isArray(t)) titles = t;
	else if (t && typeof t === "object") {
		for (const [id, def] of Object.entries(t)) {
			if (!def || typeof def !== "object") continue;
			titles.push({ id, ...def });
		}
	}

	for (const entry of titles) {
		if (!entry || typeof entry !== "object") continue;
		const score = entry?.display_if?.score;
		const obj = score && typeof score === "object" ? safeString(score.objective) : "";
		if (obj) addObjective(list, seen, obj, obj);

		const content = entry.content;
		const lines = Array.isArray(content) ? content : [content];
		for (const line of lines) {
			const s = safeString(line);
			if (!s) continue;
			PLACEHOLDER_RE.lastIndex = 0;
			for (let m = PLACEHOLDER_RE.exec(s); m; m = PLACEHOLDER_RE.exec(s)) {
				const placeholderObj = safeString(m[1]);
				if (placeholderObj) addObjective(list, seen, placeholderObj, placeholderObj);
			}
		}
	}
}

function addSkillProgressionObjectives(list, seen, config) {
	const xp = safeString(config?.scoreboards?.xp);
	const lvl = safeString(config?.scoreboards?.level);
	const fortuneObjective = safeString(config?.rewards?.primaryObjective ?? config?.rewards?.fortuneObjective);
	if (xp) addObjective(list, seen, xp, xp);
	if (lvl) addObjective(list, seen, lvl, lvl);
	if (fortuneObjective) addObjective(list, seen, fortuneObjective, fortuneObjective);

	const levels = Array.isArray(config?.levels) ? config.levels : [];
	for (const level of levels) {
		if (!level || typeof level !== "object") continue;
		const rewards = level?.rewards && typeof level.rewards === "object" ? level.rewards : null;
		const adds = Array.isArray(rewards?.scoreboardAdds) ? rewards.scoreboardAdds : [];
		for (const add of adds) {
			if (!add || typeof add !== "object") continue;
			const objective = safeString(add.objective);
			if (objective) addObjective(list, seen, objective, objective);
		}

		const requirements = Array.isArray(level?.requirements) ? level.requirements : [];
		for (const req of requirements) {
			if (!req || typeof req !== "object") continue;
			const type = safeString(req.type).toLowerCase();
			if (type !== "scoreboardmin") continue;
			const objective = safeString(req.objective);
			if (objective) addObjective(list, seen, objective, objective);
		}
	}
}

export function buildScoreboardCatalog() {
	/** @type {ObjectiveDef[]} */
	const list = [];
	const seen = new Set();

	// --- AntiCheat (configurable) ---
	{
		const sb = anticheatConfig?.storage?.scoreboards || {};
		addObjective(list, seen, sb?.featureFlags?.scoreboard ?? "ac_feature_flags", sb?.featureFlags?.display ?? "ac_feature_flags");
		addObjective(list, seen, sb?.playerWarnings?.scoreboard ?? "advertencias", sb?.playerWarnings?.display ?? "advertencias");
		addObjective(list, seen, sb?.banUntil?.scoreboard ?? "ac_ban_until", sb?.banUntil?.display ?? "ac_ban_until");
		addObjective(list, seen, sb?.banSeconds?.scoreboard ?? "ac_ban_seconds", sb?.banSeconds?.display ?? "ac_ban_seconds");
		addObjective(list, seen, sb?.banSanction?.scoreboard ?? "ac_ban_sanction", sb?.banSanction?.display ?? "ac_ban_sanction");
	}

	// --- Skills / Combat / Calc (configurable) ---
	{
		const o = damageCalcConfig?.objectives || {};
		const d = damageCalcConfig?.displayNames || {};
		addObjective(list, seen, o.enabled, d.enabled);
		addObjective(list, seen, o.baseDamage, d.baseDamage);
		addObjective(list, seen, o.baseCritDamage, d.baseCritDamage);
		addObjective(list, seen, o.baseCritChance, d.baseCritChance);
		addObjective(list, seen, o.baseDefense, d.baseDefense);
		addObjective(list, seen, o.baseMana, d.baseMana);
		addObjective(list, seen, o.baseVidaMax, d.baseVidaMax);
		addObjective(list, seen, o.multAdd, d.multAdd);
		addObjective(list, seen, o.multMult, d.multMult);
		addObjective(list, seen, o.outFinalNoCrit, d.outFinalNoCrit);
		addObjective(list, seen, o.outFinalCrit, d.outFinalCrit);
		addObjective(list, seen, o.outCritChanceTotal, d.outCritChanceTotal);
		addObjective(list, seen, o.outDefenseTotal, d.outDefenseTotal);
		addObjective(list, seen, o.outManaTotal, d.outManaTotal);
		addObjective(list, seen, o.outVidaMaxTotal, d.outVidaMaxTotal);
	}

	// --- Skills / Lecture (data-driven) ---
	{
		const registry = Array.isArray(STAT_REGISTRY) ? STAT_REGISTRY : [];
		for (const stat of registry) {
			if (!stat || typeof stat !== "object") continue;
			addObjective(list, seen, stat.personal, stat.personal);
			addObjective(list, seen, stat.equipamiento, stat.equipamiento);
			addObjective(list, seen, stat.otros, stat.otros);
			addObjective(list, seen, stat.total, stat.total);
		}
	}

	// --- Combat / Health ---
	addObjective(list, seen, "H", "H"); // Modo Historia (1 = Esta en el modo Historia, 0 = No.)
	addObjective(list, seen, "Vida", "Vida"); // Vida actual del jugador
	addObjective(list, seen, "VidaMaxH", "VidaMax Base"); // Vida maxima base (sin mejoras)
	addObjective(list, seen, "VidaMaxTotalH", "VidaMax Total"); // Vida maxima total (con mejoras)
	addObjective(list, seen, "VidaAbsorcion", "Vida Absorcion"); // Vida de absorcion (corazones dorados)
	addObjective(list, seen, "HDead", "HDead");

	// --- Combat / Damage Dealt ---
	addObjective(list, seen, "DanoFinalSC", "Dano Final SC"); // Daño final del jugador SIN critico sin contar defensa
	addObjective(list, seen, "DanoFinalCC", "Dano Final CC"); // Daño final del jugador CON critico sin contar defensa
	addObjective(list, seen, "ProbabilidadCriticaTotal", "Prob Crit Total"); // Probabilidad de critico total del jugador
	addObjective(list, seen, "DtotalH", "Def Total"); // Defensa total del jugador o mob
	addObjective(list, seen, "DMGH", "DMGH"); // Daño del jugador base
	addObjective(list, seen, "LastKillerId", "Last Killer Id"); // Id del ultimo que mató al jugador
	addObjective(list, seen, "LastKillTick", "Last Kill Tick"); // Tick de la ultima kill del jugador

	// --- Combat / Effects (custom) ---
	addObjective(list, seen, "EffVeneno", "Eff Veneno");
	addObjective(list, seen, "EffCongelamiento", "Eff Congelamiento");
	addObjective(list, seen, "EffCalor", "Eff Calor");

	// --- mcfunction (General3 / Seguridad1) ---
	addObjective(list, seen, "ticksegundos", "ticksegundos"); // Contador de ticks en segundos
	addObjective(list, seen, "segundos", "segundos"); // Contador de segundos
	addObjective(list, seen, "minutos", "minutos"); // Contador de minutos
	addObjective(list, seen, "horas", "horas"); // Contador de horas
	addObjective(list, seen, "dias", "dias"); // Contador de dias
	addObjective(list, seen, "limbo", "limbo"); // Limbo status
	addObjective(list, seen, "lobbytitle", "lobbytitle"); // Titulo de lobby
	addObjective(list, seen, "lt", "lt"); // Lobby title multicolor
	addObjective(list, seen, "ltsuperior", "ltsuperior"); // Lobby title multicolor superior
	addObjective(list, seen, "Coo", "Coo"); // Cooldown general (IMPORTANTE!)
	addObjective(list, seen, "CooHelper", "CooHelper"); // Cooldown de actionbar para helper
	addObjective(list, seen, "D", "Dinero"); // Dinero del jugador
	addObjective(list, seen, "DB", "DineroBanco"); // Dinero en el banco del jugador
	addObjective(list, seen, "DBlimite", "DBlimite"); // Límite del banco del jugador
	addObjective(list, seen, "Mejora", "MejoraBanco"); // Nivel de mejora del banco
	addObjective(list, seen, "Acto", "Acto"); // Progreso de historia (Acto completado)
	addObjective(list, seen, "xptitle", "xptitle"); // Titulo de XP
	addObjective(list, seen, "XP", "XP"); // XP del jugador
	addObjective(list, seen, "killtitle", "killtitle"); // Titulo de kills
	addObjective(list, seen, "Se", "Se"); // Segador de kills
	addObjective(list, seen, "muertetitle", "muertetitle"); // Titulo de muertes
	addObjective(list, seen, "almatitle", "almatitle"); // Titulo de almas
	addObjective(list, seen, "So", "So"); // Souls (Almas)
	addObjective(list, seen, "versiontitle", "versiontitle"); // Titulo de version
	addObjective(list, seen, "versiontitlevalor1", "versiontitlevalor1"); // Titulo de version valor 1
	addObjective(list, seen, "versiontitlevalor2", "versiontitlevalor2"); // Titulo de version valor 2
	addObjective(list, seen, "versiontitlevalor3", "versiontitlevalor3"); // Titulo de version valor 3
	addObjective(list, seen, "ID", "ID"); // ID del jugador
	addObjective(list, seen, "IDAsignada", "IDAsignada"); // ID Asignada del jugador
	addObjective(list, seen, "TotalIDs", "TotalIDs"); // Total de IDs asignadas
	addObjective(list, seen, "EntityCramming", "EntityCramming"); // Entity Cramming (para anticheat)
	addObjective(list, seen, "FillBeeHiveNest", "FillBeeHiveNest"); // Fill Bee Hive Nest (para anticheat)
	addObjective(list, seen, "vip", "vip"); // VIP status
	addObjective(list, seen, "spawnpoint", "spawnpoint"); // Spawnpoint status

	// systems/onJoinFirstTime ---
	addObjective(list, seen, "nuevo", "nuevo");

	// --- Archivements (LOGROS) ---
	addObjective(list, seen, "mobs", "mobs");
	addObjective(list, seen, "muertes", "muertes");
	addObjective(list, seen, "Parcela", "Parcela");
	addObjective(list, seen, "Corazones", "Corazones");
	addObjective(list, seen, String(achievementsConfig?.totals?.playerTotalObjective ?? "Logros"), "Logros");
	addObjective(list, seen, String(achievementsConfig?.totals?.totalObjective ?? "LogrosTotal"), "LogrosTotal");

	// --- Achievements (per-logro objectives) ---
	for (const ach of achievementsConfig?.achievements || []) {
		const internal = ach?.internalObjective ? String(ach.internalObjective) : `Logro_${ach?.id}`;
		addObjective(list, seen, internal, internal);
	}

	// --- Regeneration (configurable) ---
	addRegenObjectives(list, seen, skillRegenConfig);

	// --- Mining / levels (configurable) ---
	addSkillProgressionObjectives(list, seen, miningSkillConfig);
	addSkillProgressionObjectives(list, seen, foragingSkillConfig);

	// --- Systems / Titles Priority (configurable) ---
	addTitlesPriorityObjectives(list, seen, titlesPriorityConfig);

	return list;
}
