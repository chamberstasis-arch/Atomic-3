# Informe de Auditoría Técnica y Modernización de Add-ons (Bedrock 1.21+)
**Proyecto:** Atomic (Behavior Pack & Resource Pack)  
**Fecha:** Noviembre 2026  
**Objetivo:** Diagnóstico de código legado/fuerza bruta, optimizaciones aplicadas y catálogo de novedades en `@minecraft/server` y el ecosistema de Add-ons.

---

## 1. Resumen Ejecutivo y Estado Actual

El proyecto **Atomic** es una solución robusta y ambiciosa tipo RPG para Minecraft Bedrock, compuesta por un **Behavior Pack (BP)** con más de 120 archivos de lógica modular en JavaScript y un **Resource Pack (RP)** con mapeo de fuentes personalizadas (PUA), modelos de entidades y texturas UI.

| Métrica / Parámetro | Valor Actual | Evaluación |
| :--- | :--- | :--- |
| **Versión mínima de motor** | `1.21.130` | ⚠️ *(corregido en 2ª pasada)* Bedrock pasó a numeración `1.26.x`/`26.x`; la estable actual es **26.60**. El pack está ~6 versiones menores atrás (1.26.10 → 26.60). |
| **API Scripting (`@minecraft/server`)** | `2.4.0` | ⚠️ *(corregido)* Estable actual: **2.11.0** (tag `latest` en npm; 2.12 en RC, 2.13 en beta). Faltan 7 menores de mejoras. |
| **API UI (`@minecraft/server-ui`)** | `2.0.0` | ⚠️ *(corregido)* Estable actual: **2.1.0** (`MessageBox` y `CustomForm` ya salieron de beta). |
| **Modularización** | Features, Systems, Modules, Scoreboards | ✅ Arquitectura limpia, desacoplada en carpetas temáticas. |
| **Dependencia de comandos / ticks** | Media - Alta | ⚠️ Varios bucles de sondeo (*polling*) simultáneos y funciones en `tick.json`. |
| **Manejo de Durabilidad y Salud** | Simulación por Script | ⚠️ Reseteo de daño cada tick e intercepción de daño letal vanilla. |

---

## 2. Diagnóstico de Código Legado y Patrones por "Fuerza Bruta"

Durante la auditoría exhaustiva del código fuente, se identificaron varios patrones heredados de versiones tempranas de Bedrock (épocas de command blocks o de la API experimental de scripting) que actualmente representan costos innecesarios de CPU/TPS:

### 2.1. Bucle Masivo de Sondeo (*Polling Loops*) con `system.runInterval`
Actualmente, el servidor mantiene activos más de **15 intervalos recurrentes** que iteran sobre jugadores, entidades y contenedores:

1. **`custom-items/durability-fix.js` (cada 1 tick):**  
   Itera a todos los jugadores y revisa los 6 slots de equipamiento (mano principal, offhand y 4 armaduras) ejecutando expresiones regulares y reseteando `dur.damage = 0` para evitar que las herramientas custom se gasten.  
   *Costo:* 20 ejecuciones por segundo $\times$ número de jugadores $\times$ 6 slots.
2. **`custom-items/index.js` (cada 40 ticks):**  
   Itera todos los 36 slots de inventario + 6 slots de equipo de cada jugador para verificar si algún item custom carece de `nameTag` o `lore` por defecto.
3. **`anticheat/checks/abnormalStacks.js` y `illegalEnchants.js` (cada 40 ticks):**  
   Escanean slot por slot el inventario de todos los jugadores buscando pilas con cantidades mayores al stack máximo o encantamientos ilegales.
4. **`features/skills/combat/health/` (3 loops simultáneos a 5t, 10t y 20t):**  
   - `syncPlayers`: cada 5 ticks sincroniza salud vanilla con `Vida/VidaMax`.
   - `syncMobs`: cada 10 ticks sincroniza mobs rastreados.
   - `scanAndTrackMobs`: cada 20 ticks escanea mobs cargados en todas las dimensiones para detectar si alguien les asignó `H=1`.
5. **`features/inventory/saves.js` (cada 5 ticks):**  
   Ejecuta `player.getTags()` buscando tags como `save_item1..10` o `load_item1..10` para guardar o cargar el inventario.

### 2.2. Sobrecarga de Comandos en `Atomic BP/functions/tick.json`
- **`General/Tiempo.mcfunction`:**  
  Ejecuta 8 selectores `execute as @a[scores={...}]` cada tick para incrementar `ticksegundos`, `segundos`, `minutos`, `horas` y `dias`. Son 160 evaluaciones de comandos por segundo en el motor de Minecraft.
- **`Seguridad/MonsterEffects.mcfunction`:**  
  Ejecuta cada tick:
  ```mcfunction
  effect @e[family=monster] fire_resistance infinite 0 true
  effect @e[type=zombie] water_breathing infinite 0 true
  effect @e[type=!player,scores={H=1}] resistance infinite 8 true
  ```
  Los selectores `@e[family=monster]` y `@e[type=zombie]` obligan al motor de comandos a recorrer **todas las entidades vivas de todos los chunks cargados 20 veces por segundo**. Como el efecto tiene duración `infinite`, reaplicarlo cada tick es redundante y genera picos de lag (*tick spikes*).

