# Regeneration (skills) — Contrato actual

Sistema de regeneración de bloques por evento (`beforeEvents.playerBreakBlock`) con drops custom, modifiers scoreboard-driven, persistencia de pendientes y titles temporales vía `titlesPriority`.

Estado actual:

- `regeneration/` ya consume `core/` por `skillId` para requerimientos de nivel y reconciliación tras XP.
- El helper global `spread.js` ya está operativo y configurable desde `config.js`.
- `regeneration/` no crea objectives; solo consume scoreboards ya catalogados en `scripts/scoreboards/`.

## Alcance del módulo
- Intercepta minado/tala/cosecha y cancela el break vanilla.
- Aplica `minedBlockId` temporal, drops custom y agenda restauración.
- Evalúa modifiers con reglas `when` (score/area/skill), máximo 3 niveles de anidación.
- Suma scoreboards (global + bloque + modifier + XP gain) con preferencia API nativa.
- Emite title temporal de XP usando `upsertTemporaryTitle` (no usa `titleraw` directo).

## Configuración clave (`config.js`)
### `runtime`
`runtime` es configuración local de `regeneration` (no global del addon).

- `runtime.xpOrbs.maxSpawnPerBreak`: cap anti-spam de orbes XP.
- `runtime.spread`: defaults globales para propagación por bloques adyacentes.
- `runtime.particles.triggerModifierKeys`: keys de modifiers que disparan `particlesOnSilkTouch`.
- `runtime.titles`:
  - `enabledByDefault`, `source`, `priority`, `durationTicks`, `contentTemplate`.
  - `noLevelsContentTemplate`: fallback visual cuando no existe catálogo consumible de la skill.
  - `progressObjectivesBySkill`: fallback de objectives por skill cuando la definición aún no está registrada en `core/`.

### Objectives por skill
Por defecto, el sistema usa:
- `mining`: `SkillXpMineria`, `SkillLvlMineria`
- `foraging`: `SkillXpTala`, `SkillLvlTala`
- `farming`: `SkillXpCosecha`, `SkillLvlCosecha`

Se pueden sobreescribir en `runtime.titles.progressObjectivesBySkill` o por regla con `effects.xp.gainObjective/levelObjective`.

## Modifiers scoreboard-driven
Cada bloque define `modifiers` como array de reglas:

- `priority`: desempate determinista.
- `mode`: `override` o `add`.
- `when`: `all/any/not` con condiciones `score`, `area`, `skill`.
- `effects`:
  - `drops`
  - `scoreboardAddsOnBreak`
  - `xp` (`base`, `scalingObjective`, `gainObjective?`, `levelObjective?`, `stepPerPoints?`)
  - `title`

## Mutación por bloque
Cada bloque también puede declarar `mutation` para añadir drops especiales por probabilidad derivada de un scoreboard.

Contrato soportado:

- `enabled`: activa/desactiva la mutación del bloque.
- `objective`: scoreboard leído para calcular la probabilidad.
- `scoreMin`: mínimo efectivo (default `0`).
- `scoreMax`: máximo efectivo (default `1000`).
- `drops`: tabla de drops especiales que se agrega al resultado normal cuando la mutación atina.

Regla actual:

- `chance = clamp(score, scoreMin, scoreMax) / scoreMax`
- Si atina, `mutation.drops` se concatena a `drops` normales.
- Es un agregado, no un reemplazo.

## Ciclo de crecimiento por bloque
Para cultivos, cada bloque puede declarar `growthCycle` para exigir madurez antes de otorgar drops de cosecha.

Contrato soportado:

- `state`: nombre del block state de crecimiento (ej. `growth`).
- `matureValue`: valor mínimo para considerar el cultivo cosechable.
- `seedValue`: valor usado como estado temporal después de una cosecha válida.
- `instantRestoreImmature`: si está activo, romper un cultivo inmaduro lo restaura al instante sin persistencia.

Regla actual:

- Si el cultivo no llega a `matureValue`, se cancela la cosecha y se restaura en el momento.
- Si está maduro, se aplican drops/XP y el bloque pasa a `seedValue` durante `regenSeconds`.
- Al finalizar `regenSeconds`, el bloque se restaura al estado maduro.

## Spread global por scoreboard
Cada bloque puede declarar `spread` para propagar la rotura a vecinos ortogonales válidos.

