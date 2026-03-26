import { emitDamageTitle } from "../damage_title_hook.js";
import { canApplyDamageToTarget, getDamageDealtTick } from "../cooldown.js";
import {
	OBJ_DANO_CC,
	OBJ_DANO_SC,
	OBJ_DEF_TOTAL,
	OBJ_DEF_TOTAL_TOTAL,
	OBJ_LAST_KILLER_ID,
	OBJ_LAST_KILL_TICK,
	OBJ_PEN_ARMOR_TOTAL,
	OBJ_PROB_CRIT,
	OBJ_PROB_CRIT_TOTAL,
	OBJ_VIDA,
	OBJ_VIDA_MAX,
	debugTellBestEffort,
	ensureTargetVidaInitializedBestEffort,
	getScore,
	hasHEnabled,
	isPlayerEntity,
	killEntityBestEffort,
	removeScoreMin0,
	setScore,
} from "../scoreboard.js";
import { clampMin0, floorInt, rollCrit } from "../math.js";
import { computeDefenseMitigation } from "../../calc/defense/index.js";
import { defenseCalcConfig } from "../../calc/defense/config.js";

/** @type {Set<(attacker:any, target:any)=>void>} */
const mobKilledByPlayerListeners = new Set();

export function subscribeOnMobKilledByPlayer(listener) {
	if (typeof listener !== "function") return () => {};
	mobKilledByPlayerListeners.add(listener);
	return () => {
		mobKilledByPlayerListeners.delete(listener);
	};
}

function emitMobKilledByPlayer(attacker, target) {
	for (const listener of mobKilledByPlayerListeners) {
		try {
			listener(attacker, target);
		} catch (e) {
			void e;
		}
	}
}

function setKilledByTagBestEffort(target, attacker) {
	try {
		const raw = String(attacker?.name ?? "");
		if (!raw) return;
		const safe = raw.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24);
		if (!safe) return;
		// Remover tags previos de killed_by para no acumular.
		try {
			for (const t of target.getTags?.() ?? []) {
				if (typeof t === "string" && t.startsWith("atomic_killed_by_")) target.removeTag(t);
			}
		} catch (e) {
			void e;
		}
		target.addTag?.(`atomic_killed_by_${safe}`);
	} catch (e) {
		void e;
	}
}