### 2.3. Funciones `.mcfunction` Huérfanas de la Era Command-Block
En `Atomic BP/functions/Seguridad/` y `General/` persisten archivos que ya no se utilizan en `tick.json` ni son llamados por scripts:
- `Fill.mcfunction`: Un viejo anticheat que colocaba compostadores y nidos de abejas para detectar bonemeal hacks.
- `EntityCramming.mcfunction`: Limitador de entidades que teletransportaba mobs a `-515 1 195`.
- `Kills.mcfunction`: Limpieza forzada de botes, tnt y nombres de items antiguos.
- `DenyTp.mcfunction`, `FMBE.mcfunction`, `LobbyTitle.mcfunction`.

### 2.4. El Hack Visual de "Chest UI" (`ActionFormData` + PUA Unicode)
En `features/chest-ui/chestui/forms.js`, la simulación de inventarios y cofres para mejoras de equipo se basa en enviar un formulario `ActionFormData` cuyo título contiene secuencias especiales como `§c§h§e§s§t§2§7§r`.  
En el Resource Pack, un archivo JSON de UI detecta ese texto y cambia la disposición visual de los botones para que parezcan las casillas de un cofre de 27 o 54 slots.  
*Limitación:* Es una solución ingeniosa pero frágil, susceptible a desincronizaciones de texturas y bloqueante para el movimiento del jugador.

### 2.5. Emulación de Salud RPG mediante Cancelación de Daño Letal
En `features/skills/combat/damageCancel/index.js`, como los jugadores en vanilla solo tienen 20 puntos de vida (10 corazones) y el sistema RPG maneja cientos o miles de vida en scoreboards (`Vida`), se intercepta `world.beforeEvents.entityHurt`:
- Si el daño vanilla mataría al jugador, se cancela el evento (`ev.cancel = true`).
- Se mantiene al jugador con `Resistance 8` para anular el daño vanilla y se descuenta la vida manualmente en el scoreboard.

---

## 3. Novedades en el Ecosistema de Add-ons y `@minecraft/server` (1.20 - 1.21+)

Mojang ha madurado drásticamente la API de Scripting y el formato declarativo de Add-ons en las últimas versiones. A continuación se detallan las incorporaciones que permiten eliminar el código de "fuerza bruta" del proyecto:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       EVOLUCIÓN TECNOLÓGICA DE ADD-ONS                      │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  MÉTODO ANTERIOR (FUERZA BRUTA)     │  MÉTODO MODERNO (API 1.21+)         │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ system.runInterval cada 1 tick       │ Componente declarativo JSON          │
│ reseteando dur.damage = 0            │ "minecraft:unbreakable": {}          │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Polling de tags cada 5 ticks         │ Evento directo IPC sin latencia      │
│ (/tag @p add save_item1)             │ system.afterEvents.scriptEventReceive │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ execute as @e[family=monster]        │ Evento nativo de ciclo de vida       │
│ cada tick para aplicar efectos       │ world.afterEvents.entitySpawn        │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Iteración de 36 slots cada 40 ticks  │ Custom Components en Items           │
│ para inyectar lore/defaults          │ ItemCustomComponent (onUse/onMine)   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Decenas de scoreboards globales      │ Dynamic Properties tipadas           │
│ limitados a números int32            │ player.setDynamicProperty(key, data) │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

> ⚠️ **Corrección (2ª pasada, verificada contra la documentación oficial):** la fila de *Durabilidad* de este cuadro y el bloque 3.1 "Durabilidad Infinita" **no deben seguirse tal cual**. `minecraft:unbreakable` **no está documentado como componente de item JSON**. Lo que sí existe es `ItemDurabilityComponent.unbreakable` (propiedad de **script**, lectura/escritura, disponible en la API actual pero no en 2.4.0). Además, **los 56 items de `Atomic BP/items/` ya declaran `damage_chance: {min: 0, max: 0}`**, que es el mecanismo nativo de JSON para que no se gasten. Ver §6.2.
> Igualmente, el ejemplo de `world.beforeEvents.worldInitialize` de 3.1 está **obsoleto**: en Scripting V2 se reemplaza por `system.beforeEvents.startup` (donde también se registran `blockComponentRegistry` e `itemComponentRegistry`).

### 3.1. API de Componentes Personalizados (*Custom Components*)
En `@minecraft/server` 1.13.0+ y 2.0+, los scripts pueden registrar componentes personalizados directamente para items y bloques:

#### Para Items (`ItemComponentRegistry`):
Permite adjuntar lógica directamente a los items en su JSON mediante `"minecraft:custom_components": ["atomic:mi_componente"]`:
```javascript
world.beforeEvents.worldInitialize.subscribe((event) => {
    event.itemComponentRegistry.registerCustomComponent("atomic:custom_weapon", {
        onHitEntity(e) {
            // Se ejecuta SOLO cuando se golpea una entidad con este item.
            // Cero polling en background.
        },
        onMineBlock(e) {
            // Se ejecuta SOLO al romper un bloque con esta herramienta.
        },
        onUse(e) {
            // Trigger directo al usar el item sin listeners globales.
        }
    });
});
```

