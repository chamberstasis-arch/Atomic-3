// Feature: skills/lecture

import { floorFinite, toNumberOr } from "./utilMath.js";

const FORMAT_CODE_RE = /§./g;

function normalizeLine(line) {
	return String(line ?? "")
		.replace(FORMAT_CODE_RE, "")
		.replace(/\s+/g, " ")
		.trim();
}

function parseNumberLoose(text) {
	const s = String(text ?? "").trim().replace(",", ".");
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

function extractTotalNumber(normalizedLine) {
	// primer número después de ':' con + opcional y decimales opcionales
	const m = /[:]\s*\+?\s*([0-9]+(?:[., ][0-9]+)?)/.exec(normalizedLine);
	if (!m) return null;
	return parseNumberLoose(m[1]);
}

function normalizeScoreValue(stat, rawValue) {
	const n = toNumberOr(rawValue, 0);
	if (stat?.scale === "percent_to_1000") {
		// Acepta dos formatos de lore:
		// - porcentaje visual (50.2 => 502)
		// - score directo (502 => 502)
		const scaled = n <= 100 ? n * 10 : n;
		const clamped = Math.max(0, Math.min(1000, scaled));
		return floorFinite(clamped, 0);
	}
	if (stat?.x10) return floorFinite(n * 10, 0);
	return floorFinite(n, 0);
}

/**
 * Parseo genérico: por stat.label al inicio de la línea normalizada.
 * Retorna el valor en representación de scoreboard:
 * - int: floor(n)
 * - float: floor(n)
 * - x10: floor(n * 10)
 * - scale=percent_to_1000: n<=100 ? floor(n*10) : floor(n), luego clamp 0..1000
 */
export function parseItemTotalsFromLore(loreLines, statRegistry) {
	const lines = Array.isArray(loreLines) ? loreLines : [];

	/** @type {Record<string, number>} */
	const out = {};

	// Normalizamos una vez.
	const normalized = lines.map((l) => normalizeLine(l)).filter((l) => l.length > 0);

	for (const stat of statRegistry) {
		const label = String(stat?.label ?? "").trim();
		if (!label) {
			out[stat.id] = 0;
			continue;
		}

		let value = 0;
		for (const line of normalized) {
			// label al inicio (case-insensitive)
			if (!line.toLowerCase().startsWith(label.toLowerCase())) continue;
			const n = extractTotalNumber(line);
			if (n == null) break;
			value = normalizeScoreValue(stat, n);
			break;
		}

		out[stat.id] = Math.trunc(value);
	}

	return out;
}
