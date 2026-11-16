import { world } from "@minecraft/server";
import deathConfig from "./config.js";
import { applyCustomEmojisToText } from "./emoji/index.js";
import { buildSpecialDeathMessageMap, resolveDeathMessage } from "./deathMessageResolver.js";
import { computeMoneyLoss } from "./moneyLoss.js";
import { safeString } from "./format.js";

const OBJ_MUERTES = "muertes";
const OBJ_D = "D";
const OBJ_VIP = "vip";

/** @type {Map<string, any>} */
const objectiveCache = new Map();

function getObjectiveCached(id) {
	if (objectiveCache.has(id)) return objectiveCache.get(id) ?? null;
	try {
		const obj = world.scoreboard.getObjective(id) ?? null;
		if (obj) objectiveCache.set(id, obj);
		return obj;
	} catch (e) {
		void e;
		return null;
	}
}

function getParticipant(entity) {
	try {
		return entity?.scoreboardIdentity ?? null;
	} catch (e) {
		void e;
		return null;
	}
}

function getScore(entity, objectiveId, defaultValue = 0) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return defaultValue;
		const p = getParticipant(entity);
		if (!p) return defaultValue;
		const v = obj.getScore(p);
		if (v === undefined || v === null) return defaultValue;
		const n = Math.trunc(Number(v));
		return Number.isFinite(n) ? n : defaultValue;
	} catch (e) {
		void e;
		return defaultValue;
	}
}