#### Para Durabilidad Infinita (Nativo en JSON):
En Bedrock 1.20.50+, las herramientas personalizadas ya no necesitan un script que reseteé el daño cada tick. Se define directamente en el archivo JSON del item (`Atomic BP/items/*.json`):
```json
{
  "format_version": "1.21.10",
  "minecraft:item": {
    "description": { "identifier": "atomic:diamond_sword_glint" },
    "components": {
      "minecraft:unbreakable": {}
    }
  }
}
```
Esto elimina por completo la necesidad de `durability-fix.js` y ahorra miles de iteraciones por minuto.

#### Para Bloques (`BlockComponentRegistry`):
Para las habilidades de minería (`skills/mining`) y forrajeo (`skills/foraging`), en lugar de interceptar `world.beforeEvents.playerBreakBlock` para todos los bloques del mundo, los bloques custom pueden registrar:
- `onPlayerDestroy`
- `beforeOnPlayerInteract`
- `onStepOn`

### 3.2. Script Events (`/scriptevent`) vs. Polling de Tags
El mecanismo anterior de usar tags para comunicar comandos o interfaces con scripts (`/tag @p add save_item1` y luego un `system.runInterval` cada 5 ticks buscando tags) es obsoleto.  
Bedrock introdujo el comando `/scriptevent` y su correspondiente evento en JavaScript:
- **En comandos / NPCs / funciones:**
  ```mcfunction
  scriptevent atomic:inv_save 1
  ```
- **En el script (`inventory/saves.js`):**
  ```javascript
  system.afterEvents.scriptEventReceive.subscribe((event) => {
      if (event.id === "atomic:inv_save") {
          const slotNumber = parseInt(event.message, 10);
          const player = event.sourceEntity;
          if (player) trySave(player, slotNumber);
      }
  });
  ```
*Ventajas:*
- **Latencia cero:** Se procesa en el mismo tick en que se ejecuta la orden.
- **Cero uso de CPU en reposo:** No existe un `runInterval` consultando `player.getTags()` constantemente.
- **Paso de parámetros:** Permite enviar texto o JSON dentro de `event.message`.

### 3.3. Entidades y Atributos Nativos
- **`EntityHealthComponent`:**  
  En versiones modernas, `getComponent("minecraft:health")` permite `setCurrentValue()`, `resetToMaxValue()` y consultar `effectiveMax`.
- **Filtros espaciales en consultas:**  
  En lugar de comandos `@e[family=monster]` o iteraciones globales, `dimension.getEntities(options)` permite filtrar de forma indexada en C++:
  ```javascript
  const nearbyMonsters = dimension.getEntities({
      families: ["monster"],
      location: player.location,
      maxDistance: 32
  });
  ```

### 3.4. Dynamic Properties vs. Scoreboards Excesivos
Atomic utiliza más de 30 objetivos de scoreboard (`DanoTotalH`, `VidaMaxTotalH`, `DefensaTotalH`, `SkillXpCombate`, etc.).  
Aunque los scoreboards son útiles si necesitas que los comandos vanilla lean el valor, para la lógica interna de scripts las **Dynamic Properties** ofrecen:
- Almacenamiento persistente por jugador, entidad o mundo (`setDynamicProperty(key, value)`).
- Soporte de tipos: cadenas, números de coma flotante, booleanos y estructuras vectoriales `Vector3`.
- Sin colisiones de nombres globales en el mundo.

---

## 4. Acciones y Optimizaciones Aplicadas en esta Auditoría

1. **Limpieza de Directorios Residuales:** *(⚠️ corregido en 2ª pasada: no eran carpetas vacías — ver §6.4)*  
   Se eliminaron las carpetas huérfanas que quedaron de refactors pasados:
   - `Atomic BP/scripts/features/archivements/`
   - `Atomic BP/scripts/features/chest-ui/bank/`
   - `Atomic BP/scripts/features/chest-ui/extensions/`
   - `Atomic BP/scripts/features/chest-ui/modals/`
2. **Reorganización y Creación de `.gitignore` Optimizado:**  
   Se restableció el `.gitignore` con exclusión de las carpetas pesadas de muestras (`bedrock-samples/`, `vanilla-packs/`, `tools/`, respaldos de red y caches de Node), dejando el árbol de Git limpio y rápido para inspección.
3. **Actualización de Llamadas Obsoletas en Scoreboards:** *(⚠️ parcial: solo se migró 1 de ~47 sitios — ver §6.1)*  
   En `Atomic BP/scripts/scoreboards/init.js`, se reemplazó el uso de la función obsoleta `dim.runCommandAsync` por la llamada síncrona `dim.runCommand` con fallback seguro.
4. **Verificación de Integridad de Scripts:**  
   Se ejecutó un análisis de sintaxis con motor Node (`node --check`) sobre los más de 120 archivos `.js` y se verificó que el 100% de las rutas relativas de importación resuelven correctamente.

---

## 5. Hoja de Ruta Recomendada para Futuras Actualizaciones

Para llevar el rendimiento de **Atomic** al nivel más alto posible en servidores y Realms con múltiples jugadores simultáneos, se recomienda seguir este plan gradual:

