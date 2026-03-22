# Combat como Skill

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Documento de diseño para la integración de `combat/` al sistema de progresión de `skills/core/`.

---

## 1. Situación actual

`combat/` opera como un **motor funcional de daño**: calcula estadísticas, aplica daño, sincroniza vida, renderiza hologramas y gestiona efectos. No tiene niveles, experiencia, ni progresión.

### 1.1 Módulos existentes (encapsulados, no se tocan)

| Módulo | Responsabilidad | Estado |
|---|---|---|
| `calc/` | Fórmula de daño final + mitigación defensiva (`defense/`) | Estable |
| `health/` | Vida custom por scoreboards, sync con corazones vanilla | Estable |
| `damage_dealt/` | Aplicación de daño al golpe (player→entity, mob→player) | Estable |
| `damage_title/` | Hologramas flotantes de feedback visual | Estable |
| `damageCancel/` | Cancelación de daño vanilla cuando `H==1` | Estable |
| `effects/` | Efectos periódicos (veneno, congelamiento, calor) | Estable |
| `lecture/` | Lectura de lore → escritura de `*TotalH` | Estable (externo a combat/) |

Estos módulos **no requieren cambios** para que combat se convierta en skill. La progresión se construye **encima** de ellos: nuevos archivos en `combat/` que consumen eventos ya existentes.

### 1.2 Punto de enganche existente

En `damage_dealt/byplayer/index.js`, cuando un mob muere (`Vida <= 0`):

```js
setScore(target, OBJ_LAST_KILLER_ID, killerId);
setScore(target, OBJ_LAST_KILL_TICK, getDamageDealtTick());
setKilledByTagBestEffort(target, attacker);
killEntityBestEffort(target);
```

`LastKillerId` y `LastKillTick` se escriben pero **ningún sistema los consume actualmente**. Este es el punto natural para emitir el evento de XP.

---

## 2. Objetivo

Registrar `combat` como skill en `core/` siguiendo el mismo contrato que `mining/`, `farming/` y `foraging/`:

- Scoreboards de XP y nivel gestionados por `core/progression.js`.
- Config declarativa con tabla de niveles, recompensas y runtime.
- Reconciliación automática por intervalo.
- Level-up con mensajes, sonidos y partículas.

---

## 3. Experiencia de combate

### 3.1 Fuente de XP

La experiencia se obtiene al **asesinar mobs**. Cada mob asesinado otorga una cantidad de XP base que puede ser modificada por los mismos multiplicadores que las demás skills (equipment lore, scoreboards de XP, etc.).

**Jugadores (PvP)** no otorgan XP de combate directamente; su manejo se define por separado cuando se implemente PvP competitivo.

### 3.2 Identificación de mobs

Los mobs se identifican por **nombre** (`entity.nameTag`) y/o **tipo** (`entity.typeId`). No se usan tags ni scores para esta clasificación.

**Razón**: los nombres son obligatorios para mobs custom y visibles al jugador. Tags/scores requieren setup externo previo, lo que complica el estándar y genera dependencias frágiles.

**Reglas de matching** (evaluadas en orden de prioridad):

| Configuración | Condición | Ejemplo |
|---|---|---|
| `typeId` + `nameTag` | Ambos deben coincidir | Solo un `minecraft:zombie` que además se llame `"Guerrero Corrupto"` |
| Solo `nameTag` | Cualquier entidad con ese nombre | Todo mob que se llame `"Guardia de Elite"`, sin importar si es zombie, skeleton, etc. |
| Solo `typeId` | Cualquier entidad de ese tipo sin nombre custom | Todos los `minecraft:creeper` que no tengan nameTag (mob vanilla genérico) |

**Mob sin nombre y sin entrada en config**: no otorga XP de combate (clasificación vanilla, no afectado por la skill).

### 3.3 Formato de `config.js` — Tabla de mobs

