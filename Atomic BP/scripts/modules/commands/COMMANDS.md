# Orden de comandos (Custom Commands)

Este proyecto centraliza **todo el registro** de comandos en un solo archivo y deja la **lógica** de cada comando en su script correspondiente.

## Regla principal

- **Todos los `event.customCommandRegistry.registerCommand(...)` viven únicamente en** `scripts/modules/commands/index.js`.
- Los archivos dentro de `scripts/modules/commands/handlers/` **NO registran comandos**. Solo exportan la funcionalidad (handlers y helpers).

Motivo: evitar duplicados, facilitar habilitar/deshabilitar comandos, y mantener una fuente única de verdad para nombres/descripciones.

## Estructura

- `scripts/modules/commands/index.js`
  - Contiene `commandConfig` (config dinámica) y `initCommands()`.
  - Suscribe `system.beforeEvents.startup` **una sola vez** (idempotente).
  - Registra *todos* los comandos en un bloque centralizado.

- `scripts/modules/commands/handlers/<comando>.js`
  - Contiene la lógica del comando.
  - Exporta un handler del estilo `handle<Comando>Command(origin)`.
  - Puede mantener estado interno (cooldowns, caches, etc.) si aplica.

- `scripts/main.js`
  - Debe llamar **solo** a `initCommands()` para inicializar los comandos.

## Config dinámica obligatoria (5 campos)

Cada comando debe tener estos 5 aspectos **dinámicos** en `commandConfig`:

- `namespace`: string (ej: `"atomic"`)
- `enabled`: boolean (`true/false`)
- `name`: string (ej: `"show"`)
- `description`: string
- `permission`: string

Valores recomendados para `permission`:

- `"Any"`
- `"GameDirectors"` (operadores, incluye command blocks)
- `"Admin"` (operadores, NO incluye command blocks)
- `"Host"`
- `"Owner"`

Ejemplo:

```js
export const commandConfig = {
  show: {
    namespace: "atomic",
    enabled: true,
    name: "show",
    description: "Muestra el item sostenido en la mano primaria.",
    permission: "Any",
  },
};
```

## Registro centralizado (patrón)
 
En `initCommands()`:

- Validar `enabled`.
- Construir el nombre completo como `${namespace}:${name}`.
- Llamar a `registerCommand` y delegar la lógica al handler importado.

Ejemplo:

```js
import { handleShowCommand } from "./handlers/show.js";


if (commandConfig.show.enabled) {
  const fullName = `${commandConfig.show.namespace}:${commandConfig.show.name}`;
  event.customCommandRegistry.registerCommand(
    {
      name: fullName,
      description: commandConfig.show.description,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin) => handleShowCommand(origin)
  );
}
```

## Handlers (contrato)

- Firma recomendada:

```js
export function handleShowCommand(origin) {
  // origin.sourceEntity suele ser el jugador
}
```

- El handler **no debe** asumir que siempre hay jugador (comando podría venir de consola/command block). Debe validar:
  - `const player = origin.sourceEntity; if (!player) return;`

## Buenas prácticas

- **Idempotencia**: `initCommands()` debe evitar doble suscripción/registro.
- **Sin duplicados**: no registrar comandos en archivos individuales.
- **Nombres claros**: `commandConfig`, `initCommands`, `handleXCommand`, `toNamespacedCommandName`.
- **Fallos seguros**: si `namespace` o `name` están vacíos, no registrar.
- **Compatibilidad**: los comandos **deben** registrarse con namespace (`namespace:name`).
  - El cliente puede permitir ejecutar `/name` (forma corta), pero el registro siempre es namespaced.

## Cómo agregar un nuevo comando

1. Crear `scripts/modules/commands/handlers/<nuevo>.js` y exportar `handle<Nuevo>Command(origin)`.
2. Agregar config en `commandConfig` con los 5 campos.
3. Importar el handler en `scripts/modules/commands/index.js`.
4. Registrar el comando dentro de `initCommands()`.

Con esto, el proyecto mantiene orden, evita registros duplicados y facilita administrar comandos.

---

## Comando `setlore` (notas de implementación)

La lógica vive en:
- `scripts/modules/commands/handlers/setLore.js`

### Sintaxis

- `/setlore <texto>`
- `/setlore clear` (alias: `borrar`, `remove`, `delete`, `none`, `-`) para eliminar el lore

Notas sobre argumentos:


- `setlore` usa **un solo argumento String** (es lo más estable para Bedrock/Realms).
- Los subcomandos se escriben dentro del mismo string:
  - `/atomic:setlore "begin"`
  - `/atomic:setlore "add <texto>"`
  - `/atomic:setlore "apply"`
  - `/atomic:setlore "cancel"`
  - `/atomic:setlore "clear"`

Si el texto contiene espacios o `\\n`, usa comillas.

Modo por partes (recomendado para lores muy largos / evitar desconexiones):

- `/atomic:setlore "begin"` (inicia una edición temporal en memoria)
- `/atomic:setlore "add <texto>"` (agrega un bloque; puedes usar `\n` dentro)
- `/atomic:setlore "apply"` (aplica el lore acumulado)
- `/atomic:setlore "cancel"` (cancela/limpia la edición)

Nota: estos subcomandos se procesan desde un único parámetro String; por eso se recomienda escribirlos siempre dentro de comillas cuando haya espacios.

Comandos útiles:

- `/atomic:setlore "help"` o `/atomic:setlore "?"` (muestra ayuda)
- `/atomic:setlore "status"` (muestra estado del buffer de edición)

Nota: `add` inicia automáticamente el modo edición si no se hizo `begin`.

### Saltos de línea

- Usa `\n` para separar líneas.

Ejemplo:

`/setlore Primera línea\nSegunda línea`

### Formato, color y herencia

- Cada línea se **resetea internamente con `§r`** para evitar la itálica por defecto del lore.
- El **color y formatos** (`k,l,m,n,o`) se **heredan entre líneas**.
- Si una línea empieza con `§r`, se interpreta como “cortar herencia” desde esa línea.

### Límites defensivos (anti-crash)

- Máximo de líneas: 30.
- Límite por línea se valida por caracteres **visibles** (no cuenta secuencias tipo `§9`).
- También existe un límite duro de longitud total por línea y un límite de densidad de códigos `§`.

Motivo: algunos clientes/builds pueden crashear con lore excesivo o con spam de `§r`.