### Fase 1: Desactivación de Sobrecarga en `tick.json` (Prioridad Alta)
- Migrar `Seguridad/MonsterEffects.mcfunction` a un evento `world.afterEvents.entitySpawn` en JavaScript. Aplicar `fire_resistance` y `water_breathing` una única vez por monstruo nuevo, eliminando el comando recurrente `@e` de cada tick.
- Mover el reloj de tiempo de `General/Tiempo.mcfunction` a un intervalo de 20 ticks en JS (`system.runInterval`) que actualice `segundos`, `minutos`, `horas` y `dias` sin invocar el motor de comandos de Minecraft.

### Fase 2: Reemplazo de Durabilidad por Componente Nativo (Prioridad Media) — *(reescrita en 2ª pasada)*
- ~~Agregar `"minecraft:unbreakable": {}`~~ → **no es un componente JSON válido documentado; no agregarlo** (un componente desconocido puede invalidar el item).
- Los items ya tienen `damage_chance 0/0`. Probar en juego **con el loop apagado** (flag `durabilityFix` en config) si siguen sin gastarse armaduras/herramientas, incluso con Unbreaking y recibiendo golpes. Si no se gastan, eliminar `durability-fix.js` (ahorro: 1 loop/tick × jugadores × 6 slots).
- Alternativa si algo sí se gasta: usar `ItemDurabilityComponent.unbreakable = true` al subir `@minecraft/server` a ≥ 2.5 (hoy 2.11), en vez de resetear `damage` cada tick.

### Fase 3: Migración de IPC por Tags a `scriptevent` (Prioridad Media)
- En `features/inventory/saves.js`, reemplazar la detección de tags `save_item` / `load_item` en el loop por un listener `system.afterEvents.scriptEventReceive`.
- Cambiar los comandos de los items o NPCs que guardan/cargan a `/scriptevent atomic:inv_save <slot>`.

### Fase 4: Estandarización a TypeScript (Largo Plazo)
- Instalar las definiciones oficiales `@minecraft/server` vía npm (`npm i @minecraft/server@2.4.0`) en el entorno de desarrollo.
- Habilitar verificación estática de tipos para detectar cambios de firma de métodos y propiedades obsoletas antes de ejecutar el servidor.
- ⚠️ *(añadido en 2ª pasada)* Hoy `.gitignore` excluye `package.json` y `package-lock.json`, lo que impide versionar esta fase. Ver §6.4.

---

# PARTE II — Segunda pasada de auditoría (15 nov 2026)

> Metodología: lectura del código real (160 archivos `.js`, 112 items, mcfunctions, manifests), comprobación con `git`, `node --check`, y contraste con la documentación oficial de Microsoft (notas 1.26.20, 1.26.30, 1.26.40, 26.60 y el *Scripting V2 Overview*) y con la referencia de API `v26.60`. Lo que **no** pude comprobar sin ejecutar Minecraft está marcado como *"verificar en juego"*.

## 6. Hallazgos nuevos y correcciones al informe anterior

### 6.1 🔴 `runCommandAsync` ya no existe en Scripting V2 — 46 llamadas quedan inertes *(✅ reparado, ver Parte III)*
> **Matiz tras revisar cada sitio:** casi todos los usos eran **rutas de respaldo** detrás de una API nativa (`player.playSound`, `sendMessage`, `spawnParticle`, `kill`, `removeEffect`…), por lo que el daño real era menor que el descrito abajo: fallaban los *fallbacks*, el `runInOverworld/runAsPlayer` del anticheat, `titleraw` de `titlesPriority` y todo `onJoinFirstTime` basado en comandos. El texto original se conserva como registro del diagnóstico.
- El `manifest.json` declara `@minecraft/server 2.4.0` (Scripting V2). El *Scripting V2 Overview* indica que `Dimension.runCommandAsync` **fue eliminado**, y la referencia de API actual de `Entity` solo expone `runCommand` (síncrono).
- El informe anterior dice haber "reemplazado" este uso, pero solo se migró `scoreboards/init.js`. Quedan **46 coincidencias en ~17 archivos**: `death`, `achievements`, `skills/core/progression`, `combat/{effects,health,damage_dealt,damage_title,loot,calc}`, `regeneration`, `titlesPriority`, `anticheat/core/commandsRunner`, `adminAllowlist`, `onJoinFirstTime`.
- La mayoría están protegidas con `typeof x.runCommandAsync === "function"` o con `try { … } catch (e) { void e; }`, de modo que **no lanzan error: simplemente no hacen nada**. Efectos probables (*verificar en juego*): sin `playsound`/`particle` de level-up y logros, sin `tellraw` de respaldo, el `kill @s` de limpieza de hologramas/mobs trackeados no se ejecuta, `damage @s` y `effect @s clear absorption` de combate no aplican, `runInOverworld/runAsPlayer` del anticheat devuelven `false`.
- **Reemplazos con API nativa** (todos estables y más baratos que pasar por el parser de comandos):

