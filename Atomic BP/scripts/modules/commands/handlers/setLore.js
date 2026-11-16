import { EquipmentSlot, system } from "@minecraft/server";
import { applyCustomEmojisToText } from "../../../features/custom-emojis/index.js";

// Debug interno (consola). Mantener apagado por defecto.
const DEBUG_SETLORE = false;

const INVALID_STRING_MESSAGE = "§cstring inválido";
const NO_ITEM_MESSAGE = "§cNo hay un item en la mano principal";
const SUCCESS_APPLIED_MESSAGE = "§fLore aplicado correctamente";
const SUCCESS_OVERWROTE_MESSAGE = "§fLore sobreescrito correctamente";
const SUCCESS_CLEARED_MESSAGE = "§fLore eliminado correctamente";
const TOO_MANY_LINES_MESSAGE = "§cDemasiadas líneas de lore";
const LINE_TOO_LONG_MESSAGE = "§cUna línea del lore es demasiado larga";
const TOO_MANY_FORMAT_CODES_MESSAGE = "§cEl lore contiene demasiados códigos de formato";
const DRAFT_STARTED_MESSAGE = "§fModo edición iniciado. Usa: §a/atomic:setlore \"add <texto>\"§f y luego §a/atomic:setlore \"apply\"";
const DRAFT_AUTO_STARTED_MESSAGE = "§fModo edición iniciado automáticamente. Usa §a/atomic:setlore \"apply\"§f para aplicar.";
const DRAFT_CLEARED_MESSAGE = "§fEdición cancelada";
const DRAFT_APPLIED_MESSAGE = "§fLore aplicado desde edición";
const DRAFT_EMPTY_MESSAGE = "§cNo hay texto en edición";
const HELP_HEADER = "§f§lsetlore§r§f — ayuda";
const HELP_MESSAGE = [
	HELP_HEADER,
	"§7Uso directo:",
	"§f- §a/atomic:setlore \"<texto>\"§7 (usa \\n para líneas)",
	"§7Edición (recomendado para lores largos/Realms):",
	"§f- §a/atomic:setlore \"begin\"",
	"§f- §a/atomic:setlore \"add <texto>\"§7 (si hay espacios, va todo entre comillas)",
	"§f- §a/atomic:setlore \"apply\"",
	"§f- §a/atomic:setlore \"cancel\"",
	"§7Extras:",
	"§f- §a/atomic:setlore \"status\"§7 (muestra estado de la edición)",
	"§f- §a/atomic:setlore \"clear\"§7 (elimina el lore del item)",
].join("\n");

const MAX_LORE_LINES = 40;
// Nota: el cliente y el motor pueden tener límites internos. Usamos caps defensivos.
// - Visible: no cuenta secuencias §<código> (ej: §9), para ser menos invasivo.
// - Total: cuenta todo, como límite duro anti-crash.
const MAX_LORE_VISIBLE_LINE_LENGTH = 140;
const MAX_LORE_TOTAL_LINE_LENGTH = 220;
const MAX_LORE_TOTAL_VISIBLE_CHARS = 6000;
const MAX_FORMAT_CODES_PER_LINE = 48;
const MAX_FORMAT_CODES_TOTAL = 800;

// Buffer temporal por jugador para evitar enviar comandos enormes (causa típica de desconexión).
// No se persiste en archivos: vive solo en memoria mientras el servidor está activo.
const DRAFT_TTL_MS = 5 * 60 * 1000;
const MAX_DRAFT_CHARS = 24000;
const loreDrafts = new Map();

function isFormatCodeChar(ch) {
	if (typeof ch !== "string" || ch.length !== 1) return false;
	const code = ch.toLowerCase();
	return isResetCodeChar(code) || isModifierCodeChar(code) || isColorCodeChar(code);
}

function isModifierCodeChar(ch) {
	return typeof ch === "string" && ch.length === 1 && /[klmno]/i.test(ch);
}