export function initByPlayerDamageDealt(world, config = undefined) {
	function applyPlayerHitBestEffort(attacker, target, source = "hit") {
		try {
			if (!attacker || !target) return;

			// Solo cuando atacante es player
			if (!isPlayerEntity(attacker)) return;

			// Gate H==1 en ambos
			if (!hasHEnabled(attacker) || !hasHEnabled(target)) {
				if (config?.debug === true && isPlayerEntity(target)) {
					debugTellBestEffort(attacker, `[DamageDealtDbg] ${source} blocked: H gate (attH=${getScore(attacker, "H", 0)} tgtH=${getScore(target, "H", 0)})`);
				}
				return;
			}

			// Cooldown (immunity frames): evitar spam/autoclick
			const cd = Math.max(0, Math.trunc(Number(config?.cooldownTicks ?? 10)));
			if (!canApplyDamageToTarget(target, cd)) return;

			// Asegurar Vida/VidaMax para que el hit sea inmediato
			ensureTargetVidaInitializedBestEffort(target, config);

			let probCritSrc = "ProbCritTotalH";
			let probCrit = getScore(attacker, OBJ_PROB_CRIT_TOTAL, undefined);
			if (probCrit === undefined) {
				probCritSrc = "ProbabilidadCriticaTotal";
				probCrit = getScore(attacker, OBJ_PROB_CRIT, 0);
			}
			const isCrit = rollCrit(probCrit);

			const danoSC = getScore(attacker, OBJ_DANO_SC, 0);
			const danoCC = getScore(attacker, OBJ_DANO_CC, 0);
			const danoBase = isCrit ? danoCC : danoSC;
			if (danoBase <= 0) return;

			let defensaSrc = "DefensaTotalH";
			let defensa = getScore(target, OBJ_DEF_TOTAL_TOTAL, undefined);
			if (defensa === undefined) {
				defensaSrc = "DtotalH";
				defensa = getScore(target, OBJ_DEF_TOTAL, 0);
			}
			const penArmor = getScore(attacker, OBJ_PEN_ARMOR_TOTAL, 0);
			const danoReal = computeDefenseMitigation(defenseCalcConfig, danoBase, defensa, penArmor);
			if (!Number.isFinite(danoReal) || danoReal <= 0) return;

			// Si VidaMax==0 => inmortal logica (compat con combat/health)
			const vidaMax = getScore(target, OBJ_VIDA_MAX, undefined);
			if (vidaMax === 0) {
				if (config?.debug === true && isPlayerEntity(target)) {
					debugTellBestEffort(attacker, `[DamageDealtDbg] ${source} blocked: VidaMaxTotalH==0`);
				}
				return;
			}

			// Aplicar dano a Vida
			let danoAplicado = 0;
			if (isPlayerEntity(target)) {
				// Para players mantenemos clamp a 0.
				danoAplicado = removeScoreMin0(target, OBJ_VIDA, danoReal);
				if (danoAplicado <= 0) return;
				// Title: mostrar el dano realmente aplicado.
				emitDamageTitle({ attacker, target, danoReal: danoAplicado, isCrit });
			} else {
				// Para mobs: permitir Vida negativa y mostrar el dano real completo (sin cap por vida restante).
				const curVida = getScore(target, OBJ_VIDA, 0);
				const nextVida = curVida - danoReal;
				setScore(target, OBJ_VIDA, nextVida);
				danoAplicado = danoReal;
				emitDamageTitle({ attacker, target, danoReal: danoAplicado, isCrit });
			}

			// Muerte inmediata para mobs cuando Vida llega a 0
			if (!isPlayerEntity(target)) {
				const vidaAfter = getScore(target, OBJ_VIDA, 0);
				if (vidaAfter <= 0 && vidaMax !== 0) {
					// Guardar killer para usos futuros
					try {
						const killerId = Math.trunc(Number(attacker?.scoreboardIdentity?.id ?? 0));
						setScore(target, OBJ_LAST_KILLER_ID, killerId);
						setScore(target, OBJ_LAST_KILL_TICK, getDamageDealtTick());
						setKilledByTagBestEffort(target, attacker);
					} catch (e) {
						void e;
					}
					emitMobKilledByPlayer(attacker, target);
					killEntityBestEffort(target);
				}
			}

			if (config?.debug === true) {
				debugTellBestEffort(
					attacker,
					`[DamageDealtDbg] ${source} crit=${isCrit} probCrit=${probCrit}(${probCritSrc}) ` +
						`danoSC=${danoSC} danoCC=${danoCC} danoBase=${danoBase} def=${defensa}(${defensaSrc}) pen=${penArmor} danoReal=${danoReal}`
				);
			}
		} catch (e) {
			void e;
		}
	}

	// MVP: melee hit (player -> entity). En algunos runtimes PvP no dispara este evento.
	world.afterEvents.entityHitEntity.subscribe((ev) => {
		applyPlayerHitBestEffort(ev?.damagingEntity, ev?.hitEntity, "hitEntity");
	});

	// Fallback PvP: player -> player via entityHurt (evita el caso "PvP no baja Vida ni titles").
	// Protegido por el mismo cooldown por TARGET, así que si ambos eventos disparan no se duplica.
	try {
		world.afterEvents.entityHurt.subscribe((ev) => {
			try {
				const target = ev?.hurtEntity;
				const attacker = ev?.damageSource?.damagingEntity;
				if (!target || !attacker) return;
				if (!isPlayerEntity(attacker) || !isPlayerEntity(target)) return;
				// Evitar proyectiles (MVP melee). Si el runtime no expone esto, queda undefined y no filtra.
				if (ev?.damageSource?.damagingProjectile) return;
				applyPlayerHitBestEffort(attacker, target, "pvpHurt");
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}
}
