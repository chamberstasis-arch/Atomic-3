# Sistema de Spawns de Combate (BP)

Ruta: `Atomic BP/scripts/features/skills/combat/spawns/`

## Objetivo
Spawnear mobs personalizados desde templates en zonas 3D definidas, con control de población, equipamiento, scores, efectos y despawn automático basado en proximidad de jugadores.

## Archivos

| Archivo | Responsabilidad |
|---------|----------------|
| `index.js` | Orquestador: loops de spawn, cleanup, despawn, takeover, debug |
| `spawner.js` | Instanciación: selección ponderada, spawn, equipamiento, scores, efectos, takeover |
| `population.js` | Control de población: conteo por zona/global, despawn por distancia, caps |
| `validator.js` | Validación de posiciones: bloque sólido, espacio aéreo, dentro de área |

## Inicialización

```
main.js → initSkillCombat(combatSkillConfig) → initCombatSpawns(config)
```

`initCombatSpawns` registra tres loops con `system.runInterval`:
- **Spawn loop** (cada 60 ticks): busca zonas activas, distribuye budget, spawnea mobs
- **Cleanup loop** (cada 100 ticks): remueve mobs lejos de jugadores
- **Full despawn loop** (cada 200 ticks): remueve mobs de zonas sin jugadores cercanos

Opcionalmente registra el **Takeover loop** (cada 100 ticks): aplica templates a entidades existentes que coincidan en `typeId + nameTag`.

## Configuración

Definida en `config.js` → `combatSkillConfig.spawns`:

```js
spawns: {
    enabled: true,
    dimensionId: "minecraft:overworld",
    spawnTickInterval: 60,
    cleanupTickInterval: 100,
    fullDespawnTickInterval: 200,
    globalMaxMobs: 40,
    budgetPerPlayer: 12,
    activationRadius: 64,
    minPlayerDistance: 16,
    despawnDistance: 96,
    instantDespawnDistance: 160,
    maxAttemptsPerZone: 6,
    maxSpawnsPerTick: 4,
    defaultScores: { H: 1 },
    defaultEffectDuration: 20000000,
    takeover: { enabled: true, tickInterval: 100, processedTag: "atomic_takeover_done" },
    areas: { ... },
    zones: [ ... ],
}
```

### Templates (en `config.mobs.templates`)

```js
guerrero_corrupto: {
    typeId: "minecraft:zombie",
    nameTag: "§cGuerrero Corrupto",
    weight: 10,
    tags: ["combat_mob"],
    scores: { H: 1, DMGH: 15, VidaMaxTotalH: 200 },
    effects: { resistance: 1 },
    equipment: {
        head: { typeId: "minecraft:iron_helmet" },
        chest: { typeId: "minecraft:iron_chestplate" },
        mainhand: { typeId: "minecraft:iron_sword" },
    },
}
```

## Pipeline de Spawn (por tick)

```
1. Obtener jugadores online
2. Calcular budget global: min(globalMaxMobs, players × budgetPerPlayer)
3. Para cada zona habilitada:
   a. Resolver area (por areaId o inline)
   b. Filtrar jugadores dentro de activationRadius → zonas activas
   c. Evaluar condiciones secundarias (hora, nivel mínimo)
4. Para cada zona activa:
   a. Calcular budget de zona: min(maxPopulation - actual, fairShare)
   b. Hasta batchSize intentos:
      i.   selectTemplate(): selección ponderada aleatoria
      ii.  randomPositionInArea() + findValidYFromCandidate(): posición válida
      iii. Verificar minPlayerDistance
      iv.  spawnMobFromTemplate(): crear entidad + applyTemplateToEntity()
```

## Aplicación de Template (applyTemplateToEntity)

### Fase síncrona (tick 0 — inmediata)
Se ejecutan en el MISMO tick que `dimension.spawnEntity()`:

