import { system } from "@minecraft/server";

function removeTitleBestEffort(entity) {
	try {
		if (!entity || !entity.isValid) return;
		if (typeof entity.remove === "function") {
			entity.remove();
			return;
		}
		if (typeof entity.kill === "function") {
			entity.kill();
			return;
		}
	} catch (e) {
		void e;
	}
	try {
		// Ultimo recurso
		entity?.runCommand?.("kill @s");
	} catch (e) {
		void e;
	}
}

export function spawnDamageHologram({ dimension, location, text, durationMs }) {
	try {
		if (!dimension || !location) return null;
		if (typeof text !== "string" || text.length === 0) return null;

		const ent = dimension.spawnEntity("atomic:hologram", location);
		if (!ent) return null;

		try {
			ent.nameTag = text;
		} catch (e) {
			void e;
		}

		const ticks = Math.max(1, Math.round(Math.max(0, Number(durationMs ?? 1200)) / 50));
		system.runTimeout(() => removeTitleBestEffort(ent), ticks);
		return ent;
	} catch (e) {
		void e;
		return null;
	}
}
