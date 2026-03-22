export function floorInt(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return Math.floor(v);
}

export function clampMin0(n) {
	const v = Math.trunc(Number(n));
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, v);
}

export function clampPercent0to100(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, v));
}

export function rollCrit(probPercent) {
	const p = clampPercent0to100(probPercent);
	if (p >= 100) return true;
	if (p <= 0) return false;
	// 0..99
	return Math.floor(Math.random() * 100) < p;
}