function setScore(entity, objectiveId, value) {
	try {
		const obj = getObjectiveCached(objectiveId);
		if (!obj) return false;
		const p = getParticipant(entity);
		if (!p) return false;
		obj.setScore(p, Math.trunc(Number(value)));
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function addScore(entity, objectiveId, delta) {
	const cur = getScore(entity, objectiveId, 0);
	const next = cur + Math.trunc(Number(delta));
	setScore(entity, objectiveId, next);
	return next;
}

function isPlayer(entity) {
	try {
		return entity?.typeId === "minecraft:player";
	} catch (e) {
		void e;
		return false;
	}
}


function bestEffortTellraw(target, text) {
	const message = String(text ?? "");
	if (!message) return false;
	const t = String(target ?? "@a");
	if (t === "@a") {
		try {
			world.sendMessage(message);
			return true;
		} catch (e) {
			void e;
		}
	}
	const dim = world.getDimension("minecraft:overworld");
	if (!dim) return false;
	try {
		const cmd = `tellraw ${t} {"rawtext":[{"text":${JSON.stringify(message)}}]}`;
		dim.runCommand(cmd);
		return true;
	} catch (e) {
		void e;
		return false;
	}
}

function sendMessageToPlayer(player, text) {
	try {
		if (typeof player?.sendMessage === "function") {
			player.sendMessage(String(text ?? ""));
			return true;
		}
	} catch (e) {
		void e;
	}
	try {
		player?.runCommand?.(`tellraw @s {"rawtext":[{"text":${JSON.stringify(String(text ?? ""))}}]}`);
		return true;
	} catch (e2) {
		void e2;
		return false;
	}
}

function applyEmojisIfEnabled(cfg, text) {
	if (!cfg?.emojis?.enabled) return String(text ?? "");
	return applyCustomEmojisToText(String(text ?? ""));
}

function playDeathSoundBestEffort(player, config) {
	const sound = config?.sounds?.deathSound;
	if (!sound || !sound.minecraftId) return;
	const id = String(sound.minecraftId);
	const volume = Number.isFinite(Number(sound.volume)) ? Number(sound.volume) : 1;
	const pitch = Number.isFinite(Number(sound.pitch)) ? Number(sound.pitch) : 1;
	try {
		player?.runCommand?.(`playsound ${id} @s ~~~ ${volume} ${pitch}`);
	} catch (e) {
		void e;
	}
}

function getCauseToken(src) {
	try {
		const raw = String(src?.cause ?? src?.damageType ?? src?.type ?? "");
		return raw.toLowerCase();
	} catch (e) {
		void e;
		return "";
	}
}

function resolveCauseFromSource(src) {
	if (!src) return { causeKey: "default", killerName: "" };

	let killerName = "";
	try {
		const attacker = src.damagingEntity;
		if (attacker?.typeId === "minecraft:player") {
			killerName = String(attacker.name ?? "");
			return { causeKey: "slainByPlayer", killerName };
		}
		const typeId = String(attacker?.typeId ?? "").toLowerCase();
		if (typeId.includes("zombie")) return { causeKey: "slainByZombie", killerName };
		if (typeId.includes("skeleton")) return { causeKey: "slainBySkeleton", killerName };
		if (typeId.includes("creeper")) return { causeKey: "slainByCreeper", killerName };
	} catch (e) {
		void e;
	}

	try {
		const proj = src.damagingProjectile;
		const projId = String(proj?.typeId ?? "").toLowerCase();
		if (projId.includes("arrow")) return { causeKey: "shotByArrow", killerName };
	} catch (e) {
		void e;
	}

	const token = getCauseToken(src);
	if (token.includes("fall")) return { causeKey: "fall", killerName };
	if (token.includes("lava")) return { causeKey: "lava", killerName };
	if (token.includes("fire")) return { causeKey: "fire", killerName };
	if (token.includes("drown")) return { causeKey: "drowning", killerName };
	if (token.includes("explosion")) return { causeKey: "explosion", killerName };
	if (token.includes("void")) return { causeKey: "void", killerName };

	return { causeKey: "default", killerName };
}

let didInit = false;

export function initDeathSystem(customConfig = undefined, deps = undefined) {
	if (didInit) return;
	didInit = true;
	void deps;

	const config = customConfig != null ? customConfig : deathConfig;
	const specialMap = buildSpecialDeathMessageMap(config);

	// Evento principal de muerte (nativo)
	try {
		world.afterEvents.entityDie.subscribe((ev) => {
			try {
				const entity = ev?.deadEntity;
				if (!entity || !isPlayer(entity)) return;

				const vipLevel = getScore(entity, OBJ_VIP, 0);
				const deathsAfter = addScore(entity, OBJ_MUERTES, 1);

				const cause = resolveCauseFromSource(ev?.damageSource ?? null);
				let message = resolveDeathMessage({
					config,
					specialMap,
					vipLevel,
					playerName: entity?.name ?? "?",
					killerName: cause.killerName ?? "",
					causeKey: cause.causeKey ?? "default",
				});
				if (!message) message = "<Player> ha muerto".split("<Player>").join(String(entity?.name ?? "?"));

				const broadcastTarget = safeString(config?.deathMessages?.broadcastTarget, "@a");
				const finalMessage = applyEmojisIfEnabled(config, message);
				bestEffortTellraw(broadcastTarget, finalMessage);

				const money = getScore(entity, OBJ_D, 0);
				const loss = computeMoneyLoss({
					config,
					vipLevel,
					deathsAfter,
					money,
				});

				if (loss.lossAmount > 0) {
					setScore(entity, OBJ_D, loss.newMoney);
					if (loss.lossMessage) {
						const msg = applyEmojisIfEnabled(config, loss.lossMessage);
						sendMessageToPlayer(entity, msg);
					}
				} else if (loss.shouldWarn) {
					const warningTemplate = String(config?.warnings?.warningTellraw ?? "");
					if (warningTemplate) {
						const warningText = warningTemplate.split("<CantidadPerder>").join(String(loss.warningPercent));
						const msg = applyEmojisIfEnabled(config, warningText);
						sendMessageToPlayer(entity, msg);
					}
				}

				playDeathSoundBestEffort(entity, config);
			} catch (e) {
				void e;
			}
		});
	} catch (e) {
		void e;
	}
}