| Propiedad | API | Notas |
|-----------|-----|-------|
| `nameTag` | `entity.nameTag = "..."` | Visible al acercarse al mob |
| Tags | `entity.addTag("atomic_spawned")`, zone tag, tag de template, custom tags | Tracking del sistema |
| Scores | `objective.setScore(entity, value)` | H=1 es obligatorio para el sistema de salud |
| Limpieza de equipo | `setEquipment(slot, undefined)` → `getEquipmentSlot().setItem(undefined)` → comando con `air` | Elimina armadura/armas vanilla o residuales antes del template |
| Efectos | `entity.addEffect(id, duration, opts)` | Se re-aplican en tick +1 como seguridad |

**¿Por qué síncrono?** El sistema de salud (`health/index.js`) usa `afterEvents.entitySpawn` y `scanAndTrackMobs` (cada 40 ticks) para detectar mobs con H=1. Si H se aplica de forma deferred, el mob no es reconocido hasta el siguiente scan.

### Fase deferred (tick +1 — `system.run`)
Se ejecutan en el siguiente tick para dar tiempo a que la entidad se inicialice:

| Propiedad | API | Notas |
|-----------|-----|-------|
| `nameTag` (re-apply) | `entity.nameTag = "..."` | Red de seguridad por si falló en tick 0 |
| Efectos (re-apply) | `entity.addEffect()` | Por si fallaron en tick 0 |
| Equipamiento | `setEquipment()` → `getEquipmentSlot().setItem()` → `item replace` / `replaceitem` | 4 intentos: tick +1, +4, +11, +21 aprox |

### Estrategia de equipamiento (4 intentos)

```
Intento 0 (tick +1): limpiar slots residuales + API setEquipment() → API getEquipmentSlot().setItem() → comandos
Intento 1 (tick +4): mismo flujo
Intento 2 (tick +11): mismo flujo
Intento 3 (tick +21): mismo flujo final
```

Cada intento verifica si el equipamiento esperado está aplicado y, además, que no queden armas/armaduras residuales en slots no definidos por el template.

## Identidad estable del template

Cada mob gestionado recibe un tag estable por template:

```text
atomic_tpl_<templateId_normalizado>
```

Ejemplos:
- `atomic_tpl_guerrero_corrupto`
- `atomic_tpl_arquero_maldito`

Este tag se aplica tanto en spawn normal como en takeover y permite que otros sistemas, en especial `health/syncMobs.js`, puedan revalidar el equipamiento correcto sin volver a deducir el template solo por `typeId + nameTag`.

## Takeover (Superposición)

Escanea entidades en la dimensión cada 100 ticks. Si una entidad coincide en `typeId` + `nameTag` con un template Y no tiene los tags `atomic_spawned` ni `atomic_takeover_done`:

1. Se le aplica el template completo (scores, efectos, equipamiento)
2. Se le agrega el tag `atomic_takeover_done`
3. Se limpian slots residuales antes del equipamiento del template
4. La entidad original NO se elimina — se modifica in-place

**Caso de uso**: entidades creadas por command blocks o sistemas externos que comparten typeId y nameTag con un template.

## Guardia runtime anti-pickup

El sistema de salud en `combat/health/syncMobs.js` actúa también como una capa de seguridad de equipamiento para mobs H=1 ya rastreados:

1. Resuelve el template esperado a partir del tag `atomic_tpl_*`
2. Reaplica slots que el template sí exige si el mob los perdió o los reemplazó
3. Limpia slots no definidos por el template si contienen armas o armaduras recogidas del suelo

Esto protege contra dos casos:
- mobs que nacen con equipamiento vanilla residual
- mobs que recogen espada, arco o armadura de jugadores desde el suelo

## Tags del sistema

| Tag | Propósito |
|-----|-----------|
| `atomic_spawned` | Identifica mobs creados por el sistema de spawns |
| `atomic_spawned_{zoneId}` | Asocia un mob a una zona específica |
| `atomic_tpl_{templateId}` | Identidad estable del template aplicado al mob |
| `atomic_persistent` | Protege al mob del despawn automático |
| `atomic_takeover_done` | Marca una entidad como ya procesada por takeover |
| `combat_mob` | Tag custom definido en templates |
| `elite` | Tag custom definido en templates de élite |

