# Regeneration (skills) — Contrato actual

Sistema de regeneración de bloques por evento (`beforeEvents.playerBreakBlock`) con drops custom, modifiers scoreboard-driven, persistencia de pendientes y titles temporales vía `titlesPriority`.

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
- `runtime.particles.triggerModifierKeys`: keys de modifiers que disparan `particlesOnSilkTouch`.
- `runtime.titles`:
  - `enabledByDefault`, `source`, `priority`, `durationTicks`, `contentTemplate`.
  - `provisional.requirementPerLevel`: base provisional para requerimiento de siguiente nivel.
  - `progressObjectivesBySkill`: separación de scoreboards por skill.

### Objectives por skill (provisional)
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

## XP gain y progress provisional
### Ganancia por evento
`resolveXpGain` calcula:
- `multiplier = max(1, 1 + floor(stat / stepPerPoints))`
- `xpGain = base * multiplier`

### Progress provisional para title
Al renderizar title, se calculan placeholders:
- `${xpGain}`: XP ganada en el evento.
- `${xpActual}`: XP después del evento (`scoreActual + xpGain`).
- `${xpRequeriment}`: requerimiento provisional para siguiente nivel.
- `${xpRequirement}`: alias equivalente.
- `${skill}`: skill normalizada (`mining`, `foraging`, `farming`).

Fórmula provisional:
- `xpRequeriment = max(base, (nivelActual + 1) * base)`
- `base = runtime.titles.provisional.requirementPerLevel` (default `50`).

Ejemplo (`content: ["+${xpGain} ${xpActual}/${xpRequeriment}"]`):
- `SkillXpMineria=0`, `SkillLvlMineria=0`, `xpGain=8` => `+8 8/50`.

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
