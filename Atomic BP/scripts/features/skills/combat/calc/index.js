import { system, world } from "@minecraft/server";
import { damageCalcConfig } from "./config.js";
import { clampMin0Int, floorFinite, toNumberOr } from "./utilMath.js";
import {
	debugLog,
	ensureObjectiveBestEffort,
	getScoreIdentityOrNameBestEffort,
	setScoreIdentityBestEffort,
} from "./scoreboard.js";

/** @typedef {{
 *  enabled: boolean,
 *  dmgTotal: number,
 *  powerTotal: number,
 *  critDmgTotal: number,
 *  probCritTotal: number,
 *  rawMATotal: number,
 *  rawMMTotal: number,
 *  defTotal: number,
 *  manaTotal: number,
 *  outSC: number,
 *  outCC: number,
 *  outProbCritLegacy: number,
 *  outDefLegacy: number,
 *  outManaLegacy: number,
 * }} PlayerCalcCache */

/** @type {Map<string, PlayerCalcCache>} */
const cacheByPlayerKey = new Map();

/** @type {Map<string, number>} */
const lastDebugMsByPlayerKey = new Map();

let didInit = false;
let didStartLoop = false;

function getPlayerKey(player, identity) {
	try {
		if (identity && identity.id != null) return `sb:${String(identity.id)}`;
		if (player && player.id) return `pl:${String(player.id)}`;
		if (player && player.name) return `nm:${String(player.name)}`;
	} catch (e) {
		void e;
	}
	return null;
}

function safeMultiplierOr1(value) {
	const n = toNumberOr(value, 1);
	if (!Number.isFinite(n) || n === 0) return 1;
	return n;
}

function scoreX10ToMultiplierOr1(rawScoreX10, defaultScoreX10 = 10) {
	const raw = Math.trunc(toNumberOr(rawScoreX10, 0));
	const effective = raw > 0 ? raw : Math.trunc(defaultScoreX10);
	const mult = effective / 10;
	return safeMultiplierOr1(mult);
}

function computeFinalDamageTotals(cfg, dmgTotalInt, powerTotalInt, critDmgPct, multAddOverride, multMultOverride) {
	const f = cfg && cfg.formula ? cfg.formula : {};

	const dmgTotal = toNumberOr(dmgTotalInt, 0);
	const powerTotal = toNumberOr(powerTotalInt, 0) + toNumberOr(f.powerOffset, 0);
	const critPct = toNumberOr(critDmgPct, 0);

	const multAdd = safeMultiplierOr1(multAddOverride != null ? multAddOverride : f.multiplierAdd);
	const multMult = safeMultiplierOr1(multMultOverride != null ? multMultOverride : f.multiplierMult);
	const bonus = toNumberOr(f.bonus, 0);

	// Fórmula documentada:
	// DañoBaseFinal = (1 + DañoTotal) * (1 + Poder/10) * MA * MM + Bonus
	const baseFinal = (1 + dmgTotal) * (1 + powerTotal / 10) * multAdd * multMult + bonus;

	const sc = clampMin0Int(floorFinite(baseFinal));
	const cc = clampMin0Int(floorFinite(baseFinal * (1 + critPct / 100)));
	return { sc, cc };
}

function updateOutputs(cfg, dimension, player, outSC, outCC, outProbCritLegacy, outDefLegacy, outManaLegacy) {
	const o = cfg.objectives;
	const identity = player.scoreboardIdentity;
	setScoreIdentityBestEffort(dimension, o.outFinalNoCrit, identity, player.name, outSC);
	setScoreIdentityBestEffort(dimension, o.outFinalCrit, identity, player.name, outCC);
	setScoreIdentityBestEffort(dimension, o.outCritChanceTotal, identity, player.name, outProbCritLegacy);
	setScoreIdentityBestEffort(dimension, o.outDefenseTotal, identity, player.name, outDefLegacy);
	setScoreIdentityBestEffort(dimension, o.outManaTotal, identity, player.name, outManaLegacy);
}