```js
export const combatSkillConfig = {
  // ──── Scoreboards ────
  scoreboards: {
    xp:    "SkillXpCombate",
    level: "SkillLvlCombate",
  },

  // ──── XP por mob ────
  // Cada entrada define condición de match + XP base.
  // La XP base será afectada por multiplicadores globales (equipment, buffs).
  mobXp: [
    // ── Solo por tipo (mobs vanilla genéricos sin nombre) ──
    { typeId: "minecraft:zombie",          baseXp: 8  },
    { typeId: "minecraft:skeleton",        baseXp: 10 },
    { typeId: "minecraft:creeper",         baseXp: 12 },
    { typeId: "minecraft:spider",          baseXp: 8  },
    { typeId: "minecraft:enderman",        baseXp: 18 },
    { typeId: "minecraft:blaze",           baseXp: 20 },
    { typeId: "minecraft:wither_skeleton", baseXp: 25 },

    // ── Solo por nombre (cualquier tipo de entidad) ──
    { nameTag: "Guardia de Elite",         baseXp: 40  },
    { nameTag: "Espadachin Oscuro",        baseXp: 55  },
    { nameTag: "Berserker",               baseXp: 70  },

    // ── Doble condición: tipo + nombre ──
    { typeId: "minecraft:zombie",   nameTag: "Guerrero Corrupto",   baseXp: 35 },
    { typeId: "minecraft:skeleton", nameTag: "Arquero Maldito",     baseXp: 45 },
    { typeId: "minecraft:vindicator", nameTag: "Jefe de Mazmorra",  baseXp: 120 },

    // ── Pasivos (XP baja) ──
    { typeId: "minecraft:cow",    baseXp: 2 },
    { typeId: "minecraft:pig",    baseXp: 2 },
    { typeId: "minecraft:sheep",  baseXp: 2 },
    { typeId: "minecraft:chicken", baseXp: 1 },
  ],

  // ──── Niveles y recompensas ────
  maxLevel: 60,
  titleColorFallback: "§c",
  levels: [
    { level: 1,  xpRequired: 0 },
    { level: 2,  xpRequired: 50 },
    { level: 3,  xpRequired: 150 },
    { level: 4,  xpRequired: 350 },
    { level: 5,  xpRequired: 600,
      rewards: { messageAwards: ["Acceso a misiones de combate"] },
      titleColor: "§4",
    },
    // ... niveles intermedios ...
    { level: 60, xpRequired: 30000 },
  ],

  // ──── Reward principal ────
  rewards: {
    primaryObjective: "DanoPersonalH",  // Stat que sube por nivel
    primaryPerLevel: 2,                 // +2 daño base por nivel
    defaultScoreboardAddD: 300,         // Dinero por level-up
    defaultScoreboardAddDRanges: [
      { fromLevel: 1,  toLevel: 20, amount: 300 },
      { fromLevel: 21, toLevel: 40, amount: 500 },
      { fromLevel: 41, toLevel: 60, amount: 800 },
    ],
  },

  // ──── Level-up message ────
  levelUpMessage: [
    "§s+§4======================§s+",
    "",
    "§c§lHABILIDAD MEJORADA§r",
    "§7Habilidad: <levelUpCombat>",
    "",
    "§f>> §cAtributo",
    "   §6Daño Base §8<PreviousPrimary> §7-> §a<NextPrimary>",
    "",
    "§f>> §cRecompensas",
    "   §6+<ScoreboardAddD> §7Dinero",
    "<OtherAwards>",
    "",
    "§s+§4======================§s+",
  ],

  // ──── Runtime ────
  runtime: {
    reconcileEveryTicks: 40,
    initializeOnJoin: true,
    preserveHigherPrimary: true,
  },

  // ──── Debug ────
  debug: { enabled: false, console: false, tellPlayer: false },
};
```

### 3.4 Algoritmo de resolución de XP

Cuando `damage_dealt/byplayer` detecta kill (`Vida <= 0`):

```
1. Leer target.nameTag y target.typeId
2. Buscar en mobXp (prioridad):
   a. Entrada con typeId + nameTag que coincidan ambos
   b. Entrada con solo nameTag que coincida
   c. Entrada con solo typeId que coincida (y target no tenga nameTag)
3. Si no hay match → XP = 0 (mob no afectado)
4. baseXp × multiplicadores de equipment/buffs → xpFinal
5. Sumar xpFinal al scoreboard SkillXpCombate del killer
6. core/ reconcilia nivel en el siguiente tick de intervalo
```

**Prioridad de matching**: doble condición > solo nombre > solo tipo. La primera entrada que coincida gana; no se acumulan.

---

## 4. Loot de mobs

El sistema de loot usa los **mismos criterios de matching** que la XP (tipo, nombre, o ambos). Cada entrada en la tabla de loot define drops personalizados que reemplazan o complementan los drops vanilla.