## Scoreboards requeridos

Se crean automáticamente via `getObjectiveBestEffort()` si no existen:
- `H` — flag de sistema de combate (H=1 = mob activo)
- `DMGH` — daño del mob
- `VidaMaxTotalH` — salud máxima custom
- `SkillLvlCombate` — nivel de combate del jugador (para condiciones de zona)

## Sistema de debug

### Activación
En `config.js`:
```js
debug: { enabled: true },
```

### Mensajes de debug

Cuando está activado, el spawner emite mensajes con prefijo `§8[Spawner]`:

| Prefijo | Significado |
|---------|-------------|
| `[Spawn]` | Entidad creada via spawnEntity |
| `[Template]` | Aplicación de template iniciada |
| `clear <slot>` | Limpieza de equipo vanilla o residual por slot |
| `nameTag =` | nameTag asignado exitosamente |
| `Scores: N ok, M fail` | Resultado de aplicación de scores |
| `Efectos: N ok, M fail` | Resultado de aplicación de efectos |
| `Equipment intento X/3` | Estado de cada intento de equipamiento |
| `[Deferred]` | Callback deferred ejecutándose |
| `Takeover:` | Entidad tomada por el sistema |

Además, el orquestador (`index.js`) emite con prefijo `§8[Spawns]`:
- Spawn confirmados con posición y zona
- Cleanup/despawn counts
- Budget y estado de zonas (via script event `atomic:spawns_debug`)

### Script event de diagnóstico

Ejecutar en chat: `/scriptevent atomic:spawns_debug`

Muestra: cantidad de jugadores, budget global, estado de cada zona (ACTIVE/INACTIVE/DISABLED, población, jugadores cercanos).

## Interacción con otros sistemas

| Sistema | Cómo interactúa |
|---------|-----------------|
| **Health** (`combat/health/`) | Detecta mobs con H=1 via `scanAndTrackMobs` (cada 40 ticks). Inicializa Vida/VidaMaxTotalH, sincroniza HP vanilla y revalida el equipamiento según el template persistido. |
| **Loot** (`combat/loot.js`) | Procesa drops custom al morir un mob con H=1. Suprime drops vanilla si hay entrada en `mobLoot`. |
| **XP** (`combat/xp.js`) | Otorga XP de combate al jugador que mata un mob con H=1. |
| **Damage** (`combat/damageCancel/`) | Cancela daño letal a jugadores con H=1 (no afecta mobs). |

## Validación de posiciones

`validator.js` verifica:
1. Posición dentro del bounding box del área
2. Bloque sólido debajo (y-1)
3. No líquido debajo
4. 4 bloques de aire desde la posición (y, y+1, y+2, y+3) — espacio para mobs altos

`findValidYFromCandidate` escanea hacia abajo desde la Y candidata buscando suelo válido.

## Límites y caps

- **Global**: `globalMaxMobs` (40) total de mobs custom
- **Budget por jugador**: `budgetPerPlayer` (12) × jugadores online
- **Budget efectivo**: `min(globalMaxMobs, players × budgetPerPlayer)`
- **Por zona**: `maxPopulation` individual
- **Por tick**: `maxSpawnsPerTick` (4) máximo total de spawns por tick
- **Batch por zona**: `spawnBatchSize` (1-2) por ciclo

## Despawn

1. **Distancia** (cada 100 ticks): mobs > `despawnDistance` (96) del jugador más cercano → removidos
2. **Distancia instantánea**: mobs > `instantDespawnDistance` (160) → removidos inmediatamente
3. **Zona inactiva** (cada 200 ticks): si no hay jugadores en `activationRadius` del centro del área → todos los mobs de esa zona removidos
4. **Sin jugadores**: si no hay jugadores online → TODOS los mobs custom removidos
5. **Excepción**: mobs con tag `atomic_persistent` nunca se despawnean automáticamente