| Comando actual | API nativa |
| :--- | :--- |
| `playsound id @s ~~~ vol pitch` | `player.playSound(id, { volume, pitch })` |
| `particle id ~~~` | `dimension.spawnParticle(id, location)` |
| `tellraw @s {rawtext…}` | `player.sendMessage(rawMessage)` |
| `titleraw @s actionbar …` | `player.onScreenDisplay.setActionBar(...)` |
| `kill @s` (holograma/mob) | `entity.remove()` (sin drops) / `entity.kill()` |
| `damage @s n` | `entity.applyDamage(n, options)` |
| `effect @s clear absorption` | `entity.removeEffect("absorption")` |
| `gamemode s` | `player.setGameMode(GameMode.Survival)` |
| `scoreboard players set/add …` | `world.scoreboard.getObjective(id).setScore / addScore(participant, n)` |
| `kick "name" reason` (`kickEvent.js`) | `runCommand` (síncrono) — `server-admin.kickPlayer` aún es beta |

- Cuando de verdad haga falta un comando, usar `entity.runCommand()` / `dimension.runCommand()` (síncronos) dentro de `system.run()` si se invocan desde un `beforeEvents`.

### 6.2 🟠 `durability-fix.js` probablemente es redundante
- Los **56 items** (`Atomic BP/items/*.json`) ya declaran `"minecraft:durability": { "max_durability": 32000, "damage_chance": {"min":0,"max":0} }`; con eso el motor no descuenta durabilidad.
- El script (cada **1 tick**, todos los jugadores, 6 slots, regex por slot) sigue activo "por si acaso". Plan seguro: apagarlo detrás del flag de config, probar espada/pico/armadura recibiendo golpes y con Unbreaking, y borrarlo si no hay desgaste.
- Cuidado con un detalle del comentario del propio archivo: `ItemDurabilityComponent.unbreakable` **sí existe hoy** (lectura/escritura) pero solo desde la 2.5+; no está disponible mientras el manifest siga en 2.4.0.

### 6.3 🟠 597 `catch (e) { void e; }` ocultan fallos reales
- Hay **597 bloques que tragan excepciones** y solo 25 `console.*` en todo el BP. Es la razón de que 6.1 haya pasado desapercibido durante meses.
- Recomendación: un `logger.js` único (`debug(feature, e)`) que escriba a `console.warn` con contador por feature y, si `config.debug`, a un buffer visible con un comando admin. Reemplazar los `void e` por `logger.swallow("feature", e)` de forma progresiva (empezando por `anticheat`, `death`, `regeneration`).
- Además activar la verificación de tipos (§8, P4) detectaría `runCommandAsync` en compilación.

### 6.4 🟠 Estado del repositorio Git
| Hallazgo | Detalle | Acción sugerida |
| :--- | :--- | :--- |
| **Sin commits desde 2026-03-26** | `HEAD e0d3816`; todo el trabajo reciente (docs, `combat/spawns/`, auditorías) está sin commitear | Commit por lotes tras resolver los puntos siguientes |
| **392 archivos "modificados" son solo fin de línea** | 394 de 405 archivos de texto tienen CRLF en disco y LF en `HEAD`; comprobado con `copper_axe_glint.json` (idéntico ignorando `\r`) | Añadir `.gitattributes` (`* text=auto eol=lf`) y normalizar en un commit aislado, para que el diff real no se pierda en el ruido |
| **Integridad del repo dañada** | `git diff --stat` falla con `unable to read 355342c5…`; `git fsck` reporta entradas de reflog inválidas (`HEAD`, `origin/main`) y *links* rotos en árboles; hay 1286 objetos sueltos (8,3 MiB) y solo 1 pack de 70 KB | **Copia de seguridad de la carpeta completa antes de tocar nada**, luego `git fsck --full` y recuperar objetos faltantes con `git fetch origin`. No ejecutar `gc --prune` hasta entonces |
| **18 archivos versionados borrados sin commit** | No eran "carpetas vacías" como decía §4.1: `bankMenu.js` (18,9 KB), `bankState.js`, `numberPrompt.js`, `logicScoreboard.js` (9 KB), `illegalEnchantments.js`, `scoreboardsInit.js`, 3 `functions/temp/*.mcfunction`, `LORE.md`, `GUIA_DESARROLLO_GITHUB_GITFLOW_DETALLADA.md`, `AUDITORIA_SEGUNDA_PASADA_BEDROCK_26_10.md`, `RP/textures/gui/icons.png` y `atomic.armor_force_glint.render_controllers.json` | `grep` no encontró referencias vivas a ninguno (código muerto, borrado inocuo), pero conviene commitearlo como "remove dead code" explícito. `LORE.md` y las guías son contenido de autor: confirmar que se quieren perder |
| **`package.json` sin versionar** | `.gitignore` excluía `package.json`/`package-lock.json` | Versionarlos |
| Ramas/stash antiguos | `stash@{0}` sobre el commit `a0a234c`; ramas remotas `feature/skills-fishing`, `systems/titlesPriority` | Revisar y podar |