### 4.1 Contrato de configuración

```js
// Dentro de combatSkillConfig o como módulo separado combat/loot/config.js
mobLoot: [
  {
    // ── Match criteria (mismas reglas que mobXp) ──
    typeId: "minecraft:zombie",
    nameTag: "Guerrero Corrupto",

    // ── Drops ──
    drops: [
      { itemId: "atomic:zombie_fang",    chance: 0.35, min: 1, max: 2 },
      { itemId: "atomic:corrupted_gem",  chance: 0.05, min: 1, max: 1 },
      { itemId: "minecraft:iron_ingot",  chance: 0.50, min: 1, max: 3 },
    ],

    // ── Política de drops vanilla ──
    vanillaDrops: "suppress",  // "suppress" | "keep" | "replace"
  },
  {
    typeId: "minecraft:skeleton",
    drops: [
      { itemId: "minecraft:bone", chance: 1.0, min: 1, max: 3 },
    ],
    vanillaDrops: "keep",
  },
],
```

### 4.2 Políticas de drops vanilla

| Valor | Comportamiento |
|---|---|
| `"keep"` | Drops vanilla conviven con drops custom |
| `"suppress"` | Se cancelan drops vanilla, solo caen los custom |
| `"replace"` | Se cancelan vanilla y se usan exclusivamente los custom |

### 4.3 Drops condicionales (futuro)

La tabla de drops puede extenderse con predicados condicionales basados en estadísticas del jugador u otras variables. El contrato se reserva pero no se implementa aún:

```js
{
  typeId: "minecraft:enderman",
  drops: [
    {
      itemId: "atomic:ender_shard",
      chance: 0.10,
      min: 1, max: 1,
      // Futuro: condiciones adicionales
      // conditions: [{ type: "scoreboardMin", objective: "SkillLvlCombate", min: 20 }],
    },
  ],
}
```

---

## 5. Mobs personalizados

A diferencia de otras skills, combat requiere mobs con estadísticas, equipamiento y comportamiento custom en el mundo. Se evalúan tres estrategias:

### 5.1 Opción A — Structures in-game

Diseñar mobs manualmente in-game, guardarlos con `/structure save` y cargarlos con scripts/commands.

| Ventaja | Desventaja |
|---|---|
| Control visual directo | Difícil alterar stats post-diseño |
| No requiere código de equipamiento | Escalar requiere re-diseñar y re-guardar |
| Resultado inmediato | Balance hardcodeado en la structure |

**Caso de uso**: jefes de mazmorra con animaciones o equipamiento decorativo muy específico que no se puede lograr por script. Cantidad limitada de mobs únicos.

### 5.2 Opción B — Scripts puros (recomendada para escala)

Generar mobs por script: asignar equipamiento, encantamientos vanilla, estadísticas (`H=1`, scores), nombre y comportamiento. Todo declarado en un `config.js`.

```js
// Ejemplo conceptual de definición de mob
mobTemplates: [
  {
    id: "guerrero_corrupto",
    typeId: "minecraft:zombie",
    nameTag: "§cGuerrero Corrupto",
    scores: { H: 1, DMGH: 15, VidaMaxTotalH: 200 },
    equipment: {
      head:  { itemId: "minecraft:iron_helmet",     enchants: [{ id: "protection", level: 2 }] },
      chest: { itemId: "minecraft:iron_chestplate",  enchants: [{ id: "protection", level: 1 }] },
      hand:  { itemId: "minecraft:iron_sword",       enchants: [{ id: "sharpness", level: 2 }] },
    },
    // Referencia a mobXp y mobLoot por nameTag + typeId
  },
],
```

| Ventaja | Desventaja |
|---|---|
| Balance modificable sin re-diseñar | No hay preview visual directa |
| Escalable: agregar mob = agregar entrada | Equipamiento limitado a items existentes |
| Versionable en config.js | Requiere spawn management por script |

**Caso de uso**: poblaciones de mobs en zonas abiertas, oleadas, spawning condicional por área. La mayoría de mobs custom caen aquí.

### 5.3 Opción C — Híbrido (recomendada para jefes)

Diseñar la estética (armadura, look) in-game con structures. Asignar estadísticas y comportamiento por script al detectar la entidad (por nombre o tipo + nombre).

