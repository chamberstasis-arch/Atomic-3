// Validación estática del add-on (sin dependencias). Uso: `npm run check`
// - Sintaxis de todos los .js del BP (node --check)
// - JSON válido en BP y RP
// - Imports relativos que resuelven a un archivo existente
// - Manifests coherentes (UUID únicos, dependencia BP<->RP, entry de script existente)
// - Guardas de regresión contra APIs retiradas en Scripting V2
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BP = join(ROOT, "Atomic BP");
const RP = join(ROOT, "RP");
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(ROOT, p);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const bpFiles = walk(BP);
const rpFiles = walk(RP);
const jsFiles = bpFiles.filter((f) => f.endsWith(".js"));

// 1) Sintaxis JS
for (const f of jsFiles) {
	try {
		execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
	} catch (e) {
		fail(`SINTAXIS ${rel(f)}: ${String(e.stderr || e.message).split("\n")[0]}`);
	}
}

// 2) JSON válido
for (const f of [...bpFiles, ...rpFiles].filter((x) => x.endsWith(".json"))) {
	try {
		JSON.parse(readFileSync(f, "utf8"));
	} catch (e) {
		fail(`JSON ${rel(f)}: ${e.message}`);
	}
}

// 3) Imports relativos + guardas de regresión
const importRe = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']/g;
const banned = [
	[/\.runCommandAsync\b/, "runCommandAsync fue eliminado en Scripting V2: usar runCommand (síncrono) o la API nativa"],
	[/\b(?:before|after)Events\.worldInitialize\b/, "worldInitialize fue eliminado: usar system.beforeEvents.startup / world.afterEvents.worldLoad"],
	[/\bGameMode\.(?:survival|creative|spectator|adventure)\b/, "En V2 los miembros de GameMode son PascalCase (GameMode.Survival)"],
];
for (const f of jsFiles) {
	const src = readFileSync(f, "utf8");
	for (const m of src.matchAll(importRe)) {
		const target = resolve(dirname(f), m[1]);
		if (!existsSync(target)) fail(`IMPORT ${rel(f)} -> ${m[1]} no existe`);
	}
	const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	for (const [re, why] of banned) if (re.test(noComments)) fail(`API RETIRADA ${rel(f)}: ${why}`);
}

// 4) Manifests
try {
	const bp = JSON.parse(readFileSync(join(BP, "manifest.json"), "utf8"));
	const rp = JSON.parse(readFileSync(join(RP, "manifest.json"), "utf8"));
	const uuids = [bp.header.uuid, rp.header.uuid, ...bp.modules.map((m) => m.uuid), ...rp.modules.map((m) => m.uuid)];
	if (new Set(uuids).size !== uuids.length) fail("MANIFEST: UUID duplicados entre BP y RP");
	if (!(bp.dependencies || []).some((d) => d.uuid === rp.header.uuid)) fail("MANIFEST: el BP no depende del UUID del RP");
	if (!(rp.dependencies || []).some((d) => d.uuid === bp.header.uuid)) fail("MANIFEST: el RP no depende del UUID del BP");
	const script = bp.modules.find((m) => m.type === "script");
	if (script && !existsSync(join(BP, script.entry))) fail(`MANIFEST: entry ${script.entry} no existe`);
} catch (e) {
	fail(`MANIFEST: ${e.message}`);
}

if (errors.length) {
	console.error(errors.map((e) => `✗ ${e}`).join("\n"));
	console.error(`\n${errors.length} problema(s) encontrados.`);
	process.exit(1);
}
console.log(`✓ OK — ${jsFiles.length} scripts, ${bpFiles.length + rpFiles.length} archivos revisados.`);