function shouldDebugEmit(cfg, playerKey, outSC, outCC) {
	const dbg = cfg && cfg.debug ? cfg.debug : null;
	if (!dbg || !dbg.enabled) return false;
	if (dbg.onlyWhenZero && !(outSC === 0 && outCC === 0)) return false;
	const throttleMs = Math.max(0, Math.trunc(dbg.throttleMs != null ? dbg.throttleMs : 0));
	if (!playerKey || throttleMs <= 0) return true;
	const now = Date.now();
	const last = lastDebugMsByPlayerKey.get(playerKey) || 0;
	if (now - last < throttleMs) return false;
	lastDebugMsByPlayerKey.set(playerKey, now);
	return true;
}

function debugTellPlayerBestEffort(cfg, player, message) {
	try {
		const dbg = cfg && cfg.debug ? cfg.debug : null;
		if (!dbg || !dbg.enabled || !dbg.tellPlayer) return;
		if (player && typeof player.sendMessage === "function") player.sendMessage(String(message));
	} catch (e) {
		void e;
	}
}

function zeroPlayerOutputsIfNeeded(cfg, dimension, player, prev) {
	if (prev && prev.outSC === 0 && prev.outCC === 0 && prev.outProbCritLegacy === 0 && prev.outDefLegacy === 0 && prev.outManaLegacy === 0) return;
	updateOutputs(cfg, dimension, player, 0, 0, 0, 0, 0);
}

