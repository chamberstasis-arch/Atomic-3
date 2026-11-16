# Sistema de Spawn de Mobs Custom

> Minecraft Bedrock · `@minecraft/server` 2.4.0

Documento de diseño para el sistema de spawneo de mobs custom por áreas, integrado a `combat/`.

---

## 1. Objetivo

Crear un mundo que se sienta "vivo" desde la perspectiva del jugador. Los mobs custom aparecen de forma natural en zonas del mundo, con estadísticas y equipamiento configurables, sin que el jugador pueda predecir los puntos exactos de spawn.

El sistema debe ser:
- **Altamente configurable**: áreas, densidad, frecuencia, condiciones y templates desde `config.js`.
- **Impredecible para el jugador**: posiciones aleatorias dentro del área definida.
- **Seguro para el mob**: validación de bloque sólido debajo y espacio libre arriba.
- **Eficiente**: control de población activa para no degradar performance.

---

## 2. Estrategia elegida

**Opción 1: Áreas naturales de spawneo** — seleccionada.

Cada mob template define una o más zonas del mundo donde puede aparecer. Dentro de esa zona, la posición exacta es aleatoria, validada por condiciones físicas del terreno.

Razones para elegir esta opción sobre coordenadas fijas:
- Los jugadores no pueden predecir ni memorizar spawns.
- Escalable: agregar zona = agregar entrada en config.
- Más inmersivo: los mobs "habitan" regiones, no puntos.
- Compatible con terrain generation variado.

---

## 3. Arquitectura

### 3.1 Archivos nuevos

```text
combat/
  spawns/
    index.js        ← Bootstrap: inicia el loop de spawn, consume config
    spawner.js      ← Lógica core: selección de área, posición aleatoria, validación, instanciación
    validator.js    ← Validación de terreno: bloque sólido, espacio aéreo, dentro de área
    population.js   ← Control de población: tracking de mobs activos, límites por zona/global
    config.js       ← Re-exporta la sección spawns de combat/config.js (o override local)
```

### 3.2 Flujo de spawn (por tick de intervalo)

```
1. Loop principal (system.runInterval, cada spawnCheckTicks)
2. Para cada spawnZone en config:
   a. Contar mobs activos en esa zona (population tracking)
   b. Si población actual >= maxMobs de la zona → skip
   c. Seleccionar un mob template válido para la zona (weighted random)
   d. Generar posición candidata aleatoria dentro del área
   e. Validar posición:
      - Bloque en (x, y-1, z) debe ser sólido
      - Bloques en (x, y, z), (x, y+1, z), (x, y+2, z), (x, y+3, z) deben ser aire
      - Posición debe estar dentro del bounding box del área
   f. Si la validación falla → reintentar hasta maxRetries, luego skip
   g. Spawn del mob: dimension.spawnEntity(typeId, position)
   h. Aplicar template: scores, equipment, nameTag, comportamiento
   i. Registrar en population tracker
3. Cleanup periódico: remover entries de mobs que ya no existen
```

### 3.3 Integración con combat/

El spawn system consume `combat/config.js` → `mobs.templates[]` para las definiciones de mobs y `spawns` para las zonas. El matching de XP y loot funciona automáticamente porque los mobs spawneados tienen el `typeId` y `nameTag` que ya están en `mobXp[]` y `mobLoot[]`.

---

## 4. Configuración

### 4.1 SpawnZones — Zonas de spawneo

Cada zona define un volumen 3D del mundo donde pueden aparecer mobs.