| Ventaja | Desventaja |
|---|---|
| Lo mejor de ambos mundos | Dos fuentes de verdad (visual vs stats) |
| Artistas y scripters trabajan independientemente | Requiere convención de naming estricta |
| Balance ajustable sin re-diseñar visuals | Debug más complejo |

**Caso de uso**: jefes de mazmorra que necesitan look específico pero cuyas stats deben poder ajustarse desde config sin re-guardar la structure.

### 5.4 Decisión recomendada

Usar **Opción B como default** para la mayoría de mobs y **Opción C para jefes/mobs especiales** que requieran diseño visual particular. La Opción A queda descartada para producción por su rigidez.

---

## 6. Archivos a crear

### 6.1 Estructura propuesta

```text
combat/
  config.js          ← NUEVO: combatSkillConfig (niveles, XP, mobXp, mobLoot, rewards)
  index.js           ← NUEVO: initSkillCombat(), registro en core/
  xp.js              ← NUEVO: hook de kill → resolución de XP → escritura a scoreboard
  loot.js            ← NUEVO: hook de kill → resolución de drops → spawn de items
  match.js           ← NUEVO: resolveMobMatch(entity, config) — lógica compartida de matching
  // --- módulos existentes (sin cambios) ---
  calc/
  health/
  damage_dealt/
  damage_title/
  damageCancel/
  effects/
```

### 6.2 Contrato de cada archivo nuevo

**`config.js`** — Configuración declarativa completa:
- Scoreboards de XP/nivel.
- Tabla `mobXp[]` con matching por tipo/nombre.
- Tabla `mobLoot[]` con drops y política vanilla.
- Tabla `levels[]` con XP, recompensas, requisitos.
- Mensajes de level-up, runtime, debug.

**`index.js`** — Bootstrap y registro:
- `initSkillCombat(userConfig?)`: inicializa `core/`, registra la definición de skill, hookea `xp.js` y `loot.js`.
- `buildCombatSkillDefinition(config)`: transforma config en el formato que `registerSkillDefinition()` espera.
- Exporta helpers: `getCombatNextXpRequirement()`, `reconcileCombatForPlayer()`.

**`match.js`** — Motor de matching (puro, sin side-effects):
- `resolveMobMatch(entity, entries)`: recibe la entidad y el array de entries (mobXp o mobLoot), retorna la primera entrada que coincida según las reglas de prioridad.
- Función pura y testeable. Consumida tanto por `xp.js` como por `loot.js`.

**`xp.js`** — Ganancia de XP por kill:
- Se hookea al momento del kill en `damage_dealt/byplayer`.
- Obtiene el killer (por `LastKillerId` o pasado como argumento directo).
- Llama a `resolveMobMatch()` para obtener `baseXp`.
- Aplica multiplicadores (si existen) y suma al scoreboard de XP.
- `core/` reconcilia nivel en su intervalo habitual.

**`loot.js`** — Drops custom por kill:
- Se hookea al mismo momento que `xp.js`.
- Llama a `resolveMobMatch()` contra la tabla `mobLoot`.
- Ejecuta rolls de probabilidad (`Math.random() < chance`).
- Spawna items en la posición del mob muerto.
- Suprime drops vanilla si la política lo indica.

### 6.3 Integración con `damage_dealt/byplayer`

El punto de enganche es el bloque de kill existente. Se necesita un cambio mínimo: exportar un callback o emitir un hook que `xp.js` y `loot.js` puedan consumir.

Opción recomendada — **callback directo**:

```js
// En damage_dealt/byplayer/index.js, dentro del bloque de kill:
if (vidaAfter <= 0 && vidaMax !== 0) {
  // ... (código existente de LastKillerId, tags, kill)
  // NUEVO: notificar a combat skill
  onMobKilledByPlayer(attacker, target);
}
```

Donde `onMobKilledByPlayer` es un hook registrado por `combat/index.js` durante init. Si combat no está inicializado, el hook es no-op.

---

## 7. Scoreboards nuevos

| Scoreboard | Tipo | Descripción |
|---|---|---|
| `SkillXpCombate` | dummy | XP acumulada de combate del jugador |
| `SkillLvlCombate` | dummy | Nivel actual de combate del jugador |

Deben registrarse en `scripts/scoreboards/catalog.js` e `init.js` antes de que el módulo inicie.

---

## 8. Orden de inicialización actualizado

