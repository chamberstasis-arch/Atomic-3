function asStr(value) {
	return String(value != null ? value : "").trim();
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.trunc(n);
}

function normalizeSpreadConfig(rawSpread, rawDefaults = {}) {
	const defaults = rawDefaults && typeof rawDefaults === "object" ? rawDefaults : {};
	const spread = rawSpread && typeof rawSpread === "object" ? rawSpread : {};
	const objective = asStr(spread.objective ?? defaults.objective);
	const pointsPerExtra = Math.max(1, toInt(spread.pointsPerExtra ?? defaults.pointsPerExtra, 100));
	const maxExtraBlocks = Math.max(0, toInt(spread.maxExtraBlocks ?? defaults.maxExtraBlocks, 0));
	const maxVisitedBlocks = Math.max(maxExtraBlocks || 0, toInt(spread.maxVisitedBlocks ?? defaults.maxVisitedBlocks, 128));
	const matchMode = asStr(spread.matchMode ?? defaults.matchMode).toLowerCase() || "same-block-type";
	const enabled = spread.enabled !== false && (spread.enabled === true || defaults.enabledByDefault === true);
	return {
		enabled,
		objective,
		pointsPerExtra,
		maxExtraBlocks,
		maxVisitedBlocks,
		matchMode,
	};
}

function getOrthogonalNeighbors(pos) {
	return [
		{ x: pos.x + 1, y: pos.y, z: pos.z },
		{ x: pos.x - 1, y: pos.y, z: pos.z },
		{ x: pos.x, y: pos.y + 1, z: pos.z },
		{ x: pos.x, y: pos.y - 1, z: pos.z },
		{ x: pos.x, y: pos.y, z: pos.z + 1 },
		{ x: pos.x, y: pos.y, z: pos.z - 1 },
	];
}

function computeExtraBreaks(statValue, pointsPerExtra, maxExtraBlocks) {
	const stat = Math.max(0, toInt(statValue, 0));
	if (stat <= 0 || maxExtraBlocks <= 0) return 0;
	const guaranteed = Math.trunc(stat / pointsPerExtra);
	const residue = stat % pointsPerExtra;
	const probabilistic = residue > 0 && Math.random() * pointsPerExtra < residue ? 1 : 0;
	return Math.max(0, Math.min(maxExtraBlocks, guaranteed + probabilistic));
}

function matchesSpreadTarget(candidateDef, originBlockDef, candidateBlockTypeId, originBlockTypeId, matchMode) {
	if (!candidateDef || !originBlockDef) return false;
	if (matchMode === "same-definition") return asStr(candidateDef.id) === asStr(originBlockDef.id);
	if (matchMode === "same-skill") return asStr(candidateDef.skill) === asStr(originBlockDef.skill);
	return asStr(candidateBlockTypeId) === asStr(originBlockTypeId);
}

export function resolveSpreadTargets(context) {
	const spread = normalizeSpreadConfig(context?.blockDef?.spread, context?.spreadDefaults);
	if (!spread.enabled || !spread.objective || spread.maxExtraBlocks <= 0) return [];

	const statValue = context?.getScoreBestEffort?.(context.player, spread.objective) ?? 0;
	const extraBreaks = computeExtraBreaks(statValue, spread.pointsPerExtra, spread.maxExtraBlocks);
	if (extraBreaks <= 0) return [];

	const queue = [context.originPos];
	const visited = new Set([context.makeKeyFromPos(context.dimensionId, context.originPos)]);
	const out = [];

	while (queue.length > 0 && out.length < extraBreaks && visited.size <= spread.maxVisitedBlocks) {
		const current = queue.shift();
		for (const neighbor of getOrthogonalNeighbors(current)) {
			const key = context.makeKeyFromPos(context.dimensionId, neighbor);
			if (visited.has(key)) continue;
			visited.add(key);

			if (context.pendingByKey?.has?.(key) || context.processingKeys?.has?.(key)) continue;

			const blockTypeId = context.getBlockTypeIdSafe?.(context.dimension, neighbor);
			if (!blockTypeId) continue;
			const candidateDef = context.getBlockDefinition?.(context.registry, blockTypeId);
			if (!matchesSpreadTarget(candidateDef, context.blockDef, blockTypeId, context.originBlockTypeId, spread.matchMode)) continue;
			if (!context.isInAnyArea?.(context.dimensionId, neighbor, context.areas, candidateDef?.areaIds)) continue;

			out.push({ key, pos: neighbor, blockTypeId, blockDef: candidateDef });
			queue.push(neighbor);
			if (out.length >= extraBreaks) break;
		}
	}

	return out;
}