```js
spawns: {
  enabled: true,
  debug: false,

  // Intervalo global entre checks de spawn (ticks)
  spawnCheckTicks: 100,

  // Máximo de intentos de posición por zona por check
  maxRetriesPerZone: 5,

  // Límite global de mobs custom activos en todo el mundo
  globalMaxMobs: 80,

  // Distancia mínima a cualquier jugador para spawnear (bloques)
  minPlayerDistance: 16,

  // Distancia máxima a algún jugador para spawnear (evitar spawn en zonas sin jugadores)
  maxPlayerDistance: 96,

  // Distancia a la que un mob se despawnea si no hay jugadores cerca
  despawnDistance: 128,

  // Intervalo de cleanup de población (ticks)
  populationCleanupTicks: 200,

  zones: [
    {
      id: "bosque_oscuro",
      enabled: true,
      dimension: "overworld",

      // Bounding box del área (esquinas opuestas)
      area: {
        min: { x: -200, y: 40, z: -200 },
        max: { x: 200, y: 90, z: 200 },
      },

      // Máximo de mobs custom activos simultáneamente en esta zona
      maxMobs: 12,

      // Cuántos mobs intentar spawnear por check (si hay espacio)
      spawnsPerCheck: 2,

      // Templates que pueden aparecer en esta zona (referencia por id)
      // Con peso relativo para weighted random
      templates: [
        { templateId: "guerrero_corrupto", weight: 10 },
        { templateId: "arquero_maldito", weight: 8 },
        { templateId: "zombie_basico", weight: 20 },
      ],

      // Condiciones adicionales (opcionales)
      conditions: {
        // Solo spawnear de noche (time 13000-23000)
        nightOnly: false,
        // Solo spawnear si hay jugadores en la zona
        requirePlayerInZone: false,
        // Solo spawnear en superficie (Y > seaLevel)
        surfaceOnly: true,
        // Nivel mínimo del jugador más cercano (si se quiere escalar dificultad por progresión)
        minPlayerCombatLevel: 0,
      },
    },

    {
      id: "mazmorra_norte",
      enabled: true,
      dimension: "overworld",
      area: {
        min: { x: 500, y: 10, z: 500 },
        max: { x: 550, y: 45, z: 550 },
      },
      maxMobs: 6,
      spawnsPerCheck: 1,
      templates: [
        { templateId: "guardia_elite", weight: 5 },
        { templateId: "espadachin_oscuro", weight: 8 },
      ],
      conditions: {
        nightOnly: false,
        requirePlayerInZone: true,
        surfaceOnly: false,
        minPlayerCombatLevel: 10,
      },
    },
  ],
},
```

### 4.2 MobTemplates — Definiciones de mobs

Las templates ya están contempladas en `combat/config.js` → `mobs.templates[]`. El spawn system las consume para instanciar mobs con estadísticas.

```js
mobs: {
  templates: [
    {
      id: "guerrero_corrupto",
      typeId: "minecraft:zombie",
      nameTag: "§cGuerrero Corrupto",

      // Scores que se asignan al mob al spawnear
      scores: {
        H: 1,
        DMGH: 15,
        VidaMaxTotalH: 200,
      },

      // Equipamiento (EquipmentSlot → item definition)
      equipment: {
        head:     { itemId: "minecraft:iron_helmet",     enchants: [{ id: "protection", level: 2 }] },
        chest:    { itemId: "minecraft:iron_chestplate",  enchants: [{ id: "protection", level: 1 }] },
        legs:     { itemId: "minecraft:iron_leggings" },
        feet:     { itemId: "minecraft:iron_boots" },
        mainhand: { itemId: "minecraft:iron_sword",       enchants: [{ id: "sharpness", level: 2 }] },
        offhand:  { itemId: "minecraft:shield" },
      },

      // Drop chance del equipamiento (0-1, independiente del loot table)
      equipmentDropChance: 0,

      // Persistencia: si true, el mob no se despawnea automáticamente
      persistent: false,

      // Tags opcionales para lógica adicional
      tags: ["custom_mob", "zone_mob"],

      // Comportamiento post-spawn (opcional)
      behavior: {
        // Rango de aggro en bloques (usa vanilla si no se especifica)
        aggroRange: 24,
        // Velocidad de movimiento multiplicada
        speedMultiplier: 1.0,
      },
    },

    {
      id: "arquero_maldito",
      typeId: "minecraft:skeleton",
      nameTag: "§5Arquero Maldito",
      scores: { H: 1, DMGH: 12, VidaMaxTotalH: 150 },
      equipment: {
        head:     { itemId: "minecraft:chainmail_helmet" },
        chest:    { itemId: "minecraft:chainmail_chestplate" },
        mainhand: { itemId: "minecraft:bow", enchants: [{ id: "power", level: 2 }] },
      },
      equipmentDropChance: 0,
      persistent: false,
      tags: ["custom_mob", "zone_mob"],
    },

    {
      id: "zombie_basico",
      typeId: "minecraft:zombie",
      nameTag: "§7Zombie",
      scores: { H: 1, DMGH: 5, VidaMaxTotalH: 80 },
      equipment: {},
      equipmentDropChance: 0,
      persistent: false,
      tags: ["custom_mob"],
    },

    {
      id: "guardia_elite",
      typeId: "minecraft:vindicator",
      nameTag: "§6Guardia de Elite",
      scores: { H: 1, DMGH: 25, VidaMaxTotalH: 400 },
      equipment: {
        head:     { itemId: "minecraft:diamond_helmet",     enchants: [{ id: "protection", level: 3 }] },
        chest:    { itemId: "minecraft:diamond_chestplate",  enchants: [{ id: "protection", level: 3 }] },
        legs:     { itemId: "minecraft:diamond_leggings",    enchants: [{ id: "protection", level: 2 }] },
        feet:     { itemId: "minecraft:diamond_boots",       enchants: [{ id: "protection", level: 2 }] },
        mainhand: { itemId: "minecraft:diamond_axe",         enchants: [{ id: "sharpness", level: 3 }] },
      },
      equipmentDropChance: 0,
      persistent: false,
      tags: ["custom_mob", "elite"],
    },

    {
      id: "espadachin_oscuro",
      typeId: "minecraft:husk",
      nameTag: "§8Espadachin Oscuro",
      scores: { H: 1, DMGH: 20, VidaMaxTotalH: 300 },
      equipment: {
        head:     { itemId: "minecraft:golden_helmet",     enchants: [{ id: "protection", level: 2 }] },
        chest:    { itemId: "minecraft:golden_chestplate",  enchants: [{ id: "protection", level: 2 }] },
        mainhand: { itemId: "minecraft:golden_sword",       enchants: [{ id: "sharpness", level: 3 }] },
      },
      equipmentDropChance: 0,
      persistent: false,
      tags: ["custom_mob", "dungeon"],
    },
  ],
},
```

