import { emitDamageTitle } from "../damage_title_hook.js";
import { canApplyDamageFromAttacker, canApplyDamageToTarget } from "../cooldown.js";
import {
	OBJ_DEF_TOTAL,
	OBJ_DEF_TOTAL_TOTAL,
	OBJ_DMGH,
	OBJ_VIDA,
	OBJ_VIDA_MAX,
	debugTellBestEffort,
	ensureTargetVidaInitializedBestEffort,
	getScore,
	isPlayerEntity,
	killEntityBestEffort,
	removeScoreMin0,
	setScore,
	hasHEnabled,
} from "../scoreboard.js";
import { clampMin0, floorInt } from "../math.js";
import { computeDefenseMitigation } from "../../calc/defense/index.js";
import { defenseCalcConfig } from "../../calc/defense/config.js";

/**
 * Lógica compartida de daño mob→player. Usada por melee (entityHitEntity) y ranged (entityHurt).
 * @returns {boolean} true si se aplicó daño.
 */
function applyMobHitToPlayer(attacker, target, config, source) {
	try {
		if (!attacker || !target) return false;
		if (isPlayerEntity(attacker)) return false;
		if (!isPlayerEntity(target)) return false;
		if (!hasHEnabled(target)) return false;

		// Cooldown por mob (atacante): evitar multi-hit por tick y mantener ritmo estable.
		const cdMob = Math.max(0, Math.trunc(Number(config?.mobCooldownTicks ?? 24)));
		if (!canApplyDamageFromAttacker(attacker, cdMob)) return false;

		// Cooldown por TARGET para deduplicar melee + ranged events en el mismo hit.
		const cdTarget = Math.max(0, Math.trunc(Number(config?.mobTargetCooldownTicks ?? 4)));
		if (cdTarget > 0 && !canApplyDamageToTarget(target, cdTarget)) return false;

		ensureTargetVidaInitializedBestEffort(target, config);

		// DMGH por defecto: si un mob tiene H==1 y no tiene DMGH o es <=0, forzamos minimo 1.
		let dmgMob = getScore(attacker, OBJ_DMGH, undefined);
		if (dmgMob === undefined || !Number.isFinite(dmgMob) || dmgMob <= 0) {
			if (hasHEnabled(attacker)) {
				dmgMob = 1;
				setScore(attacker, OBJ_DMGH, 1);
			} else {
				return false;
			}
		}

		let defSrc = "DefensaTotalH";
		let defPlayer = getScore(target, OBJ_DEF_TOTAL_TOTAL, undefined);
		if (defPlayer === undefined) {
			defSrc = "DtotalH";
			defPlayer = getScore(target, OBJ_DEF_TOTAL, 0);
		}
		const danoReal = computeDefenseMitigation(defenseCalcConfig, dmgMob, defPlayer, 0);
		if (!Number.isFinite(danoReal) || danoReal <= 0) return false;

		const vidaMax = getScore(target, OBJ_VIDA_MAX, undefined);
		if (vidaMax === 0) return false;

		const danoAplicado = removeScoreMin0(target, OBJ_VIDA, danoReal);
		if (danoAplicado <= 0) return false;

		emitDamageTitle({ attacker, target, danoReal: danoAplicado, isCrit: false });

		try {
			if (!target?.isValid) killEntityBestEffort(target);
		} catch (e) {
			void e;
		}

		if (config?.debug === true) {
			debugTellBestEffort(
				target,
				`[DamageDealtDbg] ${source} dmgMob=${dmgMob} def=${defPlayer}(${defSrc}) danoReal=${danoReal}`
			);
		}
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function initByMobDamageDealt(world, config = undefined) {
	// Melee: mob golpea player directamente.
	world.afterEvents.entityHitEntity.subscribe((ev) => {
		applyMobHitToPlayer(ev?.damagingEntity, ev?.hitEntity, config, "by_mob_melee");
	});

	// Ranged: flechas, bolas de fuego, etc. Usa projectileHitEntity (superficie estable y precisa).
	// El cooldown por TARGET deduplica si ambos eventos disparan para el mismo hit.
	try {
		world.afterEvents.projectileHitEntity.subscribe((ev) => {
			try {
				const attacker = ev?.source;
				const hitInfo = ev.getEntityHit();
				const target = hitInfo?.entity;
				if (!target || !attacker) return;
				applyMobHitToPlayer(attacker, target, config, "by_mob_ranged");
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}
}
