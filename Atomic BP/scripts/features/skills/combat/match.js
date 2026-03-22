import { EquipmentSlot } from "@minecraft/server";

function asStr(value) {
	return String(value != null ? value : "").trim();
}

function normalizeKey(value) {
	return asStr(value).toLowerCase();
}

function normalizeName(value) {
	const text = asStr(value).replace(/§./g, "").replace(/\s+/g, " ").trim();
	return text.toLowerCase();
}

function hasValue(value) {
	return asStr(value).length > 0;
}

export function getMainhandNameBestEffort(entity) {
	try {
		const eq = entity?.getComponent?.("minecraft:equippable");
		if (!eq || typeof eq.getEquipment !== "function") return "";
		const item = eq.getEquipment(EquipmentSlot.Mainhand);
		if (!item) return "";
		const customName = asStr(item.nameTag);
		if (customName) return customName;
		return asStr(item.typeId);
	} catch (e) {
		void e;
		return "";
	}
}

export function snapshotEntityForMatch(entity) {
	const typeId = asStr(entity?.typeId);
	const nameTag = asStr(entity?.nameTag);
	const mainhandName = getMainhandNameBestEffort(entity);
	return {
		typeId,
		nameTag,
		mainhandName,
	};
}

function entrySpecificity(entry) {
	let count = 0;
	if (hasValue(entry?.typeId)) count += 1;
	if (hasValue(entry?.nameTag)) count += 1;
	if (hasValue(entry?.mainhandName)) count += 1;
	return count;
}

function entryMatches(snapshot, entry) {
	const entryType = normalizeKey(entry?.typeId);
	const entryName = normalizeName(entry?.nameTag);
	const entryMainhand = normalizeName(entry?.mainhandName);

	if (!entryType && !entryName && !entryMainhand) return false;

	if (entryType && normalizeKey(snapshot?.typeId) !== entryType) return false;
	if (entryName && normalizeName(snapshot?.nameTag) !== entryName) return false;
	if (entryMainhand && normalizeName(snapshot?.mainhandName) !== entryMainhand) return false;
	return true;
}

export function resolveMobMatch(snapshot, entries) {
	const list = Array.isArray(entries) ? entries : [];
	let best = null;
	let bestScore = -1;
	let bestIndex = Number.MAX_SAFE_INTEGER;

	for (let i = 0; i < list.length; i += 1) {
		const entry = list[i];
		if (!entry || typeof entry !== "object") continue;
		if (!entryMatches(snapshot, entry)) continue;
		const score = entrySpecificity(entry);
		if (score > bestScore || (score === bestScore && i < bestIndex)) {
			best = entry;
			bestScore = score;
			bestIndex = i;
		}
	}

	return best;
}