---

## 5. Validación de posición

La validación de spawn es el componente más crítico para la inmersión. Un mob que aparece dentro de un bloque o flotando en el aire rompe completamente la ilusión de mundo vivo.

### 5.1 Reglas de validación

Para que una posición `(x, y, z)` sea válida para spawn:

1. **Bloque sólido debajo**: `block(x, y-1, z)` debe tener `isSolid === true`.
2. **Espacio libre arriba**: `block(x, y, z)`, `block(x, y+1, z)`, `block(x, y+2, z)` y `block(x, y+3, z)` deben ser aire (`typeId === "minecraft:air"`).
3. **Dentro del área**: la posición debe estar dentro del bounding box definido en la zona.
4. **No es agua/lava**: `block(x, y-1, z)` no debe ser líquido (a menos que el template lo permita).

### 5.2 Bloque sólido — Criterio

```js
function isBlockSolid(block) {
  if (!block) return false;
  // Primero intentar isSolid del componente
  if (block.isSolid === true) return true;
  // Fallback: excluir tipos conocidos como no-sólidos
  const nonSolid = ["minecraft:air", "minecraft:water", "minecraft:lava",
                     "minecraft:tallgrass", "minecraft:deadbush",
                     "minecraft:red_flower", "minecraft:yellow_flower"];
  return !nonSolid.includes(block.typeId);
}
```

### 5.3 Algoritmo de posición aleatoria

```
1. Elegir x aleatorio entre area.min.x y area.max.x
2. Elegir z aleatorio entre area.min.z y area.max.z
3. Buscar Y válido:
   a. Empezar desde area.max.y hacia abajo
   b. Encontrar el primer bloque sólido con 4 bloques de aire encima
   c. La posición de spawn es (x, y_sólido + 1, z)
4. Si Y está fuera de area.min.y → posición inválida
```

Para rendimiento, no se escanea toda la columna Y. Se muestrea en un rango acotado:

```js
const sampleY = Math.floor(Math.random() * (area.max.y - area.min.y)) + area.min.y;
// Buscar hacia arriba y abajo desde sampleY en un rango de ±10 bloques
```

---

## 6. Control de población

### 6.1 Tracking

Cada mob spawneado recibe un tag identificador: `atomic_spawned_{zoneId}`. Esto permite:
- Contar mobs activos por zona sin mantener estado en memoria.
- Limpiar mobs huérfanos con `dimension.getEntities({ tags: [...] })`.
- Detectar mobs que se mueven fuera de su zona (para despawn o reasignación).

### 6.2 Límites