### 6.5 🟡 Otros puntos de calidad
- **33 `system.runInterval`** en ~25 archivos (el informe anterior hablaba de "más de 15"). `features/skills/regeneration/index.js` tiene 2.167 líneas y `chest-ui/chestui/typeIds.js` 2.259: candidatos a dividir.
- **Cero** usos de `system.runJob` (generadores que reparten trabajo entre ticks), `system.waitTicks`, `itemComponentRegistry` o `blockComponentRegistry`. Los escaneos globales (`syncMobs.js:239` hace `getEntities({excludeTypes:["minecraft:player"]})` sobre toda la dimensión) deberían usar filtros más estrictos (`tags`, `families`, `location+maxDistance`) o `runJob`.
- **El proyecto ya tiene la infraestructura que el informe anterior proponía como "nueva"**: usa `system.beforeEvents.startup` + `customCommandRegistry` (`modules/commands/index.js`) y `scriptEventReceive` (anticheat, spawns). Por tanto la Fase 3 (migrar `saves.js`) es solo registrar un comando `/atomic:invsave <slot>` o un `scriptevent`, sin dependencias nuevas.
- `onJoinFirstTime` usa `world.afterEvents.playerMove` y `playerInput`; no los encontré en la lista de eventos que pude consultar. Están protegidos con `?.subscribe`, así que no rompen, pero *verificar en juego* que realmente se disparan.
- `damageCancel` ya prefiere `world.beforeEvents.entityHurt` (existe en la API actual). La 2.9.0 corrigió que un *before-hurt* que **reduce** el daño evitaba el temporizador de invulnerabilidad: re-probar el combate tras subir de versión.
- Cambio de **tags** de 1.26.20 (solo afecta a **bloques** con `format_version ≥ 1.26.20`): deben ir dentro de `minecraft:tags` como `["ns:tag"]`. Hoy el pack no define bloques; tenerlo presente si se añaden.

## 7. Nuevas capacidades relevantes para desarrolladores de Behavior Packs (1.26.10 → 26.60)

Solo se listan funciones **estables** salvo que se indique lo contrario. Columna "Atomic" = dónde aportarían aquí.

### 7.1 Scripting (`@minecraft/server` 2.5 → 2.11, `server-ui` 2.1)
| Novedad | Versión | Oportunidad en Atomic |
| :--- | :---: | :--- |
| **`TextPrimitive` / `PrimitiveShapesManager`** (texto 3D en el mundo, hasta 1000 shapes, 128 líneas × 128 caracteres) | 2.8 | Sustituir parte del sistema de **hologramas por entidad** (`atomic:hologram` + interpolación por scoreboard) y los *damage titles*: sin entidades, sin `kill @s`, sin `entityLoad` |
| **Eventos de contenedor** (`BlockContainerOpened/Closed`, `EntityContainerOpened/Closed`, `ContainerAccessSource`) | 2.8 | Registrar apertura/cierre de cofres (anti-dupe, auditoría de banco, logros) sin polling |
| **Locator Bar / Waypoints** (`LocatorBar`, `LocationWaypoint`, `EntityWaypoint`, `PlayerWaypoint`) + gamerule `playerWaypoints` (reemplaza a `locatorbar`) | 2.8 | **Spawnpoints** y **sistema de muerte**: marcar en la barra el punto de reaparición, la última muerte o el NPC de misión |
| **Dimensiones personalizadas** (`DimensionRegistry`, `startup.dimensionRegistry`) | 2.8 | Lobby/minijuegos en dimensión propia en vez de teletransportar a coordenadas fijas (`-515 1 195`). El contenido relacionado aún se marca parcialmente experimental: *validar* |
| `PlayerStartBreakingBlock` / `PlayerCancelBreakingBlock` after-events | 2.9 | Skills de minería/tala: barra de progreso, cancelar buffs al soltar el clic |
| `Block.getParts`, `Dimension.fillBlocks` más rápido (`BlockVolume`), `getBlocks`/`containsBlock` "significativamente" más rápidos | 2.8–2.9 | Regeneración de venas (`regeneration/`), menos coste por tick |
| `Entity.addItem`, `EntityEnderInventoryComponent` (y `Dimension.spawnXp`, cuya estabilidad no pude confirmar) | 2.7–2.8 | Recompensas directas al inventario/XP sin comandos |
| `EntityUpgradeAfterEvent` y versionado de entidades (`entity_version`) | 2.8 | Migrar entidades persistentes (hologramas) entre versiones del pack sin scripts de limpieza |
| `ClientSystemInfo.locale` | 2.7 | Mensajes ES/EN por jugador |
| `SoundInstance.stop`; `Player.playSound` devuelve instancia | 2.9 | Música de lobby/zona controlable |
| `WorldClock` y `EntityIsTamedComponent.tamedToPlayer` pasan a estable | 2.11 | Evaluar para ciclo día/noche propio; sustituiría parte de `Tiempo.mcfunction` solo si el objetivo es el reloj del mundo (no el tiempo jugado) |
| `@minecraft/server-ui` **2.1.0**: `MessageBox` y `CustomForm` estables | 2.1 | Alternativa moderna al hack de Chest UI para menús que no necesiten rejilla de slots |
| *(Beta, no usar en producción)* `Player.chatNamePrefix/Suffix`, `EntityStartSneaking`, `Camera.addShake`, `Dimension.cloneBlocks`, `SystemBeforeEvents.watchdogTerminate`, `getPing()`, `server-net` WebSocket, `server-admin.kickPlayer` | 2.10–2.13β | Rangos en chat (`titlesPriority`), telemetría externa, `kick` nativo — esperar a que lleguen a estable |

