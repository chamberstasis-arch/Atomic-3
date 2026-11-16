# Auditoría de `skills/` — 31 Marzo 2026

> Alcance: todos los archivos `.js` bajo `skills/` (combat/, core/, mining/).
> Criterios: errores de runtime, optimización, seguridad in-game, robustez API Bedrock.

---

## Resumen ejecutivo

| Severidad | Encontrados | Corregidos | Pendientes |
|-----------|-------------|------------|------------|
| 🔴 Crítico | 4 | 4 | 0 |
| 🟡 Alto | 3 | 3 | 0 |
| 🟠 Medio | 6 | 0 | 6 |
| 🟢 Bajo | 5 | 0 | 5 |

---

## Hallazgos críticos (corregidos)

### C1. `?.isValid?.()` crash en spawns/ (8 ocurrencias)

**Archivos**: `spawns/index.js`, `spawns/population.js`, `spawns/spawner.js`

`Entity.isValid` es una **propiedad boolean** (no método) en `@minecraft/server`. El patrón `entity?.isValid?.()` intenta llamar `true()` cuando la entidad es válida, lo que lanza `TypeError: not a function`.

Esto causaba que **todo el sistema de spawns fallara silenciosamente** porque los try/catch externos en los loops capturaban la excepción y la zona se saltaba.

**Fix**: Reemplazado `?.isValid?.()` → `?.isValid` en las 8 ocurrencias.

---

### C2. `addEffect()` duration excede límites API (2B → 20M)

**Archivos**: `config.js`, `spawns/spawner.js`

La API `Entity.addEffect()` acepta duration en rango `[1, 20000000]` ticks. La config tenía `defaultEffectDuration: 2000000000` (100× más que el máximo), causando `ArgumentOutOfBoundsError` al aplicar efectos a mobs spawneados.

**Fix**:
- `config.js`: `defaultEffectDuration` reducido a `20000000`.
- `spawner.js`: constante `DEFAULT_EFFECT_DURATION = 20000000`.
- `applyEffects()`: duration clampeado a `Math.min(duration, MAX_EFFECT_DURATION)`.

---

### C3. Takeover: `entity.remove()` antes de spawn → mob perdido

**Archivo**: `spawns/spawner.js` — `takeoverExistingEntities()`

La entidad original se eliminaba con `entity.remove()` ANTES de intentar `dimension.spawnEntity()`. Si el spawn fallaba (chunk no cargado, límite de entidades), el mob original se perdía sin reemplazo.

**Fix**: Invertido el orden — ahora se crea la nueva entidad primero y solo si tiene éxito se elimina la original.

---

### C4. `by_mob/index.js` — Kill invertido en daño mob→player

**Archivo**: `damage_dealt/by_mob/index.js`

Código muerto/invertido: `if (!target?.isValid) killEntityBestEffort(target)` intentaba hacer kill de un jugador que ya no es válido. Resultado: siempre fallaba (entidad inválida) o en el caso excepcional de que `isValid` fuera false, el killEntityBestEffort también fallaría.

**Fix**: Bloque eliminado por completo. La muerte del jugador (Vida=0) es manejada por `damageCancel/`, no por kill directo.

---

## Hallazgos altos (corregidos)

### A1. `loot.js` — Map `recentlyHandledDeaths` sin cap

**Archivo**: `loot.js`

El Map crece con cada muerte de mob. La limpieza depende de que el evento de muerte vuelva a dispararse. En sesiones largas sin muertes de mob (jugador AFK), el Map puede crecer indefinidamente.

**Fix**: Agregado hard cap: si el Map supera 200 entries, se ejecuta `cleanupHandledDeaths()` forzadamente.

---

### A2. `calc/scoreboard.js` — Lookup de objectives sin cache

**Archivo**: `calc/scoreboard.js`

`getObjectiveBestEffort()` hacía `world.scoreboard.getObjective()` en cada llamada. Con 8 scores por jugador × 20 jugadores × cada 10 ticks = **160 lookups/tick** innecesarios.

**Fix**: Agregado `objectiveCache` (Map) que cachea objectives por ID. Cache se llena en primer acceso.

---

### A3. `loot.js` — Código muerto `if (amount <= 0)`

**Archivo**: `loot.js` — `rollDropEntry()`

