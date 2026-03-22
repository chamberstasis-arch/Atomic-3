import {
	OBJ_H_DEAD,
	OBJ_VIDA,
	OBJ_VIDA_ABSORCION,
	OBJ_VIDA_MAX,
	OBJ_VIDA_MAX_BASE,
	getScoreBestEffort,
	isHEnabled,
	setScoreBestEffort,
} from "./scoreboards.js";
import { defaultVidaMaxForPlayer } from "./defaults.js";

/** @type {Map<string, number>} */
const lastVanillaHealthByPlayerKey = new Map();

/** @type {Map<string, number>} */
const lastVidaByPlayerKey = new Map();

/** @type {Map<string, number>} */
const lastAbsHpByPlayerKey = new Map();

let debugTickCounter = 0;

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

function clampVida(vida, vidaMax) {
	const v = Math.trunc(Number(vida));
	if (!Number.isFinite(v)) return 0;
	const vm = Number(vidaMax);
	if (!Number.isFinite(vm) || vm <= 0) return v;
	return Math.max(0, Math.min(vm, v));
}

function ensurePlayerVidaInitialized(player, config) {
	if (!isHEnabled(player)) return { enabled: false };

	// Primera vez que el jugador entra al sistema (H==1):
	// inicializar VidaMaxH (base) SOLO si no existe aún.
	let vidaMaxBase = getScoreBestEffort(OBJ_VIDA_MAX_BASE, player);
	if (vidaMaxBase === undefined) {
		vidaMaxBase = defaultVidaMaxForPlayer(player, config);
		setScoreBestEffort(OBJ_VIDA_MAX_BASE, player, vidaMaxBase);
	}

	let vidaMax = getScoreBestEffort(OBJ_VIDA_MAX, player);
	// Regla: si VidaMax no existe, asignar default.
	if (vidaMax === undefined) {
		vidaMax = defaultVidaMaxForPlayer(player, config);
		setScoreBestEffort(OBJ_VIDA_MAX, player, vidaMax);
	}

	// Caso especial: VidaMax==0 => inmortal lógica (no forzar default)
	if (vidaMax === 0) {
		const vida = getScoreBestEffort(OBJ_VIDA, player);
		if (vida === undefined) setScoreBestEffort(OBJ_VIDA, player, 0);
		return { enabled: true, vida: vida ?? 0, vidaMax: 0, immortal: true };
	}

	// Si VidaMax < 0, normalizar a 0.
	if (Number.isFinite(vidaMax) && vidaMax < 0) {
		vidaMax = 0;
		setScoreBestEffort(OBJ_VIDA_MAX, player, 0);
		const vida = getScoreBestEffort(OBJ_VIDA, player);
		if (vida === undefined) setScoreBestEffort(OBJ_VIDA, player, 0);
		return { enabled: true, vida: vida ?? 0, vidaMax: 0, immortal: true };
	}

	let vida = getScoreBestEffort(OBJ_VIDA, player);
	if (vida === undefined) {
		vida = vidaMax;
		setScoreBestEffort(OBJ_VIDA, player, vida);
	}

	// Clamp Vida <= VidaMax
	const clamped = clampVida(vida, vidaMax);
	if (clamped !== vida) {
		vida = clamped;
		setScoreBestEffort(OBJ_VIDA, player, vida);
	}

	return { enabled: true, vida, vidaMax, immortal: false };
}

function readHealthComponent(player) {
	try {
		const hc = player?.getComponent?.("minecraft:health");
		if (!hc) return null;
		const cur = Number(hc.currentValue);
		const max = Number(hc.effectiveMax);
		if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return null;
		return { hc, cur, max };
	} catch (e) {
		void e;
		return null;
	}
}

function isDebugEnabled(config) {
	// Debug global: true/false (sin scoreboard)
	return config?.debug === true;
}

function debugTellBestEffort(player, message, world = undefined) {
	try {
		if (typeof player?.sendMessage === "function") {
			player.sendMessage(String(message));
			return;
		}
	} catch (e) {
		void e;
	}
	try {
		if (typeof world?.sendMessage === "function") {
			world.sendMessage(String(message));
			return;
		}
	} catch (e) {
		void e;
	}
	try {
		player?.runCommandAsync?.(`tellraw @s {"rawtext":[{"text":${JSON.stringify(String(message))}}]}`);
	} catch (e) {
		void e;
	}
}