| Nivel | Configurable | Default | Descripción |
|-------|-------------|---------|-------------|
| Global | `globalMaxMobs` | 80 | Total de mobs custom activos en todo el mundo |
| Por zona | `zone.maxMobs` | 12 | Máximo de mobs custom en una zona específica |
| Por check | `zone.spawnsPerCheck` | 2 | Cuántos mobs intentar spawnear por intervalo |

### 6.3 Despawn automático

Los mobs custom se despawnean si:
- No hay jugadores dentro de `despawnDistance` bloques.
- El mob lleva más de `maxIdleTicks` ticks sin recibir daño ni interactuar (configurable, default 6000 = 5 min).
- El mob quedó fuera de los límites de su zona (migró por pathfinding).

Mobs con `persistent: true` no se despawnean automáticamente.

---

## 7. Instanciación de mob template

### 7.1 Flujo de aplicación de template

```
1. dimension.spawnEntity(template.typeId, validPosition)
2. entity.nameTag = template.nameTag
3. Para cada score en template.scores:
   → scoreboard.getObjective(key).setScore(entity.scoreboardIdentity, value)
4. Para cada slot en template.equipment:
   → crear ItemStack con enchants
   → equippable.setEquipment(slot, itemStack)
5. Para cada tag en template.tags:
   → entity.addTag(tag)
6. Agregar tag de tracking: entity.addTag(`atomic_spawned_${zoneId}`)
7. Configurar comportamiento (si aplica):
   → aggroRange, speedMultiplier via component access
```

### 7.2 Equipment con encantamientos

```js
function createEquippedItem(def) {
  const stack = new ItemStack(def.itemId, 1);
  if (Array.isArray(def.enchants) && def.enchants.length > 0) {
    const enchantable = stack.getComponent("minecraft:enchantable");
    if (enchantable) {
      for (const enc of def.enchants) {
        enchantable.addEnchantment({ type: enc.id, level: enc.level ?? 1 });
      }
    }
  }
  return stack;
}
```

### 7.3 Mapeo de slots

```js
const SLOT_MAP = {
  head:     EquipmentSlot.Head,
  chest:    EquipmentSlot.Chest,
  legs:     EquipmentSlot.Legs,
  feet:     EquipmentSlot.Feet,
  mainhand: EquipmentSlot.Mainhand,
  offhand:  EquipmentSlot.Offhand,
};
```

---

## 8. Condiciones de spawn

### 8.1 Condiciones built-in

| Condición | Campo config | Descripción |
|-----------|-------------|-------------|
| Noche | `nightOnly: true` | Solo spawnea si el time del mundo está entre 13000-23000 |
| Jugador en zona | `requirePlayerInZone: true` | Solo si hay al menos un jugador dentro del bounding box |
| Superficie | `surfaceOnly: true` | Solo si la posición Y está por encima del nivel del mar (Y >= 63) |
| Nivel mínimo | `minPlayerCombatLevel: N` | Solo si el jugador más cercano tiene nivel de combate >= N |
| Distancia jugador | `minPlayerDistance` / `maxPlayerDistance` | Rango de distancia al jugador más cercano |

### 8.2 Evaluación

Todas las condiciones son AND: si cualquiera falla, el spawn de esa zona se salta en ese check.

---

## 9. Debug y observabilidad

### 9.1 Modo debug

Con `spawns.debug: true`:
- Log en consola de cada intento de spawn (posición, template, resultado).
- Log de validaciones fallidas (bloque no sólido, sin espacio, fuera de área).
- Log de población actual por zona.
- Tag visual en mobs spawneados: `debug_spawn_info`.

### 9.2 Script event de diagnóstico

```
/scriptevent atomic:spawns_debug
```

Muestra en chat: jugadores online, presupuesto global actual/máximo, estado de cada zona (activa/inactiva, población actual/máxima, jugadores activando).

---

## 10. Scores en mobs spawneados

### 10.1 Scores por defecto

Todos los mobs spawneados reciben un conjunto de scores por defecto definidos en `spawns.defaultScores`. El score más importante es `H: 1`, que habilita el mob en el sistema de combate (`hasHEnabled()`).

```js
spawns: {
  defaultScores: { H: 1 },
}
```

### 10.2 Scores por template

Cada template puede definir `scores` que sobrescriben los defaults. Si una template no define `scores`, se aplican los `defaultScores`.

