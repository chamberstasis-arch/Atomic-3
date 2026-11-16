import { getScore, setScore, OBJ_H, OBJ_VIDA, OBJ_VIDA_MAX } from "./scoreboard.js";
import { spawnEffectDamageHologram } from "./hologram.js";
import { spawnEffectParticles } from "./particles.js";

function isSafeCommandToken(token) {
	return /^[0-9A-Za-z_:\.-]+$/.test(String(token != null ? token : ""));
}

function playEffectSoundBestEffort(player, soundDef) {
	try {
		const id = String(soundDef?.id ?? "").trim();
		if (!id) return;
		const volume = Number.isFinite(Number(soundDef?.volume)) ? Number(soundDef.volume) : 1;
		const pitch = Number.isFinite(Number(soundDef?.pitch)) ? Number(soundDef.pitch) : 1;
		const volC = Math.max(0, Math.min(4, volume));
		const pitC = Math.max(0, Math.min(2, pitch));

		// 1) Prefer player API
		try {
			if (typeof player?.playSound === "function") {
				player.playSound(id, { volume: volC, pitch: pitC });
				return;
			}
		} catch (e) {
			void e;
		}

		// 2) Dimension API
		try {
			const dim = player?.dimension;
			const loc = player?.location;
			if (dim && loc && typeof dim.playSound === "function") {
				dim.playSound(id, loc, { volume: volC, pitch: pitC });
				return;
			}
		} catch (e) {
			void e;
		}

		// 3) Command fallback
		try {
			if (!isSafeCommandToken(id)) return;
			player?.runCommand?.(`playsound ${id} @s ~~~ ${volC} ${pitC}`);
		} catch (e) {
			void e;
		}
	} catch (e) {
		void e;
	}
}

function applySymbolicDamageBestEffort(player, amountInt) {
	try {
		if (!player || !player.isValid) return;
		const amt = Math.max(0, Math.trunc(Number(amountInt)));
		if (!Number.isFinite(amt) || amt <= 0) return;

		// 1) Prefer API damage if available
		try {
			if (typeof player.applyDamage === "function") {
				player.applyDamage(amt);
				return;
			}
		} catch (e) {
			void e;
		}

		// 2) Fallback: command (camera/hurt feedback)
		try {
			player.runCommand?.(`damage @s ${amt}`);
		} catch (e) {
			void e;
		}
	} catch (e) {
		void e;
	}
}

function clampMin0Int(n) {
	const v = Math.trunc(Number(n));
	return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function hasHEnabled(player) {
	return getScore(player, OBJ_H, 0) === 1;
}

function applyVanillaEffectBestEffort(player, def, secondsRemaining) {
	try {
		const ve = def?.vanillaEffect;
		if (!ve || typeof ve.id !== "string") return;
		const id = String(ve.id);
		const amp = clampMin0Int(ve.amplifier ?? 0);
		const showParticles = ve.showParticles !== false;

		const minDur = Math.max(1, Math.trunc(Number(ve.minDurationTicks ?? 60)));
		const durFromSeconds = Math.max(1, Math.trunc(Number(secondsRemaining) * 20 + 5));
		const duration = Math.max(minDur, durFromSeconds);

		player.addEffect(id, duration, { amplifier: amp, showParticles });
	} catch (e) {
		void e;
	}
}

function removeVanillaEffectBestEffort(player, def) {
	try {
		const ve = def?.vanillaEffect;
		if (!ve || typeof ve.id !== "string") return;
		player.removeEffect(String(ve.id));
	} catch (e) {
		void e;
	}
}

function applyDamageTickToPlayer(config, player, def) {
	try {
		const secondsRemaining = clampMin0Int(getScore(player, def.objective, 0));
		if (secondsRemaining <= 0) return;

		const vida = Math.trunc(Number(getScore(player, OBJ_VIDA, 0)));
		if (!Number.isFinite(vida) || vida <= 0) return;

		// El daño de efectos escala con la vida máxima total (no con la vida actual).
		const vidaMax = Math.trunc(Number(getScore(player, OBJ_VIDA_MAX, 0)));
		if (!Number.isFinite(vidaMax) || vidaMax <= 0) return;

		const pct = Number(def.percentOfVida ?? 0);
		if (!Number.isFinite(pct) || pct <= 0) return;

		const danoEfecto = Math.max(0, Math.floor(vidaMax * pct));
		if (danoEfecto <= 0) return;

		let nuevaVida = vida - danoEfecto;
		if (Number(def.type) === 1) nuevaVida = Math.max(1, nuevaVida);

		if (nuevaVida === vida) return;
		setScore(player, OBJ_VIDA, nuevaVida);

		const danoRealAplicado = vida - nuevaVida;
		if (danoRealAplicado > 0) {
			spawnEffectDamageHologram(config, player, danoRealAplicado, def.hologramText);
			// Sonido por tick de daño (solo efectos que lo definan)
			if (def?.sound?.id) playEffectSoundBestEffort(player, def.sound);
			// Daño simbólico (vanilla) para feedback visual/cámara.
			// El sistema de vida custom cancela/bypassea el daño real fuera de scoreboards.
			applySymbolicDamageBestEffort(player, 1);
		}

		const particleId = def?.particles?.id;
		if (typeof particleId === "string" && particleId.length > 0) {
			spawnEffectParticles(config, player, particleId, def?.particles?.yOffset ?? 0);
		}

		// Mantener efecto vanilla (si existe) sincronizado visualmente
		applyVanillaEffectBestEffort(player, def, secondsRemaining);
	} catch (e) {
		void e;
	}
}

function decrementEffectSeconds(player, objectiveId) {
	try {
		const cur = clampMin0Int(getScore(player, objectiveId, 0));
		if (cur <= 0) return 0;
		const next = Math.max(0, cur - 1);
		if (next !== cur) setScore(player, objectiveId, next);
		return next;
	} catch (e) {
		void e;
		return 0;
	}
}

export function processEffectsTick(world, config, tickCounter) {
	try {
		const effects = config?.effects ?? {};
		const decEvery = Math.max(1, Math.trunc(Number(config?.runtime?.decrementEveryTicks ?? 20)));

		const doDecrement = tickCounter % decEvery === 0;
		const doTick18 = tickCounter % 18 === 0;
		const doTick25 = tickCounter % 25 === 0;

		if (!doDecrement && !doTick18 && !doTick25) return;

		const players = world.getPlayers();
		for (const player of players) {
			if (!player || !player.isValid) continue;
			if (!hasHEnabled(player)) continue;

			// Decremento por segundo y expiración
			if (doDecrement) {
				for (const def of Object.values(effects)) {
					if (!def || typeof def.objective !== "string") continue;
					const next = decrementEffectSeconds(player, def.objective);
					if (next === 0) removeVanillaEffectBestEffort(player, def);
					else applyVanillaEffectBestEffort(player, def, next);
				}
			}

			// Ticks de daño
			for (const def of Object.values(effects)) {
				if (!def || typeof def.objective !== "string") continue;
				const every = Math.max(1, Math.trunc(Number(def.damageEveryTicks ?? 20)));
				if (every === 18 && !doTick18) continue;
				if (every === 25 && !doTick25) continue;
				if (every !== 18 && every !== 25 && tickCounter % every !== 0) continue;
				applyDamageTickToPlayer(config, player, def);
			}
		}
	} catch (e) {
		void e;
	}
}