function clearAbsorptionEffectBestEffort(player) {
	try {
		if (typeof player?.removeEffect === "function") {
			player.removeEffect("absorption");
			player.removeEffect("minecraft:absorption");
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		player?.runCommandAsync?.("effect @s clear absorption");
		return true;
	} catch (e) {
		void e;
	}
	return false;
}

function readAbsorptionFromEffectBestEffort(player) {
	// Devuelve AbsHP derivado del efecto (si existe). Útil cuando no hay componente.
	try {
		const eff = player?.getEffect?.("absorption") ?? player?.getEffect?.("minecraft:absorption") ?? null;
		if (!eff) return null;
		const amp = Math.trunc(Number(eff.amplifier ?? eff.amplification ?? 0));
		const duration = Math.trunc(Number(eff.duration ?? 0));
		const level = Math.max(0, amp + 1);
		// Vanilla: Absorption I => 2 corazones = 4 HP. General: 4 HP por nivel.
		const hp = Math.max(0, Math.trunc(4 * level));
		return { hp, amplifier: amp, duration };
	} catch (e) {
		void e;
		return null;
	}
}

function readAbsorptionStateBestEffort(player) {
	// Importante: si no podemos leer la absorción, devolvemos readable=false para no
	// inferir expiraciones por tiempo incorrectamente.
	const fromEffect = readAbsorptionFromEffectBestEffort(player);
	try {
		const ac = player?.getComponent?.("minecraft:absorption");
		if (ac) {
			// Intentar nombres comunes de property en diferentes builds
			const candidates = [ac.currentValue, ac.value, ac.amount];
			for (const v of candidates) {
				const n = Number(v);
				if (Number.isFinite(n)) {
					return {
						hp: Math.max(0, Math.trunc(n)),
						source: "component",
						readable: true,
						writeable: true,
						effectDuration: fromEffect?.duration,
						effectAmplifier: fromEffect?.amplifier,
					};
				}
			}
			// Existe el componente pero no se pudo leer; aún así es probable que sea writeable.
			return {
				hp: 0,
				source: "component",
				readable: false,
				writeable: true,
				effectDuration: fromEffect?.duration,
				effectAmplifier: fromEffect?.amplifier,
			};
		}
	} catch (e) {
		void e;
	}

	// Si podemos leer el efecto, úsalo como fuente de verdad (la manzana siempre aplica efecto).
	if (fromEffect) {
		return {
			hp: fromEffect.hp,
			source: "effect",
			readable: true,
			writeable: false,
			effectDuration: fromEffect.duration,
			effectAmplifier: fromEffect.amplifier,
		};
	}
	// Fallback: si algún runtime incluye absorción dentro de currentValue (por encima de max)
	try {
		const hc = player?.getComponent?.("minecraft:health");
		const cur = Number(hc?.currentValue);
		const max = Number(hc?.effectiveMax);
		if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) {
			return {
				hp: Math.max(0, Math.trunc(cur - max)),
				source: "health",
				readable: true,
				writeable: false,
				effectDuration: undefined,
				effectAmplifier: undefined,
			};
		}
	} catch (e) {
		void e;
	}
	return {
		hp: 0,
		source: "none",
		readable: false,
		writeable: false,
		effectDuration: undefined,
		effectAmplifier: undefined,
	};
}

function setAbsorptionHpBestEffort(player, absorptionHp) {
	const hp = Math.max(0, Math.trunc(Number(absorptionHp)));
	try {
		const ac = player?.getComponent?.("minecraft:absorption");
		if (ac) {
			if (typeof ac.setCurrentValue === "function") {
				ac.setCurrentValue(hp);
				return true;
			}
			// Intentar asignación directa (si fuese writable en algún runtime)
			if ("currentValue" in ac) {
				ac.currentValue = hp;
				return true;
			}
			if ("value" in ac) {
				ac.value = hp;
				return true;
			}
			if ("amount" in ac) {
				ac.amount = hp;
				return true;
			}
		}
	} catch (e) {
		void e;
	}
	// Sin componente no podemos garantizar sincronización del display amarillo.
	return false;
}

