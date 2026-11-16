export const DEFAULT_PLAYER_VIDA_MAX = 100;
export const MOB_VIDA_MULTIPLIER = 5;

// Intervalos (ticks)
export const DEFAULT_PLAYER_LOOP_TICKS = 2;
export const DEFAULT_MOB_LOOP_TICKS = 10;
export const DEFAULT_MOB_SCAN_TICKS = 40;

export function defaultVidaMaxForPlayer(player, config = undefined) {
	void player;
	const v = Number(config?.defaultPlayerVidaMax ?? DEFAULT_PLAYER_VIDA_MAX);
	if (!Number.isFinite(v) || v < 0) return DEFAULT_PLAYER_VIDA_MAX;
	return Math.trunc(v);
}

export function defaultVidaMaxForEntity(entity, config = undefined) {
	const mult = Number(config?.mobVidaMultiplier ?? MOB_VIDA_MULTIPLIER);
	const m = Number.isFinite(mult) && mult > 0 ? mult : MOB_VIDA_MULTIPLIER;

	try {
		const hc = entity?.getComponent?.("minecraft:health");
		const cur = Number(hc?.currentValue);
		if (Number.isFinite(cur) && cur > 0) {
			return Math.trunc(cur * m);
		}
	} catch (e) {
		void e;
	}

	// Fallback: si no hay componente de health o no se puede leer, usar 100.
	return 100;
}
