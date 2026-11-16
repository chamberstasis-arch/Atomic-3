import { system, world } from "@minecraft/server";
import { isHEnabled, getVidaScoreBestEffort } from "./score.js";

// Feature: skills/combat/damageCancel
//
// Objetivo:
// - Evitar que el jugador muera por daño vanilla si su scoreboard `H` es 1.
// - Permitir que daño NO-LETAL pase para que el knockback vanilla ocurra naturalmente.
// - health/syncPlayers se encarga de restaurar HP vanilla al ratio Vida/VidaMax cada tick de sync.
//
// Restricciones:
// - NO Dynamic Properties
// - NO APIs experimentales
// - NO overrides JSON de `minecraft:player` (player.json), porque rompe el actor y el gameplay.
//
// Implementación:
// - Preferido: cancelar el evento en `world.beforeEvents.entityHurt` SOLO si sería letal.
// - Fallback: restaurar HP en `world.afterEvents.entityHurt` si se escapó un letal.
// - Tag opcional `hp_mode` solo para debug (no cancela nada por sí solo).

const DEFAULT_LOOP_TICKS = 10;
const DEBUG_TAG = "hp_mode";

let didInit = false;

/** @type {Map<string, boolean>} */
const lastEnabledByPlayerKey = new Map();

function getPlayerKey(player) {
	try {
		const sbid = player?.scoreboardIdentity?.id;
		if (sbid != null) return `sb:${String(sbid)}`;
		if (player?.id) return `pl:${String(player.id)}`;
		if (player?.name) return `nm:${String(player.name)}`;
	} catch (e) {
		void e;
	}
	return null;
}

function safeHasTag(player, tag) {
	try {
		return player?.hasTag?.(tag) === true;
	} catch (e) {
		void e;
		return false;
	}
}

function safeAddTag(player, tag) {
	try {
		player?.addTag?.(tag);
	} catch (e) {
		void e;
	}
}

function safeRemoveTag(player, tag) {
	try {
		player?.removeTag?.(tag);
	} catch (e) {
		void e;
	}
}

function tryHealBackDamage(player, damageAmount) {
	// Fallback: si no pudimos cancelar antes del daño, intentamos restaurar HP inmediatamente.
	// Nota: si el daño es letal en el mismo tick, este fallback puede no alcanzar.
	try {
		const hc = player?.getComponent?.("minecraft:health");
		if (!hc) return;
		const dmg = Number(damageAmount);
		if (!Number.isFinite(dmg) || dmg <= 0) return;

		const cur = Number(hc.currentValue);
		const max = Number(hc.effectiveMax);
		if (!Number.isFinite(cur) || !Number.isFinite(max)) return;

		const restored = Math.min(max, cur + dmg);
		if (typeof hc.setCurrentValue === "function") {
			hc.setCurrentValue(restored);
		}
	} catch (e) {
		void e;
	}
}

function syncDebugTag(loopTag, player, enabled) {
	if (!loopTag) return;
	const has = safeHasTag(player, loopTag);
	if (enabled) {
		if (!has) safeAddTag(player, loopTag);
	} else {
		if (has) safeRemoveTag(player, loopTag);
	}
}

export function initVanillaDamageCancel(options = undefined) {
	if (didInit) return;
	didInit = true;

	const loopTicks = Math.max(1, Math.trunc(options?.loopTicks ?? DEFAULT_LOOP_TICKS));
	const tag = String(options?.tag ?? DEBUG_TAG);

	// Loop liviano para:
	// - actualizar tag debug (opcional)
	// - mantener cache de enabled por jugador
	system.runInterval(() => {
		try {
			/** @type {Set<string>} */
			const alive = new Set();

			for (const player of world.getPlayers()) {
				const key = getPlayerKey(player);
				if (key) alive.add(key);

				const enabled = isHEnabled(player);
				if (key) lastEnabledByPlayerKey.set(key, enabled);

				// debug tag: útil para confirmar que el gating está activo
				syncDebugTag(tag, player, enabled);
			}

			// Cleanup de jugadores que ya no están
			for (const key of lastEnabledByPlayerKey.keys()) {
				if (!alive.has(key)) lastEnabledByPlayerKey.delete(key);
			}
		} catch (e) {
			void e;
		}
	}, loopTicks);

	// Preferido: cancelar el daño antes de aplicarse SOLO si sería letal.
	// Daño no-letal pasa → el motor aplica knockback vanilla naturalmente.
	// health/syncPlayers restaurará HP vanilla al ratio Vida/VidaMax en el siguiente tick de sync.
	try {
		const be = world.beforeEvents;
		if (be?.entityHurt && typeof be.entityHurt.subscribe === "function") {
			be.entityHurt.subscribe((ev) => {
				try {
					const ent = ev?.hurtEntity;
					if (!ent || ent.typeId !== "minecraft:player") return;
					const player = ent;
					const key = getPlayerKey(player);
					const enabled = key ? (lastEnabledByPlayerKey.get(key) ?? isHEnabled(player)) : isHEnabled(player);
					if (!enabled) return;

					// Leer HP vanilla actual y daño entrante.
					const hc = player.getComponent?.("minecraft:health");
					if (!hc) { ev.cancel = true; return; }
					const curHp = Number(hc.currentValue);
					const dmg = Number(ev.damage);
					if (!Number.isFinite(curHp) || !Number.isFinite(dmg)) { ev.cancel = true; return; }

					// Consultar Vida del sistema custom para decisión informada.
					const vida = getVidaScoreBestEffort(player);

					// Si el sistema custom dice que Vida <= 0, el jugador debe morir.
					// No cancelar para que la muerte vanilla proceda normalmente.
					if (vida !== undefined && vida <= 0) return;

					// Solo cancelar si el daño mataría al jugador vanilla (letal).
					// Si es no-letal, dejar pasar para preservar knockback.
					if (dmg >= curHp) {
						ev.cancel = true;
					}
					// else: no cancelar → knockback ocurre, HP vanilla baja temporalmente,
					// health/syncPlayers lo corrige en ~200ms.
				} catch (e) {
					// En caso de error, cancelar por seguridad para no matar al jugador.
					try { ev.cancel = true; } catch (_) { void _; }
				}
			});
		}
	} catch (e) {
		void e;
	}

	// Fallback: restaurar HP tras daño aplicado SOLO si fue letal (el cancel no alcanzó).
	// Para daño no-letal que pasó intencionalmente, NO restaurar (health/ lo hará en el sync).
	try {
		const ae = world.afterEvents;
		if (ae?.entityHurt && typeof ae.entityHurt.subscribe === "function") {
			ae.entityHurt.subscribe((ev) => {
				try {
					const ent = ev?.hurtEntity;
					if (!ent || ent.typeId !== "minecraft:player") return;
					const player = ent;
					const key = getPlayerKey(player);
					const enabled = key ? (lastEnabledByPlayerKey.get(key) ?? isHEnabled(player)) : isHEnabled(player);
					if (!enabled) return;

					// Solo heal-back si el HP actual llegó a 0 o menos (muerte inminente).
					const hc = player.getComponent?.("minecraft:health");
					if (!hc) return;
					const cur = Number(hc.currentValue);
					if (!Number.isFinite(cur) || cur > 0) return;
					// HP vanilla llegó a 0 — restaurar para evitar muerte vanilla.
					tryHealBackDamage(player, ev.damage);
				} catch (e) {
					void e;
				}
			});
		}
	} catch (e) {
		void e;
	}
}