function computeVidaAbsFromAbsHp(absHp, vidaMaxTotal) {
	const hp = Math.max(0, Math.trunc(Number(absHp)));
	const vm = Math.max(0, Math.trunc(Number(vidaMaxTotal)));
	if (hp <= 0 || vm <= 0) return 0;
	// Regla: 1 absorption HP = 5% de VidaMaxTotalH => VidaAbs = absHp * VidaMaxTotalH / 20
	return Math.trunc((hp * vm) / 20);
}

function computeAbsHpFromVidaAbs(vidaAbs, vidaMaxTotal) {
	const va = Math.max(0, Math.trunc(Number(vidaAbs)));
	const vm = Math.max(0, Math.trunc(Number(vidaMaxTotal)));
	if (va <= 0 || vm <= 0) return 0;
	// Inversa (ceil): absHp = ceil(vidaAbs * 20 / vidaMaxTotal)
	return Math.max(0, Math.trunc(Math.ceil((va * 20) / vm)));
}

function computeTargetVanillaHealth(vida, vidaMax, vanillaMax) {
	if (vidaMax <= 0) return vanillaMax; // inmortal lógica => full hearts
	const v = Number(vida);
	const vm = Number(vidaMax);
	const mx = Number(vanillaMax);
	if (!Number.isFinite(v) || !Number.isFinite(vm) || !Number.isFinite(mx) || vm <= 0 || mx <= 0) return 0;

	// Ratio 0..1
	const ratio = Math.max(0, Math.min(1, v / vm));

	// Bedrock health se expresa en "HP" donde 1 HP = 1/2 corazón.
	// Usamos redondeo al entero más cercano para permitir medios corazones (valores impares).
	let target = Math.round(ratio * mx);
	if (!Number.isFinite(target)) target = 0;
	target = Math.max(0, Math.min(mx, target));

	// Fix: si Vida>0 pero el redondeo da 0, el motor puede matar al jugador instantáneamente.
	// Cap mínimo a 1 corazón (2 HP) para cambios bruscos de VidaMaxTotalH/equipo.
	if (v > 0 && target <= 0) {
		const minHp = Math.min(2, Math.trunc(mx));
		target = Math.max(1, minHp);
	}

	return target;
}