```js
templates: {
  guerrero_corrupto: {
    typeId: "minecraft:zombie",
    nameTag: "§cGuerrero Corrupto",
    scores: {
      H: 1,
      DMGH: 15,
      VidaMaxTotalH: 200,
    },
  },
}
```

### 10.3 Scores soportados

| Score | Propósito | Default |
|-------|-----------|---------|
| `H` | Habilita el mob en el sistema de combate | `1` |
| `DMGH` | Daño base del mob al golpear jugadores | — |
| `VidaMaxTotalH` | HP máximo del mob (para barra de vida) | — |
| `Vida` | HP actual del mob (auto-inicializado si `H==1`) | Auto |

### 10.4 Implementación

`applyScores(entity, templateScores, defaultScores)` en `spawner.js`:
1. Fusiona `templateScores` con `defaultScores` (template tiene prioridad).
2. Para cada score: obtiene el objective con `world.scoreboard.getObjective(key)`.
3. Si el objective existe: `objective.setScore(entity.scoreboardIdentity, value)`.
4. Si no existe: lo ignora silenciosamente (el scoreboard debe crearse previamente).

---

## 11. Efectos en mobs spawneados

### 11.1 Configuración

Cada template puede definir `effects` que se aplican al mob inmediatamente después de spawnear.

```js
templates: {
  bruto_infernal: {
    typeId: "minecraft:vindicator",
    nameTag: "§4Bruto Infernal",
    effects: {
      resistance: 2,       // Amplifier 2 = Resistance III
      strength: 1,          // Amplifier 1 = Strength II
    },
  },
}
```

### 11.2 Formato avanzado

Para control granular, cada efecto puede ser un objeto:

```js
effects: {
  resistance: { amplifier: 2, duration: 100000, showParticles: false },
}
```

### 11.3 Duración por defecto

`spawns.defaultEffectDuration` define la duración en ticks cuando se usa el formato simple (número). Default: `2000000000` (~3.17 años, esencialmente permanente).

### 11.4 Implementación

`applyEffects(entity, effects, defaultDuration)` en `spawner.js`:
1. Itera sobre cada entrada en `effects`.
2. Si el valor es un número: aplica como `entity.addEffect(id, defaultDuration, { amplifier: value, showParticles: false })`.
3. Si el valor es un objeto: aplica con los campos `amplifier`, `duration`, `showParticles` especificados.

---

## 12. Takeover de entidades existentes

### 12.1 Concepto

El sistema de takeover permite "capturar" entidades vanilla o de otros add-ons que ya existen en el mundo. Si una entidad tiene el mismo `typeId` Y `nameTag` que un template configurado, se reemplaza por una instancia completa con todos los atributos del template (scores, efectos, equipamiento, tags).

Ejemplo: si existe una araña con `nameTag === "§2Arácnido Venenoso"` y hay un template con `typeId: "minecraft:spider"` y `nameTag: "§2Arácnido Venenoso"`, la araña original se elimina y se reemplaza por una nueva con todos los scores, efectos y equipamiento del template.

### 12.2 Configuración

```js
spawns: {
  takeover: {
    enabled: true,
    tickInterval: 100,       // Cada cuántos ticks escanear
    processedTag: "atomic_takeover_done",  // Tag para marcar ya procesados
  },
}
```

### 12.3 Índice de takeover

`buildTakeoverIndex(templates)` construye un `Map<string, { templateId, template }>` donde la key es `"typeId|||nameTag"`. Esto permite lookup O(1) al escanear entidades.

### 12.4 Flujo

```
1. system.runInterval (cada takeover.tickInterval ticks)
2. Obtener TODAS las entidades de la dimensión (excepto jugadores)
3. Para cada entidad:
   a. Si ya tiene tag "atomic_spawned" → skip (ya es un mob del sistema)
   b. Si ya tiene tag "atomic_takeover_done" → skip (ya procesada)
   c. Construir key: "typeId|||nameTag"
   d. Buscar en takeoverIndex
   e. Si hay match:
  - Guardar posición de la entidad original
  - Aplicar el template directamente sobre la misma entidad
  - Limpiar equipo vanilla o residual antes del equipamiento del template
  - Persistir tag de identidad `atomic_tpl_<templateId>`
      - Agregar tag processedTag
      - Log de debug si está habilitado
4. Si no hay match → skip
```

### 12.5 Función central: applyTemplateToEntity

