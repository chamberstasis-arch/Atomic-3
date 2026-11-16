import { system, world } from "@minecraft/server";
import { buildScoreboardCatalog } from "./catalog.js";
import achievementsConfig from "../features/achievements/config.js";

let didInit = false;

function ensureObjectiveBestEffort(id, displayName) {
	const objectiveId = String(id != null ? id : "").trim();
	if (!objectiveId) return false;

	try {
		const existing = world.scoreboard.getObjective(objectiveId);
		if (existing) return true;
	} catch (e) {
		void e;
	}

	try {
		world.scoreboard.addObjective(objectiveId, String(displayName ?? objectiveId));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function ensureAllOnce() {
	const catalog = buildScoreboardCatalog();
	for (const entry of catalog) {
		ensureObjectiveBestEffort(entry.id, entry.displayName);
	}
	// LogrosTotal dinámico (global)
	try {
		const totalObjectiveId = String(achievementsConfig?.totals?.totalObjective ?? "LogrosTotal");
		const obj = world.scoreboard.getObjective(totalObjectiveId);
		if (obj) {
			const total = Array.isArray(achievementsConfig?.achievements) ? achievementsConfig.achievements.length : 0;
			try {
				obj.setScore("global", total);
			} catch (e) {
				void e;
				try {
					const dim = world.getDimension("minecraft:overworld");
					if (dim) {
						if (typeof dim.runCommand === "function") {
							dim.runCommand(`scoreboard players set global ${totalObjectiveId} ${total}`);
						} else if (typeof dim.runCommand === "function") {
							dim.runCommand(`scoreboard players set global ${totalObjectiveId} ${total}`);
						}
					}
				} catch (e2) {
					void e2;
				}
			}
		}
	} catch (e) {
		void e;
	}
}

/**
 * Inicializa todos los scoreboards del BP en un solo punto.
 * Se ejecuta post-worldLoad con fallback a siguiente tick.
 */
export function initAllScoreboards() {
	if (didInit) return;
	didInit = true;

	let scheduled = false;
	try {
		if (world?.afterEvents?.worldLoad && typeof world.afterEvents.worldLoad.subscribe === "function") {
			world.afterEvents.worldLoad.subscribe(() => ensureAllOnce());
			scheduled = true;
		}
	} catch (e) {
		void e;
		scheduled = false;
	}

	if (!scheduled) {
		try {
			system.run(() => ensureAllOnce());
		} catch (e2) {
			void e2;
			ensureAllOnce();
		}
	}
}