function applyVanillaHealthBestEffort(hc, target) {
	try {
		if (typeof hc.setCurrentValue === "function") {
			hc.setCurrentValue(target);
			return true;
		}
		// Fallback (si en alguna versión fuese writable)
		hc.currentValue = target;
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function convertVanillaHealToScoreDelta(deltaVanilla, vanillaMax, vidaMax) {
	if (deltaVanilla <= 0) return 0;
	if (vidaMax <= 0) return 0;
	const dv = Number(deltaVanilla);
	if (!Number.isFinite(dv) || dv <= 0) return 0;
	const vm = Number(vanillaMax);
	const sm = Number(vidaMax);
	if (!Number.isFinite(vm) || vm <= 0 || !Number.isFinite(sm) || sm <= 0) return 0;
	return Math.floor((dv / vm) * sm);
}

function killPlayerBestEffort(player) {
	try {
		if (typeof player.kill === "function") {
			player.kill();
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		player.runCommandAsync?.("kill @s");
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

export function handlePlayerSpawn(player, config = undefined) {
	try {
		if (!player) return;
		if (!isHEnabled(player)) return;

		let vidaMax = getScoreBestEffort(OBJ_VIDA_MAX, player);
		if (vidaMax === undefined) {
			vidaMax = defaultVidaMaxForPlayer(player, config);
			setScoreBestEffort(OBJ_VIDA_MAX, player, vidaMax);
		}

		// Respawn: Vida vuelve al máximo (si VidaMax>0).
		if (vidaMax > 0) {
			setScoreBestEffort(OBJ_VIDA, player, vidaMax);
		} else {
			// VidaMax==0 => inmortal lógica
			setScoreBestEffort(OBJ_VIDA, player, 0);
		}
		setScoreBestEffort(OBJ_H_DEAD, player, 0);
	} catch (e) {
		void e;
	}
}

export function syncPlayers(world, config = undefined) {
	try {
		debugTickCounter = (debugTickCounter + 1) % 2000000000;
		/** @type {Set<string>} */
		const alive = new Set();

		for (const player of world.getPlayers()) {
			const key = getPlayerKey(player);
			if (key) alive.add(key);

			const st = ensurePlayerVidaInitialized(player, config);
			if (!st.enabled) {
				if (key) lastVanillaHealthByPlayerKey.delete(key);
				if (key) lastVidaByPlayerKey.delete(key);
				if (key) lastAbsHpByPlayerKey.delete(key);
				continue;
			}

			// Estado de absorción vanilla (corazones amarillos) / lectura best-effort.
			const absState = readAbsorptionStateBestEffort(player);
			let observedAbsHp = absState.hp;

			// Debug (rate-limited) para verificar integridad de absorción
			if (isDebugEnabled(config)) {
				const every = 20;
				if (debugTickCounter % every === 0) {
					const vidaAbsNow = Math.trunc(Number(getScoreBestEffort(OBJ_VIDA_ABSORCION, player) ?? 0));
					debugTellBestEffort(
						player,
						`[HealthDbg] absHp=${observedAbsHp} src=${absState.source} readable=${absState.readable} writeable=${absState.writeable} effAmp=${absState.effectAmplifier ?? "?"} effDur=${absState.effectDuration ?? "?"} | VidaAbs=${vidaAbsNow} | Vida=${Math.trunc(Number(getScoreBestEffort(OBJ_VIDA, player) ?? 0))} | VidaMaxTotalH=${Math.trunc(Number(getScoreBestEffort(OBJ_VIDA_MAX, player) ?? 0))}`,
						world
					);
				}
			}

			// Leer absorción y sincronizar con scoreboard VidaAbsorcion.
			let vidaAbs = Math.trunc(Number(getScoreBestEffort(OBJ_VIDA_ABSORCION, player) ?? 0));
			if (!Number.isFinite(vidaAbs) || vidaAbs < 0) vidaAbs = 0;
			if (st.vidaMax <= 0) {
				if (vidaAbs !== 0) setScoreBestEffort(OBJ_VIDA_ABSORCION, player, 0);
				vidaAbs = 0;
			}

			// Si hubo daño aplicado por otros sistemas (bajaron Vida), consumir absorción primero.
			if (key) {
				const prevVida = lastVidaByPlayerKey.get(key);
				if (prevVida !== undefined) {
					const curVida = Math.trunc(Number(st.vida));
					const damage = Math.max(0, Math.trunc(Number(prevVida) - Number(curVida)));
					if (damage > 0 && vidaAbs > 0) {
						const absorbed = Math.min(vidaAbs, damage);
						const remaining = damage - absorbed;
						const newVidaAbs = Math.max(0, vidaAbs - absorbed);
						const restoredVida = Math.trunc(Number(curVida) + absorbed);
						const newVida = Math.max(0, Math.min(st.vidaMax, Math.trunc(Number(prevVida) - remaining)));

						if (newVidaAbs !== vidaAbs) {
							vidaAbs = newVidaAbs;
							setScoreBestEffort(OBJ_VIDA_ABSORCION, player, vidaAbs);

							// Reflejar el consumo de absorción en corazones amarillos (solo DECREMENTO).
							if (st.vidaMax > 0) {
								const desiredAbsHpAfter = computeAbsHpFromVidaAbs(vidaAbs, st.vidaMax);
								// 1) Si el runtime permite setear absorción directamente, úsalo.
								if (absState.readable && absState.writeable && desiredAbsHpAfter < observedAbsHp) {
									if (setAbsorptionHpBestEffort(player, desiredAbsHpAfter)) {
										observedAbsHp = desiredAbsHpAfter;
									}
								}
								// 2) Si NO podemos escribir absorción (p.ej. solo efecto), al menos
								// limpiar el efecto cuando el escudo llega a 0 para evitar corazones fantasma.
								if (!absState.writeable && desiredAbsHpAfter <= 0) {
									if (clearAbsorptionEffectBestEffort(player)) {
										observedAbsHp = 0;
										if (key) lastAbsHpByPlayerKey.set(key, 0);
									}
								}
							}
						}
						// st.vida ya fue bajada por el sistema externo, así que la restauramos.
						if (newVida !== curVida && restoredVida !== curVida) {
							setScoreBestEffort(OBJ_VIDA, player, newVida);
							st.vida = newVida;
						}
					}
				}
				lastVidaByPlayerKey.set(key, Math.trunc(Number(st.vida)));
			}

			// Muerte lógica: si Vida<=0 y VidaMax>0, matar y marcar para reset en respawn.
			if (!st.immortal && st.vidaMax > 0 && Number(st.vida) <= 0) {
				setScoreBestEffort(OBJ_H_DEAD, player, 1);
				killPlayerBestEffort(player);
				if (key) lastVanillaHealthByPlayerKey.delete(key);
				continue;
			}

			const health = readHealthComponent(player);
			if (!health) continue;

			// Absorción: ingesta + expiración por tiempo (reflejada por el motor)
			if (key) {
				const prevAbsHp = lastAbsHpByPlayerKey.get(key);
				const prevHp = prevAbsHp === undefined ? 0 : prevAbsHp;
				if (absState.readable && st.vidaMax > 0) {
					const deltaHp = Math.trunc(observedAbsHp - prevHp);
						if (deltaHp > 0) {
							// Ganó absorción (manzana): sumar bonus.
							const addVidaAbs = computeVidaAbsFromAbsHp(deltaHp, st.vidaMax);
							if (addVidaAbs > 0) {
								vidaAbs = Math.trunc(vidaAbs + addVidaAbs);
								setScoreBestEffort(OBJ_VIDA_ABSORCION, player, vidaAbs);
							}
						} else if (deltaHp < 0) {
							// Bajó absorción por tiempo (o por algún consumo vanilla): clamp del bonus.
							const maxVidaAbs = computeVidaAbsFromAbsHp(observedAbsHp, st.vidaMax);
							if (vidaAbs > maxVidaAbs) {
								vidaAbs = maxVidaAbs;
								setScoreBestEffort(OBJ_VIDA_ABSORCION, player, vidaAbs);
							}
						}
				}
				// Guardar para comparar en el siguiente tick.
				lastAbsHpByPlayerKey.set(key, absState.readable ? observedAbsHp : 0);
			}

			const prev = key ? lastVanillaHealthByPlayerKey.get(key) : undefined;
			const curVanilla = health.cur;

			// 1) Detectar curación vanilla (delta positivo) y traducirla a Vida.
			if (prev !== undefined) {
				const delta = curVanilla - prev;
				if (delta > 0) {
					const add = convertVanillaHealToScoreDelta(delta, health.max, st.vidaMax);
					if (add > 0) {
						const newVida = Math.max(0, Math.min(st.vidaMax, st.vida + add));
						if (newVida !== st.vida) {
							setScoreBestEffort(OBJ_VIDA, player, newVida);
							st.vida = newVida;
							if (key) lastVidaByPlayerKey.set(key, Math.trunc(Number(newVida)));
						}
					}
				}
				// delta negativo se ignora: NO bajar Vida.
			}

			// 2) Sincronizar scoreboard -> corazones vanilla SIEMPRE.
			const target = computeTargetVanillaHealth(st.vida, st.vidaMax, health.max);
			if (Math.abs(curVanilla - target) >= 0.0001) {
				applyVanillaHealthBestEffort(health.hc, target);
				if (key) lastVanillaHealthByPlayerKey.set(key, target);
			} else {
				if (key) lastVanillaHealthByPlayerKey.set(key, curVanilla);
			}
		}

		// Cleanup de jugadores desconectados
		for (const key of lastVanillaHealthByPlayerKey.keys()) {
			if (!alive.has(key)) lastVanillaHealthByPlayerKey.delete(key);
		}
		for (const key of lastVidaByPlayerKey.keys()) {
			if (!alive.has(key)) lastVidaByPlayerKey.delete(key);
		}
		for (const key of lastAbsHpByPlayerKey.keys()) {
			if (!alive.has(key)) lastAbsHpByPlayerKey.delete(key);
		}
	} catch (e) {
		void e;
	}
}