`applyTemplateToEntity(entity, templateId, template, defaultScores, defaultEffectDuration, zoneId)` aplica:
1. `nameTag` del template
2. Tags del template + `atomic_spawned` + tag de zona (si se proporciona)
3. Tag estable de identidad `atomic_tpl_<templateId>`
4. Scores via `applyScores()`
5. Limpieza síncrona de equipo vanilla o residual
6. Efectos via `applyEffects()`
7. Equipamiento deferred con reintentos y limpieza de slots inesperados

Esta misma función se usa tanto en spawn normal como en takeover, garantizando consistencia.

---

## 13. Áreas reutilizables y presupuesto

### 13.1 Catálogo de áreas

Las áreas se definen en `spawns.areas` como un catálogo reutilizable. Las zonas referencian áreas por `areaId` en lugar de definir `area` inline.

```js
spawns: {
  areas: {
    bosque_sur: {
      min: { x: 100, y: 60, z: 100 },
      max: { x: 300, y: 120, z: 300 },
    },
    mazmorra_norte: {
      min: { x: -50, y: 10, z: 500 },
      max: { x: 50, y: 45, z: 600 },
    },
  },
  zones: [
    { id: "bosque_sur_normales", areaId: "bosque_sur", ... },
    { id: "bosque_sur_elites",  areaId: "bosque_sur", ... },  // misma área, diferentes mobs
  ],
}
```

Múltiples zonas pueden compartir la misma área con diferentes templates, caps y condiciones.

### 13.2 Presupuesto global y distribución

| Config | Default | Descripción |
|--------|---------|-------------|
| `globalMaxMobs` | 40 | Cap absoluto de mobs custom en el mundo |
| `budgetPerPlayer` | 12 | Mobs adicionales permitidos por jugador online |
| `maxSpawnsPerTick` | 4 | Máximo de spawns por tick de intervalo |

**Fórmula de presupuesto efectivo:**
$$\text{budget} = \min(\text{globalMaxMobs},\ \text{budgetPerPlayer} \times \text{players})$$

**Distribución entre zonas activas:**
El budget restante (`effectiveBudget - globalCurrent`) se distribuye equitativamente entre las zonas activas via `computeZoneBudget()`, respetando el `maxPopulation` de cada zona.

### 13.3 Despawn por inactividad

Cuando no hay jugadores activando una zona (fuera del `activationRadius`), todos los mobs de esa zona se eliminan automáticamente. Cuando no hay jugadores online, se eliminan TODOS los mobs spawneados.

Despawn por distancia: cada mob se evalúa individualmente con `shouldDespawn()`:
- `< despawnDistance` → "keep"
- `≥ despawnDistance` y `< instantDespawnDistance` → "despawn"
- `≥ instantDespawnDistance` → "instant" (remove inmediato)

Mobs con tag `atomic_persistent` nunca se despawnean.

### 9.2 Comandos de diagnóstico (vía scriptevent)

| Evento | Acción |
|--------|--------|
| `atomic:spawn_status` | Muestra población actual por zona |
| `atomic:spawn_force {zoneId}` | Fuerza un spawn inmediato en la zona |
| `atomic:spawn_clear {zoneId}` | Elimina todos los mobs custom de una zona |
| `atomic:spawn_pause` | Pausa temporalmente el sistema de spawn |
| `atomic:spawn_resume` | Reanuda el sistema de spawn |

---

## 10. Rendimiento

### 10.1 Presupuesto

| Operación | Costo estimado | Mitigación |
|-----------|---------------|------------|
| `dimension.getBlock()` por validación | ~5 llamadas por candidato | Máximo `maxRetriesPerZone` candidatos por check |
| `dimension.getEntities()` para población | 1 query por zona por check | Tag-based query, acotado por zona |
| `dimension.spawnEntity()` | 1 por mob spawneado | Controlado por `spawnsPerCheck` |
| Score writes | ~3-5 por mob spawneado | Solo al spawnear, no cada tick |

### 10.2 Throttle

- El loop principal corre cada `spawnCheckTicks` (default 100 = 5 segundos).
- Si hay muchas zonas, se puede distribuir el check: una zona por tick de intervalo en round-robin.
- El cleanup de población corre en un intervalo separado más lento (`populationCleanupTicks`).

---

## 11. Integración con combat/ existente

### 11.1 Dependencias