function isColorCodeChar(ch) {
	if (typeof ch !== "string" || ch.length !== 1) return false;
	const code = ch.toLowerCase();
	// Atomic usa códigos extendidos tipo §p, §q, §z, etc. en múltiples UIs.
	// Para herencia entre líneas, tratamos cualquier alfanumérico como color
	// EXCEPTO modificadores vanilla (k-o) y reset (r).
	if (!/[0-9a-z]/i.test(code)) return false;
	if (isResetCodeChar(code) || isModifierCodeChar(code)) return false;
	return true;
}

function isResetCodeChar(ch) {
	return typeof ch === "string" && ch.length === 1 && /r/i.test(ch);
}

function pruneDrafts(nowMs) {
	for (const [key, entry] of loreDrafts) {
		if (!entry || typeof entry.updatedAt !== "number" || nowMs - entry.updatedAt > DRAFT_TTL_MS) {
			loreDrafts.delete(key);
		}
	}
}

function getPlayerDraftKey(player) {
	// player.id existe en builds recientes; usamos fallback a name si hiciera falta.
	try {
		if (player && typeof player.id === "string" && player.id) return player.id;
	} catch (e) {
		void e;
	}
	return player && player.name ? String(player.name) : "unknown";
}

function parseSetLoreMode(text) {
	if (typeof text !== "string") return { mode: "direct", payload: "" };
	const t = text.trim();
	const lower = t.toLowerCase();

	if (lower === "help" || lower === "?" || lower === "ayuda") return { mode: "help", payload: "" };
	if (lower === "status" || lower === "estado") return { mode: "status", payload: "" };
	if (lower === "clear" || lower === "borrar" || lower === "remove" || lower === "delete" || lower === "none" || lower === "off" || lower === "-") {
		return { mode: "clear", payload: "" };
	}

	if (lower === "begin" || lower === "start" || lower === "edit") return { mode: "begin", payload: "" };
	if (lower === "apply" || lower === "end" || lower === "finish") return { mode: "apply", payload: "" };
	if (lower === "cancel" || lower === "stop" || lower === "abort") return { mode: "cancel", payload: "" };

	// Importante: si el usuario escribe solo "add" (sin payload), NO debe caer en modo directo,
	// porque eso terminaría seteando el lore literalmente a "add".
	if (lower === "add" || lower === "append") return { mode: "add", payload: "" };

	// Formato: "add <texto>". Mantiene compatibilidad con 1 solo parámetro string.
	if (lower.startsWith("add ") || lower.startsWith("append ")) {
		const firstSpace = t.indexOf(" ");
		const payload = firstSpace >= 0 ? t.slice(firstSpace + 1) : "";
		return { mode: "add", payload };
	}

	return { mode: "direct", payload: t };
}

function isClearLoreToken(text) {
	if (typeof text !== "string") return false;
	const t = text.trim().toLowerCase();
	// Permite borrar lore sin guardar estado. Mantenerlo simple para UX.
	return t === "clear" || t === "borrar" || t === "remove" || t === "delete" || t === "none" || t === "null" || t === "off" || t === "-";
}

function formatPrefixFromState({ color, modifiers }) {
	// Orden vanilla de modificadores (no afecta render, pero hace el output estable).
	const modifierOrder = ["k", "l", "m", "n", "o"];
	const mods = modifierOrder.filter((m) => modifiers.has(m)).map((m) => `§${m}`).join("");
	// Para ser menos invasivo, evitamos prefijar §f cuando es blanco por defecto.
	const colorCode = color && color.toLowerCase() !== "f" ? `§${color}` : "";
	return `${colorCode}${mods}`;
}

function buildLinePrefix(state) {
	// Clave del fix de itálica:
	// En Bedrock, el lore suele renderizarse en itálica por defecto.
	// Prefijamos cada línea con §r para resetear estilos implícitos y luego re-aplicamos
	// el estado heredado (color + formatos) para no obligar al jugador a repetirlo.
	return `§r${formatPrefixFromState(state)}`;
}