Contrato soportado:

- `enabled`: activa la mecánica en el bloque.
- `objective`: scoreboard leído para calcular extras.
- `pointsPerExtra`: cada cuántos puntos se garantiza un bloque adicional.
- `maxExtraBlocks`: tope duro de bloques extra por evento.
- `maxVisitedBlocks`: límite de exploración BFS para evitar expansión descontrolada.
- `matchMode`: `same-block-type`, `same-definition` o `same-skill`.
- `randomness`: valor `0..1` para desordenar la exploración y hacer menos predecible la forma final.
- `sound`:
  - `enabled`: reproduce el sonido del bloque una vez por cada bloque extra afectado.
  - `pitchJitter`: altera levemente el pitch por bloque para saturar el impacto sin sonar plano.

Regla actual:

- `extras = floor(score / pointsPerExtra) + probabilidad(residuo / pointsPerExtra)`
- La búsqueda usa vecinos ortogonales en 6 direcciones.
- Si `randomness > 0`, el frente de búsqueda y el orden de vecinos se mezclan parcialmente.
- `resolveSpreadTargets()` devuelve tanto los targets como la configuración normalizada usada en el evento.
- El primer consumidor activo es `foraging` con `FrenTalTotalH`.

### Sonido por spread

Cuando `spread.sound.enabled=true`, cada bloque extra afectado reproduce su propio `sounds[]` del bloque base/registrado.

Esto hace que:

- tala con varios logs suene más cargada,
- minería con varios minerales pueda saturar `dig.stone`,
- cosecha futura pueda hacer lo mismo con `dig.grass`.

El bloque origen mantiene su sonido normal; los bloques extra agregan repeticiones adicionales.

### Estado por skill

- `foraging`: activo con `FrenTalTotalH`, randomness y sound burst habilitados.
- `mining`: contrato de spread preparado pero desactivado hasta que exista la stat futura.
- `farming`: contrato de spread preparado pero desactivado hasta que exista la stat futura.

## XP gain y progreso visual actual
### Ganancia por evento
`resolveXpGain` calcula:
- `multiplier = max(1, 1 + floor(stat / stepPerPoints))`
- `xpGain = base * multiplier`

### Titles de XP
Al renderizar title, se calculan placeholders:
- `${xpGain}`: XP ganada en el evento.
- `${xpActual}`: XP visible después del evento o del batch acumulado.
- `${xpRequeriment}`: requerimiento del siguiente nivel consultado desde `core/`.
- `${xpRequirement}`: alias equivalente.
- `${skill}`: skill normalizada (`mining`, `foraging`, `farming`).

Resolución actual:

- `regeneration/` intenta resolver `xpObjective` y `levelObjective` en este orden:
  1. `effects.xp.gainObjective` y `effects.xp.levelObjective`
  2. `runtime.titles.progressObjectivesBySkill`
  3. La definición registrada en `skills/core/`
- El requerimiento visible se obtiene con `getSkillNextXpRequirement(skillId, currentLevel)`.
- Si la skill no tiene catálogo consumible o ya no tiene siguiente nivel, el sistema usa `runtime.titles.noLevelsContentTemplate`.

En eventos con spread, el title se acumula por `skill|source|id` y se hace un solo `flush` al final del procesamiento para evitar spam de un title por cada bloque extra.

Ejemplo (`content: ["+${xpGain} ${xpActual}/${xpRequeriment}"]`):
- `SkillXpMineria=0`, `SkillLvlMineria=1`, `xpGain=8` => `+8 8/20` si el catálogo de `core/` define nivel 2 con `20` XP.

## Seguridad y hardening aplicados
- Fallback por comando para scoreboards valida objective token antes de ejecutar comando.
- Escritura de scoreboards prioriza API (`world.scoreboard`) para evitar dependencia de permisos/cheats.
- Lógica best-effort con `try/catch` en puntos de IO/runtime para no romper el servidor.

## Persistencia
- Solo persisten pendientes de regeneración (`dimensionId,x,y,z,blockId,minedBlockId,restoreAt`).
- Al boot/worldLoad restaura entradas válidas y limpia huérfanas.

## Estado de documentación
Este archivo es la fuente vigente del módulo `regeneration`.
`IMPROVEMENT.md` fue retirado por estar desfasado respecto a la implementación actual.