El spawn system **consume** pero no modifica:
- `combat/config.js` → `mobs.templates[]` y `spawns`
- `combat/match.js` → los mobs spawneados matchean automáticamente con `mobXp[]` y `mobLoot[]` porque tienen el `typeId` + `nameTag` correcto
- `damage_dealt/scoreboard.js` → para setear scores (`H`, `DMGH`, `VidaMaxTotalH`)
- `health/` → detecta `H==1` y trackea automáticamente los mobs spawneados

### 11.2 Lo que NO toca

- `calc/`, `damageCancel/`, `damage_title/`, `effects/` — no requieren cambios.
- `xp.js`, `loot.js` — funcionan igual, los mobs spawneados son entidades normales.

### 11.3 Init order

```js
// En main.js
initSkillCombat(combatSkillConfig);    // registra skill + XP + loot
// ... combat subsystems ...
initDamageDealt({ debug: false });     // hook de kill debe existir
initCombatSpawns(combatSkillConfig);   // ← NUEVO: inicia el spawn loop
```

`initCombatSpawns` debe ejecutarse después de que el sistema de combate esté operativo para que los mobs spawneados entren inmediatamente al flujo de damage/health/loot.

---

## 12. Casos de uso

### 12.1 Zombie básico aparece en el bosque

1. Check de spawn: zona "bosque_oscuro" tiene espacio (8/12 mobs).
2. Weighted random selecciona template "zombie_basico" (peso 20).
3. Posición aleatoria: (42, 68, -130) → validación OK (piedra debajo, 4 bloques aire).
4. Spawn: `minecraft:zombie` con `nameTag: "§7Zombie"`, `H: 1`, `DMGH: 5`.
5. Jugador lo encuentra, lo mata → `xp.js` matchea por typeId+nameTag → +XP.

### 12.2 Guardia de Elite en mazmorra

1. Zona "mazmorra_norte" con `requirePlayerInZone: true` y `minPlayerCombatLevel: 10`.
2. Jugador nivel 12 entra a la zona → condición OK.
3. Template "guardia_elite" spawn con armadura de diamante y estadísticas altas.
4. El mob da pelea real gracias a `DMGH: 25` y defensa del equipamiento.
5. Al morir → loot custom + XP alta → progresión satisfactoria.

### 12.3 Despawn por distancia

1. Mob spawneado en zona, jugador se aleja 150 bloques.
2. Cleanup detecta que el jugador más cercano está a > `despawnDistance (128)`.
3. Mob se remueve silenciosamente.
4. Cuando el jugador regrese, el sistema spawneará nuevos mobs frescos.

---

## 13. Archivos a crear

```text
combat/
  spawns/
    index.js          ← initCombatSpawns(): loop principal + scriptevents
    spawner.js        ← selectTemplate(), generateCandidatePosition(), spawnMobFromTemplate()
    validator.js      ← isValidSpawnPosition(), isBlockSolid(), hasAirSpace()
    population.js     ← countZoneMobs(), cleanupPopulation(), shouldDespawn()
```

### Resumen de responsabilidades

| Archivo | Responsabilidad | Dependencias |
|---------|----------------|-------------|
| `index.js` | Bootstrap, loop de spawn, scriptevents de debug | spawner, population, config |
| `spawner.js` | Selección de template, generación de posición, instanciación | validator, config, scoreboard |
| `validator.js` | Validación de terreno (sólido, aire, líquido, área) | Solo APIs del motor |
| `population.js` | Tracking de mobs activos, límites, despawn, cleanup | Solo APIs del motor |

---

## 14. Checklist de implementación

- [ ] Crear `spawns/validator.js` — funciones puras de validación de terreno
- [ ] Crear `spawns/population.js` — tracking y cleanup de población
- [ ] Crear `spawns/spawner.js` — lógica de selección, posición e instanciación
- [ ] Crear `spawns/index.js` — bootstrap, loop, scriptevents
- [ ] Agregar sección `spawns` en `combat/config.js` con al menos 1 zona de ejemplo
- [ ] Poblar `mobs.templates[]` en config con templates funcionales
- [ ] Agregar `initCombatSpawns()` en `main.js` después de `initDamageDealt()`
- [ ] Registrar scoreboards necesarios (si alguno extra)
- [ ] Validar flujo completo: spawn → damage → kill → XP → loot
- [ ] Test de validación de posición con terrenos variados
- [ ] Test de límites de población y despawn