```js
// En main.js
initLecture();
initSkillsCore();
initSkillMining();
initSkillForaging();
initSkillFarming();
initSkillCombat();          // ← NUEVO: registra skill + hookea xp/loot
initSkillRegeneration();
initDamageCalc();
initVanillaDamageCancel();
initCombatHealth();
initDamageTitle();
initEffects();
initDamageDealt();          // ← después de combat skill para que el hook exista
initDeathSystem();
```

`initSkillCombat()` debe ejecutarse **antes** de `initDamageDealt()` para que el hook de kill esté registrado cuando `damage_dealt` empiece a procesar golpes.

---

## 9. Casos de uso

### 9.1 Jugador mata zombie genérico (sin nombre)

1. Player golpea zombie con `H==1` → `damage_dealt/byplayer` aplica daño.
2. `Vida` del zombie llega a 0 → kill.
3. `xp.js`: match por `typeId: "minecraft:zombie"` → `baseXp: 8`.
4. 8 XP se suma a `SkillXpCombate`.
5. `loot.js`: match por `typeId: "minecraft:zombie"` → roll drops, spawn items.
6. `core/` reconcilia: si XP supera threshold → level-up.

### 9.2 Jugador mata "Guerrero Corrupto" (doble condición)

1. El mob es un `minecraft:zombie` con `nameTag: "Guerrero Corrupto"`.
2. Kill ocurre → `xp.js` busca match.
3. Doble condición `typeId + nameTag` tiene prioridad → `baseXp: 35`.
4. 35 XP se suma. No se aplica también la entrada genérica de zombie.
5. `loot.js`: match devuelve drops custom + `vanillaDrops: "suppress"`.

### 9.3 Mob sin nombre ni entrada en config

1. Un `minecraft:pig` sin nameTag y sin entrada en `mobXp`.
2. Kill ocurre → `resolveMobMatch()` retorna `null`.
3. XP = 0. Loot = vanilla (no se modifica).

### 9.4 Mob con nombre matcheado solo por nombre

1. Un `minecraft:husk` con `nameTag: "Guardia de Elite"`.
2. No hay entrada con `typeId: "minecraft:husk"` + ese nombre.
3. Sí hay entrada con solo `nameTag: "Guardia de Elite"` → `baseXp: 40`.
4. Funciona sin importar el tipo base de la entidad.

### 9.5 Level-up de combate

1. Player acumula XP y supera threshold del nivel 5.
2. `core/` reconcilia: detecta transición 4→5.
3. `primaryObjective: "DanoPersonalH"` sube +2 (acumulativo).
4. Se otorga dinero según rango configurado.
5. Mensaje de level-up, sonido y partículas.

---

## 10. Consideraciones de implementación

### 10.1 Convención de `match.js`

La función de matching es el componente más reutilizable. Debe ser pura, sin depender de APIs de Bedrock internamente:

```js
/**
 * @param {{ typeId: string, nameTag: string }} entity
 * @param {Array<{ typeId?: string, nameTag?: string, [key: string]: any }>} entries
 * @returns {object|null} La primera entrada que coincida, o null.
 */
export function resolveMobMatch(entity, entries) { ... }
```

### 10.2 Multiplicadores de XP

La XP base puede ser afectada por stats del equipo del jugador (ej. `ExpCombateTotalH`). Si el stat existe y está registrado en `lecture/statRegistry.js`, se consume como multiplicador. Si no existe, `baseXp` se aplica directamente.

### 10.3 Supresión de drops vanilla

Bedrock Script API no tiene `beforeEvents.entityDie` que permita cancelar drops nativamente. La supresión se implementa como **limpieza reactiva**: tras el kill, buscar `ItemEntity`s en un radio cercano al mob muerto dentro de una ventana temporal corta y eliminar los correspondientes a vanilla drops conocidos. Alternativa: matar al mob con `entity.remove()` en lugar de `entity.kill()` para evitar drops vanilla (requiere validar side-effects).

### 10.4 Regla de no-duplicación

Si un mob coincide con una entrada de `mobXp`, solo se aplica la primera coincidencia. Lo mismo para `mobLoot`. No se acumulan entradas.

### 10.5 No romper módulos existentes

Los módulos `calc/`, `health/`, `damage_dealt/`, `damage_title/`, `damageCancel/` y `effects/` no se modifican estructuralmente. El único cambio en código existente es agregar el hook de notificación en `damage_dealt/byplayer/index.js` (una línea).