function stateAfterText(text, initialState) {
	const state = {
		color: initialState && initialState.color != null ? initialState.color : "f",
		modifiers: new Set(initialState && initialState.modifiers ? initialState.modifiers : []),
	};

	for (let i = 0; i < text.length - 1; i++) {
		if (text[i] !== "§") continue;
		const next = text[i + 1];
		const code = typeof next === "string" ? next.toLowerCase() : "";
		if (!isFormatCodeChar(code)) continue;

		if (code === "r") {
			state.color = "f";
			state.modifiers.clear();
			continue;
		}

		if (isColorCodeChar(code)) {
			state.color = code;
			// En Minecraft, un código de color también limpia formatos.
			state.modifiers.clear();
			continue;
		}

		// Modificadores
		state.modifiers.add(code);
	}

	return state;
}

function countVisibleChars(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	// Cuenta caracteres visibles ignorando secuencias "§" + <cualquier char>.
	// Además, trata emojis (surrogate pairs) como 1 caracter visible.
	let visible = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "§" && i + 1 < text.length) {
			i++;
			continue;
		}

		// Surrogate pair (ej: 🪓) => cuenta como 1 y salta el low-surrogate.
		const codeUnit = text.charCodeAt(i);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && i + 1 < text.length) {
			const nextUnit = text.charCodeAt(i + 1);
			if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) {
				i++;
			}
		}
		visible++;
	}
	return visible;
}

function countFormatCodes(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	let count = 0;
	for (let i = 0; i < text.length - 1; i++) {
		if (text[i] !== "§") continue;
		const next = text[i + 1];
		if (isFormatCodeChar(next)) {
			count++;
			i++;
		}
	}
	return count;
}

function sanitizeFormattingCodes(text, budget) {
	// Normaliza códigos de formato para evitar crashes por spam (ej: muchos §r).
	// - Elimina códigos inválidos (deja el texto sin el '§' problemático)
	// - Aplica límites por línea y global (budget)
	if (typeof text !== "string" || text.length === 0) return "";
	let out = "";

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== "§") {
			out += ch;
			continue;
		}

		if (i + 1 >= text.length) {
			// '§' colgante al final: se elimina.
			break;
		}

		const next = text[i + 1];
		const code = typeof next === "string" ? next.toLowerCase() : "";
		if (!isFormatCodeChar(code)) {
			// Código no válido: removemos el '§' y el char siguiente.
			// Esto evita que el lore termine mostrando el caracter suelto (ej: "§phola" => "phola").
			i++;
			continue;
		}

		// Cuenta como un código de formato.
		budget.total++;
		budget.line++;
		if (budget.line > MAX_FORMAT_CODES_PER_LINE || budget.total > MAX_FORMAT_CODES_TOTAL) return null;

		out += `§${code}`;
		i++;
	}

	return out;
}

function extractStringValue(input) {
	if (typeof input === "string") return input;
	if (Array.isArray(input)) return input.length > 0 ? extractStringValue(input[0]) : null;

	if (input && typeof input === "object") {
		// Algunas versiones entregan objetos por parámetro, ej: { name: 'lore', value: 'text' }
		if (typeof input.value === "string") return input.value;
		if (typeof input.lore === "string") return input.lore;
		if (typeof input.text === "string") return input.text;
		if (typeof input.rawtext === "string") return input.rawtext;
		if (typeof input.rawText === "string") return input.rawText;

		// Fallback: busca recursivamente el primer string en el objeto (poco profundo).
		for (const value of Object.values(input)) {
			if (typeof value === "string") return value;
			if (Array.isArray(value) || (value && typeof value === "object")) {
				const nested = extractStringValue(value);
				if (typeof nested === "string") return nested;
			}
		}
	}

	return null;
}