`amount` se calcula como `Math.floor(random * (max - min + 1)) + min` donde `min >= 1`, por lo que `amount` nunca puede ser ≤ 0. La línea `if (amount <= 0) return null` era inalcanzable.

**Fix**: Línea eliminada.

---

## Hallazgos medios (no corregidos — riesgo aceptable)

### M1. `loot.js` — Date.now() para tracking de muertes

Se usa `Date.now()` para marcar muertes recientes (timeout 4000ms). El reloj de sistema es manipulable por el jugador en Windows. Debería usar `system.currentTick` para consistencia con game ticks.

**Impacto**: Bajo en la práctica — el timeout de 4 segundos es generoso y la duplicación de loot requeriría manipulación intencional del reloj.

---

### M2. Cooldowns bypassed si `getEntityKey()` retorna null

**Archivo**: `damage_dealt/cooldown.js`

Si `entity.scoreboardIdentity` y `entity.id` son ambos null (entidad despawneando), `getEntityKey()` retorna `null` y las funciones `canApplyDamageToTarget/FromAttacker` retornan `true` directamente, bypaseando el cooldown.

**Impacto**: Solo afecta entidades en estado transitorio. El try/catch superior captura cualquier operación posterior.

---

### M3. `core/progression.js` — Búsqueda O(n²) en recompensas por nivel

**Archivo**: `core/progression.js` — `buildLevelUpRewardAdds()`

Para rangos grandes (ej. nivel 1→60), busca linealmente en el array de levels por cada nivel. O(60²) = 3600 ops. No es problemático ya que las subidas de nivel son eventos raros.

---

### M4. `health/syncMobs.js` — `trackedMobs` Set retiene entidades inválidas

Set de entidades trackeadas se limpia durante el loop de sync (si `!entity.isValid`), pero entidades que mueren entre ticks de sync permanecen en el Set temporalmente. No es un leak real porque se limpian en la siguiente iteración.

---

### M5. `calc/index.js` — Cache por jugador sin eviction por cambio de identity 

Si `scoreboardIdentity.id` de un jugador cambia mid-sesión, las entries antiguas del cache quedan huérfanas. En la práctica, esto no ocurre en Bedrock normal.

---

### M6. `effects/tick.js` — `applySymbolicDamageBestEffort` sin cap

Aplica `player.applyDamage(1)` cada tick de efecto como feedback visual. Si el efecto tiene tick rate rápido, podría causar screen shake excesivo.

---

## Hallazgos bajos (informativos)

### L1. Múltiples instancias de funciones utilitarias duplicadas

`toInt()`, `asStr()`, `clampMin0Int()` están duplicadas en: `loot.js`, `xp.js`, `mining/index.js`, `core/scoreboards.js`, `effects/tick.js`.

**Recomendación**: Crear `skills/shared/utils.js` y centralizar.

---

### L2. Event handlers nunca se dessuscriben

Todos los módulos usan `world.afterEvents.*.subscribe()` sin guardar el unsubscribe handle. Aceptable porque los módulos persisten todo el runtime.

---

### L3. `match.js` — Error swallowed silenciosamente en `getMainhandNameBestEffort`

Si la lectura del mainhand falla, retorna `""` sin distinguir "sin item" de "error de componente". No afecta funcionalidad porque el matching tiene fallbacks.

---

### L4. `spawns/validator.js` — No valida que area.min ≤ area.max

Si las coordenadas están invertidas, `randomPositionInArea()` genera valores fuera de rango. Requeriría validación en config load.

---

### L5. `config.js` — Template pool references sin validar

Las zonas referencian templateIds en `templatePool` que podrían no existir en `mobs.templates`. `selectTemplate()` los filtra silenciosamente, pero un error de typo no tiene feedback visible.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `spawns/index.js` | C1: 3× `isValid` fix |
| `spawns/population.js` | C1: 4× `isValid` fix |
| `spawns/spawner.js` | C1: `isValid` fix, C2: duration cap, C3: takeover order |
| `config.js` | C2: `defaultEffectDuration: 20000000` |
| `damage_dealt/by_mob/index.js` | C4: removed dead kill code |
| `loot.js` | A1: map hard cap, A3: dead code removed |
| `calc/scoreboard.js` | A2: objective cache added |

---

## Validación

Todos los archivos modificados pasaron:
- `node --check` — 0 errores de sintaxis
- VS Code diagnostics — 0 errores
