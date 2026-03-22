import { system } from "@minecraft/server";
import { OBJ_VIDA, OBJ_VIDA_MAX, getScoreBestEffort, isHEnabled, setScoreBestEffort } from "./scoreboards.js";
import { defaultVidaMaxForEntity } from "./defaults.js";

/** @type {Set<any>} */
const trackedMobs = new Set();

function getEntityKey(entity) {
	try {
		const sbid = entity?.scoreboardIdentity?.id;
		if (sbid != null) return `sb:${String(sbid)}`;
		if (entity?.id) return `en:${String(entity.id)}`;
	} catch (e) {
		void e;
	}
	return null;
}

function hasHealthComponent(entity) {
	try {
		return !!entity?.getComponent?.("minecraft:health");
	} catch (e) {
		void e;
		return false;
	}
}

function ensureMobVidaInitialized(entity, config) {
	if (!isHEnabled(entity)) return { enabled: false };
	if (!hasHealthComponent(entity)) return { enabled: false };

	let vidaMax = getScoreBestEffort(OBJ_VIDA_MAX, entity);
	if (vidaMax === undefined) {
		vidaMax = defaultVidaMaxForEntity(entity, config);
		setScoreBestEffort(OBJ_VIDA_MAX, entity, vidaMax);
	}

	// Caso especial: VidaMax==0 => inmortal lógica (no forzar default)
	if (vidaMax === 0) {
		const vida = getScoreBestEffort(OBJ_VIDA, entity);
		if (vida === undefined) setScoreBestEffort(OBJ_VIDA, entity, 0);
		return { enabled: true, vida: vida ?? 0, vidaMax: 0, immortal: true };
	}

	let vida = getScoreBestEffort(OBJ_VIDA, entity);
	if (vida === undefined) {
		vida = vidaMax;
		setScoreBestEffort(OBJ_VIDA, entity, vida);
	}

	// Clamp Vida <= VidaMax
	if (Number.isFinite(vidaMax) && vidaMax > 0) {
		const clamped = Math.max(0, Math.min(vidaMax, Math.trunc(Number(vida))));
		if (clamped !== vida) {
			vida = clamped;
			setScoreBestEffort(OBJ_VIDA, entity, vida);
		}
	}

	return { enabled: true, vida, vidaMax, immortal: false };
}

function killEntityBestEffort(entity) {
	try {
		// Preferido si existe
		if (typeof entity.kill === "function") {
			entity.kill();
			return;
		}
	} catch (e) {
		void e;
	}
	try {
		entity.runCommandAsync?.("kill @s");
	} catch (e) {
		void e;
	}
}

export function considerTrackMob(entity, config = undefined) {
	try {
		if (!entity || entity.typeId === "minecraft:player") return;
		const st = ensureMobVidaInitialized(entity, config);
		if (!st.enabled) return;
		trackedMobs.add(entity);
	} catch (e) {
		void e;
	}
}

export function syncMobs(world, config = undefined) {
	try {
		// 1) Refrescar/integrar mobs del set tracked
		for (const entity of trackedMobs) {
			try {
				if (!entity || !entity.isValid || entity.typeId === "minecraft:player") {
					trackedMobs.delete(entity);
					continue;
				}

				const st = ensureMobVidaInitialized(entity, config);
				if (!st.enabled) {
					trackedMobs.delete(entity);
					continue;
				}

				if (st.vidaMax > 0) {
					if (Number(st.vida) <= 0) {
						killEntityBestEffort(entity);
						continue;
					}
				}
			} catch (e) {
				void e;
				trackedMobs.delete(entity);
			}
		}
		void config;
		void world;
	} catch (e) {
		void e;
	}
}

export function scanAndTrackMobs(world, config = undefined) {
	try {
		const dims = ["overworld", "nether", "the_end"];
		for (const dimId of dims) {
			let dim;
			try {
				dim = world.getDimension(dimId);
			} catch (e) {
				void e;
				continue;
			}
			if (!dim) continue;

			const entities = dim.getEntities({ excludeTypes: ["minecraft:player"] });
			for (const ent of entities) considerTrackMob(ent, config);
		}
	} catch (e) {
		void e;
	}
}
