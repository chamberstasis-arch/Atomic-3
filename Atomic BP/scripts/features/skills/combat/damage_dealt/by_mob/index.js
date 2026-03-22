import { emitDamageTitle } from "../damage_title_hook.js";
import { canApplyDamageFromAttacker } from "../cooldown.js";
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

export function initByMobDamageDealt(world, config = undefined) {
	world.afterEvents.entityHitEntity.subscribe((ev) => {
		try {
			const attacker = ev?.damagingEntity;
			const target = ev?.hitEntity;
			if (!attacker || !target) return;

			// Solo cuando atacante NO es player y objetivo SI es player
			if (isPlayerEntity(attacker)) return;
			if (!isPlayerEntity(target)) return;

			// Gate H==1 en el objetivo (player). El atacante (mob) no necesita H para aplicar dano.
			// Esto evita el caso donde el mob "tarda" en entrar al sistema.
			if (!hasHEnabled(target)) return;

			// Cooldown por mob (atacante): evitar multi-hit por tick y mantener ritmo estable.
			const cdMob = Math.max(0, Math.trunc(Number(config?.mobCooldownTicks ?? 24)));
			if (!canApplyDamageFromAttacker(attacker, cdMob)) return;

			ensureTargetVidaInitializedBestEffort(target, config);

			// DMGH por defecto: si un mob tiene H==1 y no tiene DMGH o es <=0, forzamos minimo 1.
			let dmgMob = getScore(attacker, OBJ_DMGH, undefined);
			if (dmgMob === undefined || !Number.isFinite(dmgMob) || dmgMob <= 0) {
				// Solo forzar si el mob está dentro del sistema (H==1). Si no, no tocamos nada.
				if (hasHEnabled(attacker)) {
					dmgMob = 1;
					setScore(attacker, OBJ_DMGH, 1);
				} else {
					return;
				}
			}

			let defSrc = "DefensaTotalH";
			let defPlayer = getScore(target, OBJ_DEF_TOTAL_TOTAL, undefined);
			if (defPlayer === undefined) {
				defSrc = "DtotalH";
				defPlayer = getScore(target, OBJ_DEF_TOTAL, 0);
			}
			// Mobs no tienen penetración por defecto; extender con score propio si se necesita.
			const danoReal = computeDefenseMitigation(defenseCalcConfig, dmgMob, defPlayer, 0);
			if (danoReal <= 0) return;

			const vidaMax = getScore(target, OBJ_VIDA_MAX, undefined);
			if (vidaMax === 0) return;

			const danoAplicado = removeScoreMin0(target, OBJ_VIDA, danoReal);
			if (danoAplicado <= 0) return;

			emitDamageTitle({ attacker, target, danoReal: danoAplicado, isCrit: false });

			// Para players, la muerte la maneja combat/health, pero si por algun motivo el target es invalido,
			// dejamos un best-effort (sin forzar kill de player).
			try {
				if (!target?.isValid) killEntityBestEffort(target);
			} catch (e) {
				void e;
			}

			if (config?.debug === true) {
				debugTellBestEffort(
					target,
					`[DamageDealtDbg] by_mob dmgMob=${dmgMob} def=${defPlayer}(${defSrc}) danoReal=${danoReal}`
				);
			}
		} catch (e) {
			void e;
		}
	});
}