function extractParamValue(input, key) {
	// Extrae de manera tolerante un parámetro (string) desde un objeto.
	// Casos soportados:
	// - { lore: "add", text: "hola" }
	// - { lore: { value: "add" }, text: { value: "hola" } }
	// - { name: "lore", value: "add" }
	if (!input || typeof input !== "object") return null;
	try {
		if (typeof input[key] === "string") return input[key];
		if (input[key] != null) {
			const nested = extractStringValue(input[key]);
			if (typeof nested === "string") return nested;
		}
	} catch (e) {
		void e;
	}
	return null;
}

function extractFirstStringFromKeys(input, keys) {
	for (const key of keys) {
		const v = extractParamValue(input, key);
		if (typeof v === "string" && v.length > 0) return v;
	}
	return null;
}

function debugLogArgsOnce(kind, value) {
	// Logs de diagnóstico (solo consola). Útil cuando el motor entrega args con shape inesperado.
	// No spameamos: solo lo llamamos en escenarios de error (payload vacío).
	if (!DEBUG_SETLORE) return;
	try {
		console.warn(`[setlore] ${kind}: ${JSON.stringify(value)}`);
	} catch (e) {
		try {
			console.warn(`[setlore] ${kind}: (no-json) ${String(value)}`);
		} catch (e2) {
			void e2;
		}
		void e;
	}
}

function stripOuterQuotes(text) {
	if (typeof text !== "string") return "";
	const t = text.trim();
	if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
	return t;
}

function argsToCombinedText(input) {
	// Convierte los argumentos del command registry a un solo string.
	// Necesario porque `CustomCommandParamType.String` separa por tokens, y queremos soportar:
	// - /setlore "texto completo"
	// - /setlore add "hola" (dos parámetros: lore="add", text="hola")
	// - /setlore begin / apply / cancel
	if (typeof input === "string") return input;

	// Caso: array (algunas builds entregan lista posicional)
	if (Array.isArray(input)) {
		const parts = [];
		for (const item of input) {
			// Algunos motores entregan un solo objeto con { lore, text } dentro del array.
			if (item && typeof item === "object" && !Array.isArray(item)) {
				const lore = extractFirstStringFromKeys(item, ["lore", "mode", "cmd", "command"]);
				// En algunas builds el 2do param puede venir como `text`, `rawText`, `rawtext` o incluso `value`.
				const text = extractFirstStringFromKeys(item, ["text", "rawText", "rawtext", "message"]);
				const value = typeof item.value === "string" ? item.value : null;

				// Si existen lore y text, los concatenamos en orden.
				if (lore && text) {
					parts.push(lore);
					parts.push(text);
					continue;
				}

				// Caso especial: algunos motores colapsan todo en { lore: "add", rawText: "..." }
				// o { lore: "add", value: "..." }. Si vemos un lore "verbo" y un value distinto, combinamos.
				if (lore && value && value.length > 0 && value !== lore) {
					parts.push(lore);
					parts.push(value);
					continue;
				}

				if (value && value.length > 0) {
					parts.push(value);
					continue;
				}
			}

			const s = extractStringValue(item);
			if (typeof s === "string" && s.length > 0) parts.push(s);
		}
		return parts.join(" ");
	}

	// Caso: objeto (p.ej. { lore: "add", text: "hola" })
	if (input && typeof input === "object") {
		const lore = extractFirstStringFromKeys(input, ["lore", "mode", "cmd", "command"]);
		const text = extractFirstStringFromKeys(input, ["text", "rawText", "rawtext", "message"]);
		const value = extractFirstStringFromKeys(input, ["value"]);
		if (typeof lore === "string" && lore.length > 0 && typeof text === "string" && text.length > 0) {
			return `${lore} ${text}`;
		}
		if (typeof lore === "string" && lore.length > 0 && typeof value === "string" && value.length > 0 && value !== lore) {
			return `${lore} ${value}`;
		}
		if (typeof lore === "string" && lore.length > 0) return lore;
		if (typeof text === "string" && text.length > 0) return text;

		const extracted = extractStringValue(input);
		return typeof extracted === "string" ? extracted : "";
	}

	return "";
}