### 7.2 JSON declarativo (items, entidades, bloques)
| Novedad | Versión del juego | Oportunidad en Atomic |
| :--- | :---: | :--- |
| `minecraft:on_equipment_changed` (eventos al equipar/desequipar por slot) | 1.26.20 | Detectar cambio de armadura/arma **sin leer slots periódicamente** (soporte de stats por equipo) |
| `minecraft:apply_knockback_rules` (estable; `knockback_mode`, `slowdown_scale`, `extra_knockback_approach`) | 1.26.30–1.26.40 | Control fino del knockback RPG por mob custom |
| `damage_sensor.deals_damage: "no_but_entity_effects_apply"` | 1.26.20 | Daño anulado pero con knockback y efectos: útil para mobs/entidades custom que no deben morir (no aplicable a `player.json`, que el proyecto evita sobreescribir) |
| `minecraft:spawn_on_death`, `knockback_resistance` negativo | 1.26.20 | Mobs de jefe/enjambre sin scripts |
| `minecraft:use_modifiers.start_using`; `minecraft:wearable` ya **no** pisa `max_stack_size` | 1.26.30 | Revisar items de armadura custom (dependen de `max_stack_size: 1`) |
| Proyectiles personalizados (experimento *Custom Projectiles* liberado) | 1.26.30 | Habilidades a distancia sin `runtime_identifier` |
| Validación estricta de entidades con `format_version ≥ 1.26.40` | 1.26.40 | **Antes de subir `format_version` de `entities/hologram.json`**, validarlo (componentes `on_*`, goals, floats-range exigen `{min,max}`) |
| Items con `format_version ≥ 1.26.30` **deben** tener ≥1 componente | 1.26.30 | Ya se cumple (los 56 items tienen componentes). Hoy usan `1.21.100`: subir de forma gradual |
| Packs comprimidos/archivados; modo de optimización de packs en BDS | 1.26.40 | Menor tiempo de carga; incluir el paso en el despliegue a servidor |
| Allow-list activada por defecto en BDS; esquemas JSON más granulares | 1.26.30–1.26.40 | Endurecer el servidor; usar los esquemas para validar el pack en CI/VS Code |

## 8. Hoja de ruta revisada (sustituye la de la §5)

| Prioridad | Tarea | Riesgo | Esfuerzo |
| :---: | :--- | :---: | :---: |
| **P0** | Respaldar el repo y reparar integridad Git (§6.4); `.gitattributes` + normalizar EOL en un commit aparte; commitear borrados | Bajo | Bajo |
| **P0** | Migrar los 46 `runCommandAsync` a API nativa (§6.1) y probar en juego una matriz *antes/después* (sonidos, partículas, mensajes, limpieza de hologramas, anticheat) | Medio | Medio |
| **P1** | Subir manifest a `@minecraft/server 2.11.0` / `server-ui 2.1.0` y `min_engine_version` a 26.x **en una rama**; revisar *breaking changes* de 2.5→2.11 con tipos TypeScript | Medio | Medio |
| **P1** | Logger central y eliminar `void e` en rutas críticas (§6.3) | Bajo | Medio |
| **P2** | Fases 1 y 3 del informe original (`Tiempo`, `MonsterEffects`, `saves.js`) — `saves.js` vía comando custom/scriptevent ya soportado | Bajo | Bajo |
| **P2** | Probar y retirar `durability-fix.js` (§6.2) | Bajo | Bajo |
| **P2** | Escaneos de mobs/hologramas con `runJob` y filtros espaciales (§6.5) | Medio | Medio |
| **P3** | Prototipo con `TextPrimitive` para *damage titles* y 1–2 hologramas; waypoints para spawnpoints/muerte; eventos de contenedor para banco/anticheat | Medio | Medio-Alto |
| **P4** | Tooling: versionar `package.json`, instalar `@minecraft/server@2.11.0`, `jsconfig.json` con `checkJs`, ESLint y un workflow de CI (`node --check` + validación de JSON de items/entidades/manifests) | Bajo | Medio |
| **P4** | Dividir `regeneration/index.js` (2.167 líneas) y `chest-ui/typeIds.js` (2.259) | Bajo | Medio |



---

# PARTE III — Reparaciones aplicadas (15 nov 2026, rama `develop`)

Todo lo siguiente quedó en commits locales de `develop` (sin `push`). Verificación: `npm run check` → ✓ 160 scripts, 418 archivos; imports relativos, JSON y manifests válidos. **No se pudo probar en Minecraft en esta sesión**: las correcciones de comportamiento deben validarse en juego (ver lista al final).

## 9. Qué se reparó

