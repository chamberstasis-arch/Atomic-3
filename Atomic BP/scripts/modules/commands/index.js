import {
	system,
	CommandPermissionLevel,
	CustomCommandParamType,
	PlayerPermissionLevel,
} from "@minecraft/server";
import { handleShowCommand } from "./handlers/show.js";
import { handleSetLoreCommand } from "./handlers/setLore.js";
import { handleGetLoreCommand } from "./handlers/getLore.js";
import { handleRenameCommand } from "./handlers/rename.js";
import { sendNoPermissionMessage } from "./permissions.js";
let didSubscribeStartup = false;
let didRegisterCommands = false;

/**
 * Configuración de comandos.
 *
 * Campos dinámicos por comando:
 * - namespace
 * - enabled
 * - name
 * - description
 * - permission
 *
 * Posibles valores para `permission` (string):
 * - "Any"
 * - "Admin"           (operadores, NO incluye command blocks)
 * - "GameDirectors"   (operadores, incluye command blocks)
 * - "Host"
 * - "Owner"
 */
export const commandConfig = {
	show: {
		namespace: "atomic",
		enabled: true,
		name: "show",
		description: "Muestra el item sostenido en la mano primaria.",
		permission: "Any",
	},
	setlore: {
		namespace: "atomic",
		enabled: true,
		name: "setlore",
		description: "Agrega o sobreescriba el Lore del objeto en la mano principal",
		permission: "Admin",
	},
	getlore: {
		namespace: "atomic",
		enabled: true,
		name: "getlore",
		description: "Emite el lore del item seleccionado en consola (Ctrl + H)",
		permission: "Admin",
	},
	rename: {
		namespace: "atomic",
		enabled: true,
		name: "rename",
		description: "Agrega o sobreescriba el nombre del objeto en la mano principal",
		permission: "Admin",
	},
};

function normalizePermission(permission) {
	const value = (permission != null ? permission : "Any").toString().trim();
	if (!value) return "Any";
	const normalized = value[0].toUpperCase() + value.slice(1);
	const allowed = new Set(["Any", "Gamedirectors", "Admin", "Host", "Owner"]);
	return allowed.has(normalized) ? normalized : "Any";
}

function isAllowedByPermission(player, permission) {
	const required = normalizePermission(permission);
	if (required === "Any") return true;

	// Para "Admin" y "GameDirectors" interpretamos como: solo operadores o superior.
	// (Esto cubre host/dueño local también, porque suelen ser op.)
	if (required === "Admin" || required === "Gamedirectors") {
		try {
			return Number(player && player.playerPermissionLevel != null ? player.playerPermissionLevel : 0) >= PlayerPermissionLevel.Operator;
		} catch (e) {
			void e;
			return false;
		}
	}

	// Host/Owner: preferimos la señal del motor sobre permisos de comando.
	// Nota: en algunos entornos esta propiedad puede no reflejar exactamente host/owner.
	try {
		const lvl = Number(player && player.commandPermissionLevel != null ? player.commandPermissionLevel : 0);
		const requiredLevel = required === "Host" ? CommandPermissionLevel.Host : CommandPermissionLevel.Owner;
		return lvl >= requiredLevel;
	} catch (e) {
		void e;
		return false;
	}
}

function makePermissionWrapper(commandKey, handler) {
	return (origin, args) => {
		const player = origin.sourceEntity;
		if (!player) return;

		const cmdCfg = commandConfig && commandConfig[commandKey] ? commandConfig[commandKey] : null;
		const permission = cmdCfg && cmdCfg.permission != null ? cmdCfg.permission : undefined;
		if (!isAllowedByPermission(player, permission)) {
			sendNoPermissionMessage(player);
			return;
		}

		return handler(origin, args);
	};
}

function toNamespacedCommandName({ namespace, name }) {
	const safeNamespace = String(namespace != null ? namespace : "").trim();
	const safeName = String(name != null ? name : "").trim();
	if (!safeNamespace || !safeName) return null;
	return `${safeNamespace}:${safeName}`;
}

/**
 * Registra todos los comandos en un solo lugar.
 */
export function initCommands() {
	if (didSubscribeStartup) return;
	didSubscribeStartup = true;

	system.beforeEvents.startup.subscribe((event) => {
		if (didRegisterCommands) return;
		didRegisterCommands = true;

		// --- Registro de comandos ---
		// 1) show
		if (commandConfig.show.enabled) {
			const fullName = toNamespacedCommandName(commandConfig.show);
			if (fullName) {
				event.customCommandRegistry.registerCommand(
					{
						name: fullName,
						description: commandConfig.show.description,
							// La validación se aplica en el wrapper para permitir mensaje personalizado.
							permissionLevel: CommandPermissionLevel.Any,
					},
						makePermissionWrapper("show", (origin) => handleShowCommand(origin))
				);
			}
		}

			// 2) setlore
			if (commandConfig.setlore.enabled) {
				const fullName = toNamespacedCommandName(commandConfig.setlore);
				if (fullName) {
					event.customCommandRegistry.registerCommand(
						{
							name: fullName,
							description: commandConfig.setlore.description,
							permissionLevel: CommandPermissionLevel.Any,
							// Un solo argumento String (estable en Bedrock/Realms).
							// Los subcomandos se pasan dentro del mismo string:
							// - /setlore "begin"
							// - /setlore "add <texto>"
							// - /setlore "apply"
							// - /setlore "clear"
							mandatoryParameters: [
								{
									name: "lore",
									type: CustomCommandParamType.String,
								},
							],
						},
						makePermissionWrapper("setlore", (origin, ...args) => handleSetLoreCommand(origin, ...args))
					);
				}
			}

			// 3) getlore
			if (commandConfig.getlore.enabled) {
				const fullName = toNamespacedCommandName(commandConfig.getlore);
				if (fullName) {
					event.customCommandRegistry.registerCommand(
						{
							name: fullName,
							description: commandConfig.getlore.description,
							permissionLevel: CommandPermissionLevel.Any,
						},
						makePermissionWrapper("getlore", (origin) => handleGetLoreCommand(origin))
					);
				}
			}

			// 4) rename
			if (commandConfig.rename.enabled) {
				const fullName = toNamespacedCommandName(commandConfig.rename);
				if (fullName) {
					event.customCommandRegistry.registerCommand(
						{
							name: fullName,
							description: commandConfig.rename.description,
							permissionLevel: CommandPermissionLevel.Any,
							mandatoryParameters: [
								{
									name: "rename",
									type: CustomCommandParamType.String,
								},
							],
						},
						makePermissionWrapper("rename", (origin, args) => handleRenameCommand(origin, args))
					);
				}
			}
	});
}
