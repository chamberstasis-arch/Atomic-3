const skillDefinitions = new Map();

function normalizeSkillId(skillId) {
	return String(skillId ?? "").trim().toLowerCase();
}

export function setRegisteredSkillDefinition(skillId, definition) {
	const id = normalizeSkillId(skillId || definition?.id);
	if (!id || !definition || typeof definition !== "object") return null;
	skillDefinitions.set(id, definition);
	return definition;
}

export function getRegisteredSkillDefinition(skillId) {
	const id = normalizeSkillId(skillId);
	if (!id) return null;
	return skillDefinitions.get(id) ?? null;
}

export function listRegisteredSkillDefinitions() {
	return Array.from(skillDefinitions.values());
}