function tickCalc(cfg) {
	const dim = world.getDimension("minecraft:overworld");
	const o = cfg.objectives;

	/** @type {Set<string>} */
	const active = new Set();

	for (const player of world.getPlayers()) {
		const identity = player.scoreboardIdentity;
		const playerKey = getPlayerKey(player, identity);
		if (playerKey) active.add(playerKey);

		const enabledScore = getScoreIdentityOrNameBestEffort(o.enabled, identity, player.name, 0);
		const enabled = Number(enabledScore) === 1;
		const prev = playerKey ? cacheByPlayerKey.get(playerKey) || null : null;

		if (!enabled) {
			if (cfg.disabledBehavior?.zeroOutputs !== false) zeroPlayerOutputsIfNeeded(cfg, dim, player, prev);
			if (shouldDebugEmit(cfg, playerKey, 0, 0)) {
				const msg = `§8[calc] disabled: H=${Math.trunc(enabledScore)} outputs=0`;
				debugLog(cfg, msg);
				debugTellPlayerBestEffort(cfg, player, msg);
			}
			if (playerKey) {
				cacheByPlayerKey.set(playerKey, {
					enabled: false,
					dmgTotal: 0,
					powerTotal: 0,
					critDmgTotal: 0,
					probCritTotal: 0,
					rawMATotal: 0,
					rawMMTotal: 0,
					defTotal: 0,
					manaTotal: 0,
					outSC: 0,
					outCC: 0,
					outProbCritLegacy: 0,
					outDefLegacy: 0,
					outManaLegacy: 0,
				});
			}
			continue;
		}

		// Inputs producidos por lecture/
		const dmgTotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inDamageTotal, identity, player.name, 0));
		const powerTotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inPowerTotal, identity, player.name, 0));
		const critDmgTotal = toNumberOr(getScoreIdentityOrNameBestEffort(o.inCritDamageTotal, identity, player.name, 0), 0);
		const probCritTotal = toNumberOr(getScoreIdentityOrNameBestEffort(o.inCritChanceTotal, identity, player.name, 0), 0);
		const defTotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inDefenseTotal, identity, player.name, 0));
		const manaTotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inManaTotal, identity, player.name, 0));

		const rawMATotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inMultAddTotal, identity, player.name, 0));
		const rawMMTotal = Math.trunc(getScoreIdentityOrNameBestEffort(o.inMultMultTotal, identity, player.name, 0));
		const multAdd = scoreX10ToMultiplierOr1(rawMATotal, 10);
		const multMult = scoreX10ToMultiplierOr1(rawMMTotal, 10);

		const { sc, cc } = computeFinalDamageTotals(cfg, dmgTotal, powerTotal, critDmgTotal, multAdd, multMult);

		// Outputs legacy: ProbabilidadCriticaTotal es int en scoreboard
		const outProbCritLegacy = clampMin0Int(floorFinite(probCritTotal));
		const outDefLegacy = Math.trunc(defTotal);
		const outManaLegacy = Math.trunc(manaTotal);

		if (
			prev &&
			prev.enabled === true &&
			prev.dmgTotal === dmgTotal &&
			prev.powerTotal === powerTotal &&
			prev.critDmgTotal === critDmgTotal &&
			prev.probCritTotal === probCritTotal &&
			prev.rawMATotal === rawMATotal &&
			prev.rawMMTotal === rawMMTotal &&
			prev.defTotal === defTotal &&
			prev.manaTotal === manaTotal &&
			prev.outSC === sc &&
			prev.outCC === cc &&
			prev.outProbCritLegacy === outProbCritLegacy &&
			prev.outDefLegacy === outDefLegacy &&
			prev.outManaLegacy === outManaLegacy
		) {
			continue;
		}

		if (shouldDebugEmit(cfg, playerKey, sc, cc)) {
			const msg =
				`§8[calc] H=1 DanoTotalH=${dmgTotal} PoderTotalH=${powerTotal} ` +
				`MATotalH=${rawMATotal}(${multAdd}) MMTotalH=${rawMMTotal}(${multMult}) ` +
				`CritPct=${Math.trunc(critDmgTotal)} ProbCrit=${Math.trunc(outProbCritLegacy)} => SC=${sc} CC=${cc}`;
			debugLog(cfg, msg);
			debugTellPlayerBestEffort(cfg, player, msg);
		}

		updateOutputs(cfg, dim, player, sc, cc, outProbCritLegacy, outDefLegacy, outManaLegacy);

		if (playerKey) {
			cacheByPlayerKey.set(playerKey, {
				enabled: true,
				dmgTotal,
				powerTotal,
				critDmgTotal,
				probCritTotal,
				rawMATotal,
				rawMMTotal,
				defTotal,
				manaTotal,
				outSC: sc,
				outCC: cc,
				outProbCritLegacy,
				outDefLegacy,
				outManaLegacy,
			});
		}
	}

	for (const key of cacheByPlayerKey.keys()) {
		if (!active.has(key)) {
			cacheByPlayerKey.delete(key);
			lastDebugMsByPlayerKey.delete(key);
		}
	}
}

export function initDamageCalc(userConfig = damageCalcConfig) {
	if (didInit) return;
	didInit = true;

	const cfg = userConfig || damageCalcConfig;
	const loopTicks = Math.max(1, Math.trunc(cfg.loopTicks || 10));

	function startLoopBestEffort(reason) {
		if (didStartLoop) return;
		didStartLoop = true;

		debugLog(cfg, `init(${String(reason)}) loopTicks=${loopTicks}`);

		// Migrado a initAllScoreboards (catálogo central)
		try {
			const dim = world.getDimension("minecraft:overworld");
			ensureObjectiveBestEffort(dim, cfg.objectives?.enabled, "dummy", cfg.displayNames?.enabled);
		} catch (e) {
			void e;
		}

		system.runInterval(() => {
			try {
				tickCalc(cfg);
			} catch (e) {
				void e;
				debugLog(cfg, `tick exception: ${String(e)}`);
			}
		}, loopTicks);
	}

	try {
		world.afterEvents.worldLoad.subscribe(() => startLoopBestEffort("worldLoad"));
	} catch (e) {
		void e;
	}

	system.run(() => startLoopBestEffort("system.run"));
}