function parseLoreText(rawInput) {
	const asString = extractStringValue(rawInput);
	if (typeof asString !== "string") return null;

	let trimmed = asString.trim();
	if (trimmed.length === 0) return null;

	// Si el motor entrega comillas incluidas, las removemos.
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		trimmed = trimmed.slice(1, -1);
	}

	// Permite borrar lore incluso si venía entrecomillado.
	if (isClearLoreToken(trimmed)) return [];

	// Saltos de línea: usar "\n" (backslash + n).
	// Nota: dependiendo de la versión/parseo del comando, "\n" puede llegar como:
	// - caracteres "\\" + "n"
	// - o como un salto real (\n) / carriage return (\r)
	// Por eso normalizamos TODO a "\n" antes de separar líneas.
	const withEscapedNewlines = trimmed.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
	const normalizedNewlines = withEscapedNewlines.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const rawLines = normalizedNewlines.split("\n");
	if (rawLines.length === 0 || rawLines.length > MAX_LORE_LINES) return { error: "tooManyLines" };

	// Estado heredado (color + formatos) entre líneas.
	let currentState = { color: "f", modifiers: new Set() };
	let totalVisible = 0;
	const formatBudget = { total: 0, line: 0 };

	const result = [];
	for (let index = 0; index < rawLines.length; index++) {
		const line = rawLines[index] != null ? rawLines[index] : "";
		formatBudget.line = 0;

		// Sanitizamos códigos de formato dentro de la línea para evitar input malicioso o excesivo.
		const sanitizedLine = sanitizeFormattingCodes(line, formatBudget);
		if (sanitizedLine == null) return { error: "tooManyFormatCodes" };

		// Construimos la línea final con reset + herencia.
		// Si el usuario empieza la línea con §r, asumimos que quiere cortar herencia.
		const startsWithReset = sanitizedLine.length >= 2 && sanitizedLine[0] === "§" && isResetCodeChar(sanitizedLine[1]);
		const prefix = startsWithReset ? "" : buildLinePrefix(currentState);

		// Contabilizamos también los códigos que nosotros agregamos en el prefijo,
		// para que los caps anti-crash cubran el output final real.
		const prefixCodes = prefix ? countFormatCodes(prefix) : 0;
		formatBudget.total += prefixCodes;
		formatBudget.line += prefixCodes;
		if (formatBudget.line > MAX_FORMAT_CODES_PER_LINE || formatBudget.total > MAX_FORMAT_CODES_TOTAL) {
			return { error: "tooManyFormatCodes" };
		}

		// Si la línea está vacía, emitimos "" (línea en blanco) sin prefijo.
		// Mantiene la herencia para la siguiente línea, sin inflar el lore con códigos innecesarios.
		if (sanitizedLine.length === 0) {
			result.push("");
			continue;
		}

		const effectiveLine = `${prefix}${sanitizedLine}`;

		// Validación menos invasiva: ignora códigos §<código>.
		const visibleLen = countVisibleChars(effectiveLine);
		totalVisible += visibleLen;
		if (visibleLen > MAX_LORE_VISIBLE_LINE_LENGTH) return { error: "lineTooLong" };
		if (effectiveLine.length > MAX_LORE_TOTAL_LINE_LENGTH) return { error: "lineTooLong" };
		if (totalVisible > MAX_LORE_TOTAL_VISIBLE_CHARS) return { error: "lineTooLong" };

		result.push(effectiveLine);
		currentState = stateAfterText(effectiveLine, currentState);
	}

	return result;
}

/**
 * Handler del comando setlore.
 * Sintaxis: /setlore <string>
 *          /setlore clear
 *          /setlore borrar
 * - El string puede incluir \n para saltos de línea.
 * - Aplica/reescribe el lore en el item de la mano principal.
 *
 * Comportamiento importante:
 * - Cada línea se prefija internamente con §r para evitar itálica por defecto.
 * - Color y formatos (k,l,m,n,o) se heredan entre líneas, similar a la herencia de color.
 * - Si una línea empieza con §r, corta la herencia (queda en estado default desde esa línea).
 * - "clear"/"borrar" elimina el lore (setLore([])).
 *
 * @param {import("@minecraft/server").CustomCommandOrigin} origin
 * @param {string} loreText
 */