| # | Reparación | Detalle |
| :-: | :--- | :--- |
| 1 | **`runCommandAsync` → `runCommand`** | Migrados los 46 usos en 18 archivos. Se eliminaron los `.catch()` y `await` que presuponían una *Promise*, se simplificó `onJoinFirstTime/commands.js::runCommandRaw` (que tenía dos ramas idénticas tras el cambio) y se actualizó el diagnóstico y el README de combate. |
| 2 | **Bug de seguridad: `GameMode` en minúsculas** | `anticheat/checks/adminAllowlist.js` comparaba con `GameMode.creative/spectator` y usaba `GameMode.survival`. En Scripting V2 los miembros son PascalCase (`GameMode.Creative = "Creative"`), así que el chequeo **nunca detectaba** jugadores en creativo/espectador y `ForceSurvival` fallaba. Ahora compara sin distinguir mayúsculas y usa `GameMode.Survival`. *Este hallazgo no estaba en la Parte II.* |
| 3 | **Integridad de Git** | Reconstruidos 5 *blobs* de `HEAD` que faltaban (`wooden_axe_plain.json`, `chest-ui/upgrades/README.md`, `progression.js`, `copper_helmet_glint.player.json`; el contenido del árbol de trabajo sin `\r` reproduce exactamente el SHA original). Quedan sin recuperar 9 objetos de **historia antigua** (commits ≤ `02c1f08`) y la versión `HEAD` de `LOCAL_VEIN_GROUPS.md` (sustituida por la actual). Para recuperarlos hace falta `git fetch` desde el remoto, hoy inaccesible desde este equipo. |
| 4 | **Fin de línea** | `.gitattributes` con `* text=auto eol=lf` y archivos del árbol de trabajo convertidos a LF: desaparecen los 392 falsos "modificados". |
| 5 | **`.gitignore`** | `package.json`/`package-lock.json` ahora **sí** se versionan; `tools/` y los respaldos locales siguen excluidos. |
| 6 | **Tooling y CI** | `package.json` (tipos oficiales como `devDependencies`), `dev/check-pack.mjs` (sintaxis, JSON, imports, manifests y **guardas contra APIs retiradas**: `runCommandAsync`, `worldInitialize`, `GameMode` en minúsculas) y `.github/workflows/ci.yml` que lo ejecuta en cada push/PR a `develop` y `main`. |
| 7 | **Código muerto** | Commit explícito de los borrados sin referencias vivas: `bankMenu.js`, `bankState.js`, `numberPrompt.js`, `bankCustomAmountModal.js`, `logicScoreboard.js`, `illegalEnchantments.js`, `scoreboardsInit.js`, `functions/temp/*`, un render controller y `icons.png` sin referencias. |
| 8 | **Rama `develop`** | Avanzada (fast-forward) hasta `feature/skills`, que ya contenía toda la historia de `develop` más 35 commits. |

## 10. Deliberadamente NO aplicado (y por qué)

| Elemento | Motivo | Cómo abordarlo |
| :--- | :--- | :--- |
| Subir `@minecraft/server` a 2.11 / `min_engine_version` a 26.x | Cambia el contrato de ejecución y puede impedir que el pack cargue si el juego o el servidor es anterior; no hay forma de probarlo aquí | Rama aparte, subir de 2.4 a 2.11 por tramos y validar con `npm run check` + prueba en juego |
| Apagar `durability-fix.js` | Hay que comprobar en juego que `damage_chance 0/0` basta | Poner el flag en config y probar espada/armadura con golpes y Unbreaking |
| `Tiempo.mcfunction`, `MonsterEffects.mcfunction`, `saves.js` → JS/comando | Cambian el comportamiento (`MonsterEffects` necesitaría además aplicar el efecto a los mobs ya cargados) | Hacerlo con pruebas en un mundo de desarrollo |
| Borrados de `LORE.md`, `GUIA_DESARROLLO_GITHUB_GITFLOW_DETALLADA.md` y `AUDITORIA_SEGUNDA_PASADA_BEDROCK_26_10.md` | Son documentos de autoría propia, no código muerto | Siguen borrados **sin commitear** en el árbol de trabajo; restaurar con `git checkout -- <archivo>` o confirmar el borrado |
| Reemplazar los 597 `catch { void e }` | Cambio masivo sin red de seguridad | Logger central y migración progresiva (§6.3) |
| Renombrado `atomic3:` → `atomic:` (manifests y `keyPrefix` de `saves.js`) | Ya estaba en el trabajo pendiente y se commiteó tal cual | ⚠️ El prefijo de las **Dynamic Properties de inventarios guardados** cambió de `atomic3:inv:` a `atomic:inv:`: los slots guardados bajo el prefijo antiguo no se cargarán. Si hay datos reales, migrarlos o revertir el prefijo |

## 11. Qué probar en juego tras desplegar
1. **Anticheat:** un no-admin en creativo/espectador debe generar el flag `gamemode_not_allowed` y volver a supervivencia.
2. **Sonidos/partículas/mensajes** de subida de skill, logros y muerte (antes dependían de comandos inertes en el *fallback*).
3. **Actionbar** de `titlesPriority` y el flujo completo de `onJoinFirstTime` (entrega de inventario/estructura por comandos).
4. **Limpieza** de hologramas de *damage title* y mobs trackeados (`kill`).
5. Guardar/cargar inventario (`save_item1`/`load_item1`) con el nuevo prefijo.