export function handleSetLoreCommand(origin, ...loreArgs) {
	const player = origin.sourceEntity;
	if (!player) return;

	// Nota importante (por el reporte de desconexión):
	// Si el comando es extremadamente largo, el cliente puede desconectarse ANTES de que el servidor ejecute este handler.
	// Para esos casos existe el modo por partes: begin/add/apply.
	// IMPORTANTE:
	// En varias builds, el callback de Custom Commands entrega los parámetros como argumentos
	// separados (origin, param0, param1, ...) y NO como un array.
	// Por eso recibimos `...loreArgs` y los combinamos aquí.
	const rawCombined = argsToCombinedText(loreArgs);
	const normalizedCombined = stripOuterQuotes(rawCombined);
	if (typeof normalizedCombined !== "string" || normalizedCombined.trim().length === 0) {
		debugLogArgsOnce("empty-args", loreArgs);
		player.sendMessage(HELP_MESSAGE);
		return;
	}
	const mode = parseSetLoreMode(normalizedCombined);

	// Modo edición (anti-disconnect por comandos largos)
	const nowMs = Date.now();
	pruneDrafts(nowMs);
	const draftKey = getPlayerDraftKey(player);

	if (mode.mode === "help") {
		player.sendMessage(HELP_MESSAGE);
		return;
	}

	if (mode.mode === "status") {
		const entry = loreDrafts.get(draftKey);
		const parts = entry && Array.isArray(entry.parts) ? entry.parts : [];
		const joined = parts.join("\n");
		player.sendMessage(
			[
				"§f§lsetlore§r§f — estado",
				`§7En edición: §f${parts.length}§7 bloque(s)`,
				`§7Tamaño: §f${joined.length}§7 char(s)`,
				"§7Usa §a/atomic:setlore \"apply\"§7 para aplicar o §a/atomic:setlore \"cancel\"§7 para cancelar.",
			].join("\n")
		);
		return;
	}

	if (mode.mode === "begin") {
		loreDrafts.set(draftKey, { parts: [], updatedAt: nowMs });
		player.sendMessage(DRAFT_STARTED_MESSAGE);
		return;
	}

	if (mode.mode === "cancel") {
		loreDrafts.delete(draftKey);
		player.sendMessage(DRAFT_CLEARED_MESSAGE);
		return;
	}

	if (mode.mode === "add") {
		const payload = mode.payload != null ? String(mode.payload) : "";
		if (payload.trim().length === 0) {
			debugLogArgsOnce("add-missing-payload", { rawCombined, loreArgs });
			player.sendMessage(
				[
					"§cUso: §f/atomic:setlore \"add <texto>\"",
					"§7Ejemplo: §a/atomic:setlore \"add hola mundo\"",
					"§7Línea en blanco: §a/atomic:setlore \"add \\n\"",
				].join("\n")
			);
			return;
		}

		const hadEntry = loreDrafts.has(draftKey);
		const entry = loreDrafts.get(draftKey) ?? { parts: [], updatedAt: nowMs };
		const currentText = entry.parts.join("\n");
		const nextText = currentText.length > 0 ? `${currentText}\n${payload}` : payload;
		if (nextText.length > MAX_DRAFT_CHARS) {
			player.sendMessage(LINE_TOO_LONG_MESSAGE);
			return;
		}
		entry.parts = [...entry.parts, payload];
		entry.updatedAt = nowMs;
		loreDrafts.set(draftKey, entry);
		if (!hadEntry) player.sendMessage(DRAFT_AUTO_STARTED_MESSAGE);
		player.sendMessage("§fAgregado a la edición. Usa §a/atomic:setlore \"apply\"§f para aplicar.");
		return;
	}

	let effectiveRawText;
	if (mode.mode === "clear") {
		// Reutilizamos el parser de lore: "clear" se convierte en [] dentro de parseLoreText.
		effectiveRawText = "clear";
	} else if (mode.mode === "apply") {
		const entry = loreDrafts.get(draftKey);
		if (!entry || !Array.isArray(entry.parts) || entry.parts.length === 0) {
			player.sendMessage(DRAFT_EMPTY_MESSAGE);
			return;
		}
		effectiveRawText = entry.parts.join("\n");
		// No borramos automáticamente para permitir re-aplicar; el usuario puede /setlore cancel.
	} else {
		effectiveRawText = mode.payload;
	}

	// Permite que el jugador escriba símbolos Unicode (ej: ☠ ★ ✿) y los convierte a glyphs (PUA)
	// antes de validar longitudes y formateo.
	const transformedLoreText = applyCustomEmojisToText(effectiveRawText ?? "");
	const parsed = parseLoreText(transformedLoreText);
	if (parsed == null) {
		player.sendMessage(INVALID_STRING_MESSAGE);
		return;
	}
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.error) {
		if (parsed.error === "tooManyLines") player.sendMessage(TOO_MANY_LINES_MESSAGE);
		else if (parsed.error === "tooManyFormatCodes") player.sendMessage(TOO_MANY_FORMAT_CODES_MESSAGE);
		else if (parsed.error === "lineTooLong") player.sendMessage(LINE_TOO_LONG_MESSAGE);
		else player.sendMessage(INVALID_STRING_MESSAGE);
		return;
	}
	const loreLines = parsed;

	// IMPORTANTE:
	// En algunas builds, el callback de custom commands puede ejecutarse en un contexto
	// donde mutar inventario/lore arroja error (read-only). Programamos la mutación al siguiente tick.
	system.run(() => {
		// Usar el id explícito evita problemas de compatibilidad entre versiones.
		const equippable = player.getComponent("minecraft:equippable");
		if (!equippable) {
			player.sendMessage(INVALID_STRING_MESSAGE);
			return;
		}

		let currentItem;
		try {
			currentItem = equippable.getEquipment(EquipmentSlot.Mainhand);
		} catch (e) {
			player.sendMessage(INVALID_STRING_MESSAGE);
			return;
		}

		if (!currentItem) {
			player.sendMessage(NO_ITEM_MESSAGE);
			return;
		}

		let hadLoreBefore = false;
		try {
			const lore = currentItem && typeof currentItem.getLore === "function" ? currentItem.getLore() : null;
			const len = lore && lore.length != null ? lore.length : 0;
			hadLoreBefore = len > 0;
		} catch (e) {
			void e;
			// DEBUG: si falla getLore, igual intentamos setearlo.
			hadLoreBefore = false;
		}

		let updatedItem;
		try {
			updatedItem = currentItem.clone();
		} catch (e) {
			player.sendMessage(INVALID_STRING_MESSAGE);
			return;
		}

		try {
			updatedItem.setLore(loreLines);
		} catch (e) {
			player.sendMessage(INVALID_STRING_MESSAGE);
			return;
		}

		try {
			const didEquip = equippable.setEquipment(EquipmentSlot.Mainhand, updatedItem);
			if (!didEquip) {
				player.sendMessage(INVALID_STRING_MESSAGE);
				return;
			}
		} catch (e) {
			player.sendMessage(INVALID_STRING_MESSAGE);
			return;
		}

		// Mensaje de salida:
		// - Si el usuario usó "clear", `loreLines` es [] y removemos el lore.
		// - Caso contrario, distinguimos entre aplicar por primera vez o sobreescribir.
		if (Array.isArray(loreLines) && loreLines.length === 0) {
			player.sendMessage(SUCCESS_CLEARED_MESSAGE);
			return;
		}
		if (mode.mode === "apply") {
			player.sendMessage(DRAFT_APPLIED_MESSAGE);
			return;
		}
		player.sendMessage(hadLoreBefore ? SUCCESS_OVERWROTE_MESSAGE : SUCCESS_APPLIED_MESSAGE);
	});
}
