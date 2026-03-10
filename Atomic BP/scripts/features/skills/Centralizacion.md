# Plan de Centralizacion — skills/

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

> Estado del documento: referencia historica y tecnica.
>
> Este archivo ya no es el documento rector de `skills/`. Se conserva porque contiene contexto tecnico util, riesgos detectados y decisiones de centralizacion, pero si entra en conflicto con documentos mas nuevos deben prevalecer:
>
> 1. `MIGRACION_CORE_SKILLS.md`
> 2. `core/README.md`
> 3. La documentacion vigente de cada modulo consumidor o motor global
>
> En otras palabras: `Centralizacion.md` ya no define por si solo la arquitectura actual; hoy funciona como referencia de transicion y archivo de apoyo para la migracion.

Documento de diseño para la reestructuración del directorio `Atomic BP/scripts/features/skills/`. Define los cambios arquitectónicos, el nuevo modelo de scoreboards y el plan de migración.

---

## 1. Problema actual

La lectura de estadísticas del lore y la escritura de scoreboards están dispersas entre `calc/` y `combat/`:

- `calc/loreParser.js` parsea el lore pero solo extrae 8 de 16 estadísticas.
- `calc/index.js` lee equipment, parsea, calcula fórmulas de daño **y** escribe scoreboards — todo en un solo loop.
- `calc/totals.js` suma stats de gear pero solo para las que `loreParser` conoce.
- Los módulos de `combat/` (damage_dealt, health, effects) consumen scoreboards, pero la cadena lectura → cálculo → escritura no tiene separación clara.
- Las estadísticas de profesiones (minería, tala, cosecha) no tienen lectura centralizada; cada skill tendría que reimplementar el parsing.

- `calc/index.js` usa `cfg.formula.power` (hardcoded a `0`) en vez de `gear.power` del lore. **Poder es código muerto** en la fórmula actual.
- `Dano Verdadero` se parsea y suma pero **nunca se escribe a ningún scoreboard** ni tiene consumidor.
- Los multiplicadores `MAH`/`MMH` se escriben con defaults y se leen como scoreboards, pero la inicialización vive en `calc/index.js` (función `ensureDefaultMultiplierScores`) en vez de en `scoreboards/catalog.js`.
- Cada sub-módulo de `combat/` hardcodea sus propias constantes con IDs de scoreboard (ej. `OBJ_DEF_TOTAL = "DtotalH"` en `damage_dealt/scoreboard.js`). No existe una fuente única de verdad compartida.

**Consecuencia**: agregar una nueva estadística requiere modificar `loreParser.js`, `totals.js`, `config.js` y potencialmente `index.js`. No existe un solo punto donde registrar una stat nueva.

---

## 2. Objetivos

1. **Separar la lectura del lore** de la lógica de cálculo de daño. Crear un módulo `lecture/` dedicado exclusivamente a leer equipamiento, parsear lore y escribir scoreboards de capa Equipamiento.
2. **Adoptar el modelo de 4 capas** (Personal, Equipamiento, Otros, Total) para todas las estadísticas, con nomenclatura uniforme.
3. **Mover `calc/` dentro de `combat/`** para reflejar que las fórmulas de daño son parte del sistema de combate.
4. **Refactorizar `calc/` y `combat/`** para que consuman datos producidos por `lecture/` en vez de parsear lore directamente.
5. **Facilitar la extensión**: agregar una nueva estadística debe requerir solo una entrada en el registro, sin tocar lógica de parsing ni de cálculo.
6. **Preparar un `skills/core/` reutilizable** para progreso, niveles, recompensas y mensajes de skills no-combate.
7. **Evitar que los módulos de skills creen objectives** fuera de `scripts/scoreboards/`.

---

## 3. Estructura planificada

```text
skills/
  Centralizacion.md          ← Este documento
  MIGRACION_CORE_SKILLS.md   ← Documento rector de migración vigente
  README.md                  ← Índice general de skills (existente)
  core/                      ← NUEVO: progreso compartido de skills
    README.md
    index.js
    registry.js
    progression.js
    rewards.js
    titles.js
    scoreboards.js
  lecture/                   ← NUEVO: lectura centralizada de lore
    README.md
    index.js                 ← Entry-point: initLecture(); loop de lectura
    config.js                ← Configuración (tick rate, objectives)
    statRegistry.js          ← Catálogo de estadísticas (data-driven)
    loreParser.js            ← Parsing genérico (migrado y ampliado desde calc/)
    equipmentReader.js       ← Lectura de 6 slots (migrado desde calc/)
    totals.js                ← Suma de stats por capa
    scoreboard.js            ← Helpers de scoreboard (reutilizados desde calc/)
  combat/
    README.md                ← Documento master del sistema de combate
    calc/                    ← MOVIDO desde skills/calc/
      README.md
      config.js
      index.js               ← Solo fórmulas de daño; lee de scoreboards, no de lore
      utilMath.js
      scoreboard.js          ← Se puede reutilizar o importar de lecture/
    health/
    damage_dealt/
    damage_title/
    damageCancel/
    effects/
    defense/
  mining/
  foraging/
  farming/
  fishing/
  regeneration/
```

---

## 4. Modelo de estadísticas (4 capas)

### 4.1 Capas

Cada estadística se descompone en cuatro scoreboards aditivos:

| Capa | Sufijo | Fuente | Escritor | Ejemplo (Daño) |
|---|---|---|---|---|
| **Personal** | `PersonalH` | Editable por comandos o scripts | Manual / sistemas de progresión | `DanoPersonalH` |
| **Equipamiento** | `EquipamientoH` | Suma del lore de los 6 slots | `lecture/` (automático) | `DanoEquipamientoH` |
| **Otros** | `OtrosH` | Buffs, efectos, habilidades | Sistemas externos | `DanoOtrosH` |
| **Total** | `TotalH` | Suma de las 3 capas anteriores | `lecture/` o `calc/` (automático) | `DanoTotalH` |

$$
\text{Total} = \text{Personal} + \text{Equipamiento} + \text{Otros}
$$

> Todos los IDs de scoreboards usan ASCII (sin ñ ni acentos). Ejemplo: `DanoTotalH`, no `DañoTotalH`.

### 4.2 Catálogo completo de estadísticas

Las 18 estadísticas soportadas, con sus scoreboards por capa:

| # | Estadística | ID base | Tipo | PersonalH | EquipamientoH | OtrosH | TotalH |
|---|---|---|---|---|---|---|---|
| 1 | Poder ³ | `Poder` | int | `PoderPersonalH` | `PoderEquipamientoH` | `PoderOtrosH` | `PoderTotalH` |
| 2 | Vida | `Vida` | int | `VidaMaxH` ¹ | `VidaEquipamientoH` | `VidaOtrosH` | `VidaMaxTotalH` ¹ |
| 3 | Defensa | `Defensa` | int | `DefensaPersonalH` | `DefensaEquipamientoH` | `DefensaOtrosH` | `DefensaTotalH` |
| 4 | Daño | `Dano` | int | `DanoPersonalH` | `DanoEquipamientoH` | `DanoOtrosH` | `DanoTotalH` |
| 5 | Daño Crítico | `DanoCrit` | float→int | `DanoCritPersonalH` | `DanoCritEquipamientoH` | `DanoCritOtrosH` | `DanoCritTotalH` |
| 6 | Prob. Crítica | `ProbCrit` | float→int | `ProbCritPersonalH` | `ProbCritEquipamientoH` | `ProbCritOtrosH` | `ProbCritTotalH` |
| 7 | Daño Verdadero ⁴ | `DanoVerd` | int | `DanoVerdPersonalH` | `DanoVerdEquipamientoH` | `DanoVerdOtrosH` | `DanoVerdTotalH` |
| 8 | Mana | `Mana` | int | `ManaPersonalH` | `ManaEquipamientoH` | `ManaOtrosH` | `ManaTotalH` |
| 9 | Fortuna Minera | `FortMin` | int | `FortMinPersonalH` | `FortMinEquipamientoH` | `FortMinOtrosH` | `FortMinTotalH` |
| 10 | Exp. Minera | `ExpMin` | int | `ExpMinPersonalH` | `ExpMinEquipamientoH` | `ExpMinOtrosH` | `ExpMinTotalH` |
| 11 | Fortuna de Tala | `FortTal` | int | `FortTalPersonalH` | `FortTalEquipamientoH` | `FortTalOtrosH` | `FortTalTotalH` |
| 12 | Frenesí de Tala | `FrenTal` | int | `FrenTalPersonalH` | `FrenTalEquipamientoH` | `FrenTalOtrosH` | `FrenTalTotalH` |
| 13 | Exp. de Talado | `ExpTal` | int | `ExpTalPersonalH` | `ExpTalEquipamientoH` | `ExpTalOtrosH` | `ExpTalTotalH` |
| 14 | Fortuna Cosecha | `FortCos` | int | `FortCosPersonalH` | `FortCosEquipamientoH` | `FortCosOtrosH` | `FortCosTotalH` |
| 15 | Mutación Activa | `MutAct` | float→int | `MutActPersonalH` | `MutActEquipamientoH` | `MutActOtrosH` | `MutActTotalH` |
| 16 | Exp. de Cosecha | `ExpCos` | int | `ExpCosPersonalH` | `ExpCosEquipamientoH` | `ExpCosOtrosH` | `ExpCosTotalH` |
| 17 | Mult. Aditivo | `MA` | float→int(×10) | `MAH` ² | `MAEquipamientoH` | `MAOtrosH` | `MATotalH` |
| 18 | Mult. Multiplicativo | `MM` | float→int(×10) | `MMH` ² | `MMEquipamientoH` | `MMOtrosH` | `MMTotalH` |

> ¹ Vida usa `VidaMaxH` (personal) y `VidaMaxTotalH` (total) por retrocompatibilidad con `health/`.

> ² `MAH` y `MMH` conservan su nombre por retrocompatibilidad. Codificación ×10: valor `10` = ×1.0, valor `15` = ×1.5. Se inicializan con default `10` desde `scoreboards/catalog.js`.

> ³ **Poder**: actualmente código muerto. `calc/index.js` usa `cfg.formula.power = 0` en vez de leer `gear.power` del lore. La migración debe conectar `PoderTotalH` a la fórmula de daño (ver §11, punto 2).

> ⁴ **Daño Verdadero**: se parsea del lore pero **no tiene consumidor**. Ningún módulo lo lee ni lo escribe a scoreboards. Debe definirse su mecánica de daño antes de la migración o mantenerlo como reservado (ver §11, punto 3).

> `float→int`: el lore permite decimales, pero el scoreboard almacena `Math.floor(valor)`. Para los multiplicadores, se almacena `Math.floor(valor × 10)`.

### 4.3 Scoreboards que se mantienen sin cambios

Estos scoreboards **no** siguen la convención de 4 capas porque tienen semántica propia:

| Scoreboard | Descripción | Módulo dueño |
|---|---|---|
| `H` | Gate global (1 = activo) | Todos |
| `HDead` | Flag de muerte lógica | `combat/health` |
| `Vida` | Vida actual de la entidad | `combat/health` |
| `VidaAbsorcion` | Absorción temporal | `combat/health` |
| `DanoFinalSC` | Daño final sin crítico (fórmula) | `combat/calc` |
| `DanoFinalCC` | Daño final con crítico (fórmula) | `combat/calc` |
| `Eff*` | Duración de efectos custom | `combat/effects` |

> `DanoFinalSC` y `DanoFinalCC` **no son "totales"** de capa; son el resultado de aplicar la fórmula de daño sobre `DanoTotalH`, `PoderTotalH`, `MATotalH` y `MMTotalH`. Por eso permanecen separados.

### 4.4 Multiplicadores — modelo de capas especial

Los multiplicadores `MA` (Aditivo) y `MM` (Multiplicativo) se integran al modelo de 4 capas con las siguientes particularidades:

1. **Codificación ×10**: un valor de scoreboard `10` equivale a `1.0×`. Esto permite representar decimales (ej. `15` = `1.5×`) sin usar floats en scoreboards.
2. **Default Personal = 10**: la capa Personal (`MAH`, `MMH`) se inicializa en `10` (= ×1.0) desde `scoreboards/catalog.js`. Si un jugador no tiene bonificaciones externas, el multiplicador no altera la fórmula.
3. **Lore opcional**: actualmente **ningún** item incluye etiquetas de multiplicador en el lore. La capa Equipamiento será `0` hasta que se implemente. `lecture/` debe estar preparado para leerlos del lore cuando se añadan las etiquetas.
4. **Suma de capas**: al igual que las demás stats, $\text{Total} = \text{Personal} + \text{Equipamiento} + \text{Otros}$. `combat/calc/` lee `MATotalH` y `MMTotalH` para la fórmula de daño.
5. **Impacto en la fórmula**: `calc/` actualmente lee `MAH` y `MMH` directamente. Tras la migración, lee `MATotalH` y `MMTotalH`, que contienen la suma de las 3 capas. Esto permite que buffs (capa Otros) o items futuros (capa Equipamiento) modifiquen los multiplicadores sin tocar la lógica de `calc/`.

---

## 5. Formato de lore (especificación de lectura)

### 5.1 Cómo llega el lore

`item.getLore()` retorna un `string[]` donde cada elemento es una línea. Las líneas vacías llegan como `""`.

### 5.2 Secciones del lore

Un item con lore completo tiene 4 secciones separadas por líneas vacías:

| Sección | Contenido | ¿Se parsea? |
|---|---|---|
| 1. Estadísticas | Líneas con etiqueta + valor numérico | **Sí** |
| 2. Encantamientos | Líneas con nombres de enchants estéticos | No |
| 3. Descripción | Texto de flavor libre | No |
| 4. Rareza + flags | Rareza del item (obligatoria en items upgradeables) | No |

Solo la sección 1 importa para `lecture/`.

### 5.3 Formato de una línea de estadística

```text
§r§<prefijo>§7<Etiqueta>: §<color>+<Total><emoji> §<c1>[+<S1>] §<c2>[+<S2>] §<c3>(+<S3>)
```

Donde:
- `<Etiqueta>` es la clave estable de parsing (ej. `Daño`, `Vida`, `Probabilidad Crítica`).
- `<Total>` es el valor numérico principal (**único valor que importa para capa Equipamiento**).
- `<S1>`, `<S2>`, `<S3>` son sumatorios internos del item (canales de mejoras). **Se ignoran para el cálculo de Equipamiento.** Solo los consume el sistema de upgrades.
- Los colores (`§x`), emojis y prefijos `§r` **no se usan para parsing**.

### 5.4 Reglas de parsing

1. **Normalizar**: strip `§.` (regex `/§./g`), colapsar espacios, trim.
2. **Buscar por etiqueta** al inicio de la línea normalizada (case-insensitive).
3. **Extraer Total**: primer número después de `:` → regex `/[:]\s*\+?\s*([0-9]+(?:[.,][0-9]+)?)/`.
4. **Tolerancia**: si la etiqueta no existe o el número no se parsea, la stat aporta 0.

### 5.5 Ejemplo completo de lore (referencia)

```text
§r§7Poder: §c+99

§r§c§7Vida: §c+999 §e[+99] §6[+99] §9(+99)
§r§9§7Defensa: §7+100 §e[+99] §6[+99] §9(+99)
§r§9§7Daño: §c+999 §c[+99] §6[+99] §9(+99)
§r§9§7Daño Crítico: §9+999 §9(+99)
§r§9§7Probabilidad Crítica: §9+999.9 §9(+99)
§r§9§7Daño Verdadero: §f+10 §i[+99]
§r§i§7Mana: §d+999 §u(+99)
§r§u§7Fortuna Minera: §6+999 §e[+99] §g[+99] §p(+99)
§r§p§7Experiencia Minera: §3+999 §s[+99]
§r§s§7Fortuna de Tala: §6+999 §e[+99] §g[+99] §p(+99)
§r§p§7Frenesí de Tala: §e+999 §p[+99]
§r§p§7Experiencia de Talado: §3+999 §s[+99]
§r§s§7Fortuna de Cosecha: §6+999 §e[+99] §g[+99] §p(+99)
§r§p§7Mutación Activa: §a+999.9 §2[+99] §q(+99)
§r§q§7Experiencia de Cosecha: §3+999 §s[+99]

§r§s§9Filo VII, Primer Golpe IV
§r§9Critico VIII, Aspecto Ígneo III§9
§r§9Castigo V, Perdición de los Artrópodos VIII
...

§r§9§o§8Esta cosa fue hecha por y para el flameante,
§r§8insurgente y decadente imperio...

§r§8§d§lMíTICO
```

> Un item puede contener **ninguna, algunas o todas** las estadísticas. El parser debe ser tolerante.

### 5.6 Modelo de sumatorios (S1, S2, S3)

> **Para `lecture/`, los sumatorios se ignoran.** Esta sección es referencia para otros sistemas (upgrades).

Cada línea de estadística puede tener hasta 3 sumatorios que representan aportes de mejoras:

$$
Total = Base + S1 + S2 + S3
$$

| Canal | Delimitador | Ejemplo |
|---|---|---|
| S1 | `[+N]` | `§c[+99]` |
| S2 | `[+N]` (segundo) | `§6[+99]` |
| S3 | `(+N)` | `§9(+99)` |

Si un sumatorio es 0, se omite por completo (no se imprime el delimitador).

### 5.7 Convención de colores (escritura)

Esta tabla es para **escritura del lore** (no para parsing). Define los colores por estadística y canal:

| Etiqueta | Total | S1 `[...]` | S2 `[...]` | S3 `(...)` |
|---|:---:|:---:|:---:|:---:|
| Poder | `§c` | — | — | — |
| Vida | `§c` | `§e` | `§6` | `§9` |
| Defensa | `§7` | `§e` | `§6` | `§9` |
| Daño | `§c` | `§c` | `§6` | `§9` |
| Daño Crítico | `§9` | — | — | `§9` |
| Probabilidad Crítica | `§9` | — | — | `§9` |
| Daño Verdadero | `§f` | `§i` | — | — |
| Mana | `§d` | — | — | `§u` |
| Fortuna Minera | `§6` | `§e` | `§g` | `§p` |
| Experiencia Minera | `§3` | `§s` | — | — |
| Fortuna de Tala | `§6` | `§e` | `§g` | `§p` |
| Frenesí de Tala | `§e` | `§p` | — | — |
| Experiencia de Talado | `§3` | `§s` | — | — |
| Fortuna de Cosecha | `§6` | `§e` | `§g` | `§p` |
| Mutación Activa | `§a` | `§2` | — | `§q` |
| Experiencia de Cosecha | `§3` | `§s` | — | — |

---

## 6. Diseño de `lecture/`

### 6.1 Responsabilidades

`lecture/` se encarga de:

1. Leer los 6 slots de equipamiento del jugador (mainhand, offhand, 4 armaduras).
2. Parsear **todas** las estadísticas del lore de cada item (las 18 del catálogo, incluyendo multiplicadores cuando existan en el lore).
3. Sumar los valores Total de cada slot para obtener el **Equipamiento** por stat.
4. Escribir los scoreboards de capa **Equipamiento** (`<Id>EquipamientoH`).
5. Leer las capas **Personal** y **Otros** desde scoreboards.
6. Calcular y escribir la capa **Total** (`<Id>TotalH = Personal + Equipamiento + Otros`).

### 6.2 Lo que `lecture/` NO hace

- No aplica fórmulas de daño (eso es `combat/calc/`).
- No escribe `DanoFinalSC` / `DanoFinalCC` (eso es `combat/calc/`).
- No aplica los multiplicadores en la fórmula de daño (eso es `combat/calc/`). Sin embargo, `lecture/` **sí** lee y escribe las capas Equipamiento/Total de `MA` y `MM` como cualquier otra stat del catálogo (ver §4.4).
- No gestiona vida (`Vida`, `VidaAbsorcion`) ni muerte (eso es `combat/health/`).

### 6.3 `statRegistry.js` — Catálogo data-driven

Archivo central que define todas las estadísticas. Agregar una stat nueva solo requiere una entrada aquí:

```js
// Ejemplo conceptual
export const STAT_REGISTRY = [
  {
    id: "Dano",
    label: "Daño:",           // Etiqueta del lore (para parsing)
    type: "int",              // "int" | "float"
    personal: "DanoPersonalH",
    equipamiento: "DanoEquipamientoH",
    otros: "DanoOtrosH",
    total: "DanoTotalH",
  },
  {
    id: "Vida",
    label: "Vida:",
    type: "int",
    personal: "VidaMaxH",             // Retrocompat
    equipamiento: "VidaEquipamientoH",
    otros: "VidaOtrosH",
    total: "VidaMaxTotalH",           // Retrocompat
  },
  {
    id: "ProbCrit",
    label: "Probabilidad Crítica:",
    type: "float",
    personal: "ProbCritPersonalH",
    equipamiento: "ProbCritEquipamientoH",
    otros: "ProbCritOtrosH",
    total: "ProbCritTotalH",
  },
  {
    id: "MA",
    label: "Multiplicador Aditivo:", // Sin lore actualmente; reservado
    type: "float",
    x10: true,                       // Codificación ×10
    defaultPersonal: 10,             // 10 = ×1.0
    personal: "MAH",                 // Retrocompat
    equipamiento: "MAEquipamientoH",
    otros: "MAOtrosH",
    total: "MATotalH",
  },
  // ... 12 stats más
];
```

### 6.4 Ciclo de ejecución

```text
Cada N ticks (configurable, ej. 10):
  Para cada jugador con H == 1:
    1. Leer equipamiento (6 slots) + construir firma de cache
       ├─ Firma no cambió → skip lectura de lore (usar cache)
       └─ Firma cambió → parsear lore de cada item

    2. Para cada stat en STAT_REGISTRY:
       a. Equipamiento = suma de Total de los 6 items
       b. Personal = leer scoreboard <stat.personal>
       c. Otros    = leer scoreboard <stat.otros>
       d. Total    = Personal + Equipamiento + Otros

    3. Escribir scoreboards (solo si el valor cambió):
       - <stat.equipamiento> = Equipamiento
       - <stat.total> = Total
```

### 6.5 Relación con `calc/`

Después de la migración:

```text
lecture/ escribe:      DanoTotalH, DanoCritTotalH, ProbCritTotalH, PoderTotalH, ...
                              │
                              ▼
calc/ lee:             DanoTotalH, DanoCritTotalH, ProbCritTotalH, PoderTotalH, MATotalH, MMTotalH
calc/ aplica fórmula y escribe:  DanoFinalSC, DanoFinalCC
```

`calc/` se simplifica considerablemente: ya no parsea lore ni lee equipment. Solo lee scoreboards de Total, aplica la fórmula de daño y escribe `DanoFinalSC`/`DanoFinalCC`.

---

## 7. Plan de migración

### Fase 1: Crear `lecture/` con las 18 estadísticas

1. Crear `skills/lecture/` con `statRegistry.js`, `loreParser.js` (ampliado), `equipmentReader.js` (copiado de calc/), `totals.js` y `index.js`.
2. El parser genérico itera sobre `STAT_REGISTRY` en vez de tener bloques hardcodeados por stat.
3. Registrar los 72 scoreboards nuevos (18 stats × 4 capas) en `scoreboards/catalog.js`. **Toda inicialización de objectives se realiza exclusivamente en `scoreboards/catalog.js`** y se materializa por `scoreboards/init.js` (ver §9).
4. Inicializar `lecture/` desde `main.js`.
5. Verificar que los scoreboards de Equipamiento y Total se escriben correctamente.

### Fase 2: Mover `calc/` dentro de `combat/`

1. Mover `skills/calc/` a `skills/combat/calc/`.
2. Actualizar imports en `main.js` y cualquier módulo que importe desde `calc/`.
3. Eliminar de `calc/` la lógica de lectura de lore y equipment — ahora lee de scoreboards `*TotalH`.
4. Simplificar `calc/index.js`: el loop solo lee `DanoTotalH`, `PoderTotalH`, `DanoCritTotalH`, `MATotalH`, `MMTotalH` y calcula `DanoFinalSC`, `DanoFinalCC`.

### Fase 3: Migrar scoreboards legacy

1. Mapear scoreboards antiguos a nuevos (tabla de migración):

| Antiguo | Nuevo | Capa |
|---|---|---|
| `DMGH` | `DanoPersonalH` | Personal |
| `CDH` | `DanoCritPersonalH` | Personal |
| `CCH` | `ProbCritPersonalH` | Personal |
| `DH` | `DefensaPersonalH` | Personal |
| `MH` | `ManaPersonalH` | Personal |
| `VidaMaxH` | `VidaMaxH` (sin cambio) | Personal |
| `DtotalH` | `DefensaTotalH` | Total |
| `MtotalH` | `ManaTotalH` | Total |
| `VidaMaxTotalH` | `VidaMaxTotalH` (sin cambio) | Total |
| `ProbabilidadCriticaTotal` | `ProbCritTotalH` | Total |
| `MAH` | `MAH` (sin cambio) | Personal (×10, default 10) |
| `MMH` | `MMH` (sin cambio) | Personal (×10, default 10) |
| — (nuevos) | `MATotalH`, `MAEquipamientoH`, `MAOtrosH` | Nuevas capas MA |
| — (nuevos) | `MMTotalH`, `MMEquipamientoH`, `MMOtrosH` | Nuevas capas MM |

2. Actualizar todos los consumidores (`damage_dealt`, `health`, `effects`, `mining`, etc.) para leer los nuevos nombres.
3. Remover scoreboards obsoletos de `catalog.js`.

### Fase 4: Adaptar consumidores

### Fase 4.1: Crear `skills/core/`

Antes de extender mineria a tala o cosecha, debe existir un `core/` con responsabilidades acotadas:

- Resolver progreso por `skillId`.
- Calcular siguiente requisito de XP.
- Reconciliar rewards por nivel.
- Exponer hooks reutilizables para scoreboards aplicados desde `regeneration/`.

Este paso es el que evita copiar `mining/` hacia `foraging/`.

### Fase 4.2: Desacoplar `regeneration/` de `mining/`

- Reemplazar imports directos de helpers de mineria por helpers del core.
- El progreso visual debe consultar el core por `skillId`.
- Queda prohibido seguir agregando logica comun de skills dentro de `mining/`.

#### `combat/calc/`

| Aspecto | Antes | Después |
|---|---|---|
| Lectura de multiplicadores | `MAH`, `MMH` (valor directo) | `MATotalH`, `MMTotalH` (capa Total) |
| Lectura de stats | Parseo de lore + equipment | Scoreboards `*TotalH` producidos por `lecture/` |
| Init de defaults | `ensureDefaultMultiplierScores()` escribe `10` en `MAH`/`MMH` | `scoreboards/catalog.js` inicializa `MAH`/`MMH` con default `10` al arranque |
| Escritura | `DanoFinalSC`, `DanoFinalCC` | Sin cambio |

Eliminar toda lógica de lectura de lore y equipment de `calc/`. Se convierte en un consumidor puro de scoreboards `*TotalH`.

#### `combat/damage_dealt/`

| Aspecto | Antes | Después |
|---|---|---|
| Defensa del target | `DtotalH` | `DefensaTotalH` |
| Prob. Crítica | `ProbabilidadCriticaTotal` | `ProbCritTotalH` |
| Daño final | `DanoFinalSC` / `DanoFinalCC` | Sin cambio |

#### `combat/health/`

Sin cambios de scoreboards. Lee `VidaMaxTotalH`, `Vida`, `VidaAbsorcion` y `HDead` — todos conservan su nombre. Verificar que la inicialización de estos objectives se haya trasladado a `scoreboards/catalog.js`.

#### `combat/defense/`

| Aspecto | Antes | Después |
|---|---|---|
| Defensa total | `DtotalH` | `DefensaTotalH` |

#### `combat/effects/`

Sin cambios de scoreboards. Lee `Vida` y `VidaMaxTotalH` directamente (nombres estables).

#### `combat/damageCancel/` y `combat/damage_title/`

Sin cambios directos de scoreboards. Revisar que no haya lecturas hardcodeadas de nombres legacy.

#### Consumidores fuera de `combat/`

1. `skills/mining/`: consumir `FortMinTotalH`, `ExpMinTotalH` de scoreboards producidos por `lecture/` y delegar progreso al `core/`.
2. `skills/farming/`: consumir `FortCosTotalH`, `MutActTotalH`, `ExpCosTotalH` y delegar progreso al `core/`.
3. `skills/foraging/`: consumir `FortTalTotalH`, `FrenTalTotalH`, `ExpTalTotalH`, usar `regeneration/` para spread y delegar progreso al `core/`.

---

## 8. Equipamiento leído

Se leen **6 slots** del jugador vía `EntityEquippableComponent.getEquipment(slot)`:

| Slot | Nota |
|---|---|
| `EquipmentSlot.Mainhand` | Si el item es armadura wearable, se ignora (aporta 0) |
| `EquipmentSlot.Offhand` | — |
| `EquipmentSlot.Head` | — |
| `EquipmentSlot.Chest` | — |
| `EquipmentSlot.Legs` | — |
| `EquipmentSlot.Feet` | — |

Detección de armadura en mainhand:
1. Componente `minecraft:wearable` con slot `slot.armor.*`.
2. Fallback: `typeId` termina en `_helmet`, `_chestplate`, `_leggings` o `_boots`.

Cache de equipamiento:
- Firma: `<typeId>|<nameTag>|<lore.join("\\n")>` por slot.
- Si la firma combinada de los 6 slots no cambió, no se re-parsea.

---

## 9. Compatibilidad y restricciones

- **Inicialización centralizada de scoreboards**: todos los objectives se definen y registran **exclusivamente** en `Atomic BP/scripts/scoreboards/catalog.js`. Ningún módulo debe crear o inicializar objectives por su cuenta; solo consume los que `catalog.js` registra al arranque del mundo. Esto incluye los 72 scoreboards del modelo de 4 capas, los scoreboards auxiliares de combate (`DanoFinalSC`, `DanoFinalCC`, etc.) y cualquier otro objective del proyecto.
- **`skills/core/` también está sujeto a esta regla**: aunque concentre lógica de progreso, no puede crear objectives ni inicializaciones alternativas.
- **Solo Script API estable** (`@minecraft/server` 2.4.0). Sin APIs experimentales.
- **Sin dynamic properties**: bajo ninguna circunstancia se almacenan estadísticas, cache persistente ni estado de jugador en dynamic properties de entidad o mundo. Todo el estado numérico va en scoreboards; todo el estado transitorio va en `Map` en memoria (se pierde al recargar el mundo, se reconstruye en el siguiente tick).
- **IDs ASCII** para scoreboards y archivos (sin ñ, acentos ni caracteres especiales).
- **Longitud de IDs de scoreboard**: verificar el límite del motor antes de codificar. Actualmente `ProbabilidadCriticaTotal` (25 chars) funciona en producción, lo que confirma que el límite de Bedrock Script API es ≥25 caracteres. Todos los nombres planificados del modelo de 4 capas están por debajo de 25 chars (el más largo es `DanoCritEquipamientoH` con 21). Aun así, si se necesita acortar la convención, el sufijo `EquipamientoH` (13 chars) puede abreviarse a `EqH` (3 chars) sin pérdida de claridad en el `statRegistry`.
- **Gate `H == 1`**: toda la cadena (lectura, cálculo, combate) requiere `H == 1`. Los sub-módulos deben verificar esta condición antes de leer o escribir scoreboards. Excepción actual: `ensureDefaultMultiplierScores` en `calc/` escribe defaults sin verificar H — la migración debe corregir esto delegando los defaults a `catalog.js`.
- **Scores enteros**: aunque el lore permita floats (Probabilidad Crítica, Mutación Activa), los scoreboards almacenan `Math.floor(valor)`.
- **Clamp int32**: todos los valores se clampean a `[-2147483648, 2147483647]` antes de escribir. Actualmente **solo `calc/scoreboard.js` aplica `clampInt32`**; los demás módulos (`damage_dealt`, `health`, `effects`) usan `Math.trunc` solo. La migración debe unificar el clamp en todos los escritores de scoreboards.
- **Orden de inicialización**: `scoreboards/catalog.js` debe ejecutarse **antes** de que cualquier módulo intente leer o cachear objectives. Si un módulo cachea `null` antes de que el catálogo cree los objetivos (bug actual en `damage_dealt/scoreboard.js`), el cache queda envenenado permanentemente. La migración debe garantizar `initAllScoreboards()` → `initLecture()` → `initCalc()` → `initCombat()` (estricto).
- **Dimensión**: `calc/index.js` usa `world.getDimension("minecraft:overworld")` para el fallback de comandos. Los jugadores en Nether o End no serán encontrados por selectores `@a[name=...]` ejecutados en la overworld. La migración debe obtener la dimensión del jugador (`player.dimension`) si se mantiene el fallback por comando.
- **Sin múltiples fuentes de verdad para IDs**: tras la migración, todos los módulos importan IDs de scoreboards desde `statRegistry.js` o desde un módulo compartido de constantes. Queda prohibido hardcodear IDs de scoreboard en constantes locales (patrón actual en `damage_dealt/scoreboard.js`, `health/scoreboards.js`, `effects/scoreboard.js`).

---

## 10. Recomendaciones de implementación

### 10.1 Estructuras de datos

- **`STAT_REGISTRY` como array de objetos planos**: fácil de iterar, filtrar y serializar. Evitar clases.
- **`Map<string, PlayerLectureCache>`** para cache de lectura por jugador (mismo patrón que `calc/index.js`).
- **Resultados de parsing como objetos planos**: `{ [statId]: number }`. Sin clases de transferencia.

### 10.2 Patrones

- **Registry Pattern**: `statRegistry.js` como fuente única de verdad para las 18 stats (incluye multiplicadores).
- **Pipeline**: normalización → búsqueda por etiqueta → extracción de número → suma → escritura.
- **Strategy Pattern para consumidores**: cada skill (mining, farming, etc.) declara qué stats `*TotalH` consume.
- **Null Object**: slot vacío devuelve un objeto con todas las stats en 0.

### 10.3 Rendimiento

- **Un solo `system.runInterval`** para `lecture/` (separado del de `calc/`). Ambos pueden tener tick rates diferentes.
- **Cache agresivo**: no re-parsear si el equipment no cambió.
- **Escritura condicional**: no escribir scoreboards si el valor no cambió.
- **Early-exit**: si `H != 1`, saltar jugador inmediatamente.
- **Batch por jugador**: una sola pasada lee todo el equipment, parsea todo el lore y escribe todos los scoreboards. No hacer pasadas separadas por stat.

### 10.4 Testabilidad

- `loreParser.js` y `statRegistry.js` son funciones puras, testeables offline con Node.js.
- Crear strings de lore de prueba (con y sin stats, con valores extremos, con stats faltantes) para validar el parser.
- El modo `debug` de `lecture/` debe imprimir un resumen de stats leídas por jugador (throttled).

### 10.5 Seguridad y robustez

Patrones defensivos obligatorios para toda escritura/lectura de scoreboards y procesamiento de datos:

#### 10.5.1 Clamp int32 universal

Todo valor escrito a un scoreboard debe pasar por `clampInt32` antes de `setScore`. Actualmente solo `calc/scoreboard.js` lo hace. Los demás módulos (`damage_dealt`, `health`, `effects`) usan `Math.trunc` sin verificar límites, lo cual puede causar comportamiento indefinido si un valor desborda el rango int32.

```js
// Patrón obligatorio
function clampInt32(v) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-2147483648, Math.min(2147483647, n));
}
```

La migración debe exportar `clampInt32` desde un módulo compartido (`lecture/utilMath.js` o equivalente) e importarlo en todos los escritores de scoreboards.

#### 10.5.2 Guardas contra NaN e Infinity

Todo valor leído del lore o de un scoreboard debe validarse antes de usar:

- `toNumberOr(value, fallback)`: ya existe en `calc/utilMath.js`. Reutilizar.
- Divisiones: verificar divisor ≠ 0 antes de dividir. Caso específico: `applyDefenseMultiplier` en `damage_dealt/math.js` calcula `75 / (def + 75)`. Si `def = -75`, es división por cero. Actualmente hay guard `if (def <= 0) return base`, pero una defensa negativa (debuff) salta la defensa en vez de amplificar. Documentar este comportamiento como intencional o corregirlo.
- Multiplicadores: `safeMultiplierOr1` en `calc/index.js` ya protege contra 0/NaN/Infinity. Reutilizar este patrón para `MATotalH`/`MMTotalH` después de la migración.

#### 10.5.3 Race condition en escritura de `Vida`

Dos módulos escriben `Vida` en el mismo tick:

- `combat/damage_dealt/` resta daño vía `removeScoreMin0`.
- `combat/effects/tick.js` resta daño periódico calculado.

Si un jugador recibe daño de jugador y de veneno en el mismo tick, el último escritor sobreescribe al anterior. La absorción (`lastVidaByPlayerKey` en `health/syncPlayers.js`) puede calcular mal el daño absorbido.

**Mitigación recomendada**: centralizar la resolución de daño en un único punto por tick. `lecture/` no se ve afectado (no escribe `Vida`), pero `combat/` debe resolver esta carrera durante la refactorización.

#### 10.5.4 Cache de objectives envenenado

`damage_dealt/scoreboard.js` cachea el resultado de `world.scoreboard.getObjective(id)` en un `Map`. Si el objective aún no existe al momento de la primera consulta (**race condition de init**), se cachea `null` y **nunca se reintenta**.

**Contraste**: `effects/scoreboard.js` sí reintenta cuando el valor cacheado es `null`.

**Mitigación**: tras la migración, todos los módulos deben usar un helper compartido de cache con retry-on-null, o bien garantizar el orden estricto de init (§9).

#### 10.5.5 Command fallback y player names

`calc/scoreboard.js` construye selectores como `@a[name=${quoteForCommand(name)}]`. La función `quoteForCommand` solo escapa comillas dobles. Caracteres como `]`, `=` o `\` en el nombre podrían romper la sintaxis del selector.

**Riesgo**: bajo (los gamertags de Bedrock son restrictivos), pero el fallback por comando es inherentemente frágil.

**Mitigación**: preferir siempre la vía API (`scoreboardIdentity.setScore`) e implementar el command fallback como último recurso con validación estricta del nombre.

#### 10.5.6 Gate H en limpieza de efectos

`effects/index.js` llama `clearAllEffectsBestEffort(player)` en el evento `playerSpawn` **sin verificar `H == 1`**. Esto limpia scoreboards de efectos para jugadores fuera del sistema. Puede interferir con testing manual vía comandos.

**Mitigación**: agregar verificación `H == 1` al handler de `playerSpawn` en effects.

#### 10.5.7 Defaults inconsistentes de VidaMax

Tres módulos definen defaults diferentes para `VidaMaxH`/`VidaMaxTotalH`:

| Módulo | Default | Valor |
|---|---|---|
| `health/defaults.js` | `DEFAULT_PLAYER_VIDA_MAX` | 100 |
| `calc/config.js` | `vidaMaxTotal.defaultBaseVidaMax` | 0 |
| `damage_dealt/scoreboard.js` | `config?.defaultPlayerVidaMaxTotal` | 100 |

Si `calc/` inicializa primero con default 0 y `health/` aún no ha corrido, `VidaMaxTotalH` será 0 y el jugador sería inmortal (división por 0 en lógica de muerte).

**Mitigación**: un único default en `statRegistry.js` (ej. `defaultPersonal: 100` para Vida). Todos los módulos lo importan de ahí.

#### 10.5.8 No usar dynamic properties

Bajo ninguna circunstancia almacenar estadísticas, caches persistentes o estado de jugador en:
- `entity.setDynamicProperty()`
- `world.setDynamicProperty()`

Todo el estado numérico debe ir en scoreboards. El estado transitorio (caches, firmas de equipment) va en `Map` en memoria y se reconstruye automáticamente en el primer tick tras recargar el mundo.

---

## 11. Consideraciones previas a la codificación

Checklist de decisiones y verificaciones que deben resolverse **antes** de implementar el código de la migración:

### 1. Verificar límite de longitud de scoreboard IDs en Bedrock

El nombre más largo actualmente en producción es `ProbabilidadCriticaTotal` (25 chars) y funciona. Confirmar que todos los nombres planificados (máx 21 chars: `DanoCritEquipamientoH`) quedan dentro del límite. Si se descubre un límite más bajo, aplicar la convención corta:

| Sufijo largo | Sufijo corto | Ejemplo |
|---|---|---|
| `EquipamientoH` (14 chars) | `EqH` (3 chars) | `DanoCritEqH` |
| `PersonalH` (9 chars) | `PeH` (3 chars) | `DanoCritPeH` |
| `OtrosH` (6 chars) | `OtH` (3 chars) | `DanoCritOtH` |
| `TotalH` (6 chars) | `TtH` (3 chars) | `DanoCritTtH` |

### 2. Decidir destino de Poder en la fórmula

Actualmente `calc/index.js` usa `cfg.formula.power = 0` — un valor hardcodeado que ignora `gear.power` del lore. Opciones:

- **A** Conectar `PoderTotalH` a la fórmula: `calc/` lee `PoderTotalH` del scoreboard y lo usa como `power` en `(1 + DanoTotal) * (1 + Poder/10) * ...`. Requiere eliminar `cfg.formula.power`.
- **B** Mantener Poder como stat cosmética/futura: se parsea, se escribe a scoreboards, pero la fórmula sigue usando `power = 0`. Se documenta explícitamente como "reservada".

### 3. Diseñar consumidor de Daño Verdadero

Daño Verdadero se parsea del lore pero no tiene consumidor. Definir:

- ¿Ignora defensa del target? (¿se suma después de aplicar `applyDefenseMultiplier`?)
- ¿Se aplica siempre o solo en golpe exitoso?
- ¿Qué módulo lo consume (`damage_dealt`?,  `effects`?)?

Si no hay especificación, registrar la stat en `STAT_REGISTRY` como `{ consumer: null }` (parseo activo, consumo pendiente).

### 4. Unificar constantes de IDs de scoreboards

Actualmente hay 4+ archivos con constantes locales de IDs:

| Archivo | Constante | Valor |
|---|---|---|
| `damage_dealt/scoreboard.js` | `OBJ_DEF_TOTAL` | `"DtotalH"` |
| `damage_dealt/scoreboard.js` | `OBJ_PROB_CRIT` | `"ProbabilidadCriticaTotal"` |
| `health/scoreboards.js` | `OBJ_VIDA_MAX` | `"VidaMaxTotalH"` |
| `effects/scoreboard.js` | `OBJ_VIDA_MAX` | `"VidaMaxTotalH"` |
| `calc/config.js` | `objectives.*` | Mapa completo |

Tras la migración, todos importan de `statRegistry.js` o de un módulo compartido `scoreboardIds.js`. Ningún módulo define IDs localmente.

### 5. Eliminar `scoreInit.js` legacy

`calc/scoreInit.js` contiene una sola línea: `"Legacy init removed"`. Debe eliminarse del proyecto y de cualquier import residual. Toda inicialización de objectives está en `scoreboards/catalog.js`.

### 6. Resolver `totals.js` — forma fija vs dinámica

`calc/totals.js` retorna un objeto de forma fija (`{ damageTotal, critDamageTotal, ... }`) — no incluye las 10 stats de profesiones ni los multiplicadores. La migración requiere reemplazarlo con una función que retorne `Map<statId, number>` iterando sobre `STAT_REGISTRY`. No intentar extender la forma fija; reconstruir.

### 7. Definir orden estricto de inicialización

Orden requerido en `main.js`:

```text
1. initAllScoreboards()     ← catalog.js (crea objectives)
2. initLecture()            ← lecture/ (lee equipment, escribe Equipamiento + Total)
3. initCalc()               ← calc/ (lee *TotalH, escribe DanoFinalSC/CC)
4. initCombat()             ← damage_dealt, health, effects, defense, etc.
```

Si un módulo se inicializa antes de `initAllScoreboards`, su cache de objectives se envenena con `null` (bug actual de `damage_dealt`). Documentar este orden como invariante.

### 8. Manejar jugadores en dimensiones no-overworld

`calc/index.js` ejecuta `world.getDimension("minecraft:overworld")` para todas las operaciones de comando fallback. Los jugadores en Nether o End no serán encontrados por `@a[name=...]`. Tras la migración:

- Usar `player.dimension` en vez de dimensión hardcodeada.
- O mejor aún: eliminar completamente el fallback por comando y depender solo de la API de scoreboards (`scoreboardIdentity.setScore`), que no depende de la dimensión.

### 9. Verificar tolerancia del parser a lore malformado

Casos a testear antes de codificar:

| Caso | Lore | Resultado esperado |
|---|---|---|
| Línea vacía en stats | `""` entre stats | Se ignora (no rompe parsing) |
| Etiqueta sin valor | `"§7Daño: "` | Stat = 0 |
| Valor negativo | `"§7Daño: -50"` | Decidir: ¿se acepta `+` implícito? ¿se rechaza? |
| Valor extremo | `"§7Daño: +999999999"` | `clampInt32` lo trunca |
| Float sin parte entera | `"§7Prob: +.5"` | El regex actual no lo captura (¿es OK?) |
| Caracteres unicode | Emojis PUA en la línea | `stripFormatting` los elimina; verificar |
| Item sin lore | `getLore()` retorna `[]` | Todas las stats = 0 |
| Duplicado de etiqueta | Dos líneas con `Daño:` | `findLineByLabel` toma la primera |

### 10. Planificar rollback

Durante la migración (especialmente Fase 3: scoreboards legacy), los jugadores existentes tienen scores en los IDs antiguos. Si la migración falla:

- No eliminar scoreboards legacy hasta verificar que los nuevos funcionan correctamente.
- Implementar un periodo de convivencia donde ambos IDs coexistan (el nuevo lee del nuevo, pero si es 0 hace fallback al legacy).
- Documentar en un script de migración (`tools/migrateScoreboards.js`) que copie valores legacy a los nuevos IDs.

---

## 12. Responsabilidades validadas por modulo

Esta tabla resume la direccion arquitectonica que debe respetarse despues de la migracion:

| Modulo | Responsabilidad principal | No debe hacer |
|---|---|---|
| `scoreboards/` | Catalogar e inicializar objectives | Resolver gameplay de skills |
| `lecture/` | Leer lore y escribir capas Equipamiento/Total | Resolver niveles o drops |
| `regeneration/` | Resolver bloques, drops, XP por evento y spread | Resolver progreso especifico de mineria |
| `core/` | Resolver XP, nivel, rewards y payload comun | Crear objectives o parsear lore |
| `mining/` | Declarar catalogo y presentation layer de mineria | Servir como motor comun de otras skills |
| `foraging/` | Declarar catalogo y presentation layer de tala | Implementar spread o parser por su cuenta |
| `farming/` | Declarar catalogo y presentation layer de cosecha | Duplicar logica del core |

---

## 13. Casos de uso a validar

### Caso 1. Jugador nuevo entra al mundo

- Los objectives ya deben existir por `initAllScoreboards()`.
- `lecture/` puede leer equipo cuando corresponda.
- `core/` debe resolver nivel base sin crear scoreboards dinamicamente.

### Caso 2. Jugador mina un bloque valido

- `regeneration/` aplica XP y drops.
- `core/` recalcula nivel de mineria.
- `mining/` compone recompensa y mensaje.

### Caso 3. Jugador tala logs validos

- `regeneration/` aplica XP y drops de tala.
- El spread se resuelve como mecanica global si `FrenTalTotalH` lo permite.
- `core/` recalcula nivel de tala.
- `foraging/` resuelve su presentation layer.

### Caso 4. Jugador cambia de equipamiento

- `lecture/` actualiza totals.
- Las skills consumidoras ven el cambio en el siguiente evento valido.

### Caso 5. Admin modifica XP o nivel por comando

- `core/` debe reconciliar rewards persistentes sin dejar desincronizaciones.

---

## 14. Pruebas manuales en Minecraft

### Pruebas de inicializacion

1. Entrar a un mundo nuevo con el BP activo.
  Resultado esperado:
  los objectives oficiales de skills existen antes de usar las features.

2. Reiniciar el mundo.
  Resultado esperado:
  los objectives siguen disponibles y no dependen de inicializacion tardia dentro de skills.

### Pruebas de lecture

1. Equipar item con stats de mineria, tala y cosecha.
  Resultado esperado:
  los scoreboards `*TotalH` cambian segun el lore.

2. Quitar el item.
  Resultado esperado:
  los totals vuelven al valor personal + otros.

### Pruebas de progression core

1. Otorgar XP manualmente a una skill.
  Resultado esperado:
  el nivel se recalcula correctamente.

2. Reducir XP manualmente.
  Resultado esperado:
  la reward persistente se reconcilia hacia abajo.

### Pruebas de foraging

1. Talar un log con fortuna de tala 0.
  Resultado esperado:
  drops base.

2. Talar con frenesi 120.
  Resultado esperado:
  un extra garantizado y opcion del siguiente por 20%.

3. Talar en estructura compacta con frenesi alto.
  Resultado esperado:
  el spread sigue vecinos ortogonales, no diagonales.

### Pruebas multijugador

1. Dos jugadores usan skills distintas en paralelo.
  Resultado esperado:
  no se mezclan XP, niveles ni rewards.

---

## 15. Direccion documental vigente

La interpretacion correcta de la documentacion de skills queda asi:

- `Centralizacion.md`: arquitectura tecnica amplia y contexto historico de la centralizacion.
- `MIGRACION_CORE_SKILLS.md`: documento rector vigente de la reestructura hacia `core/`.
- `core/README.md`: contrato funcional del motor compartido.
- `mining/MINING.md`, `foraging/README.md` y futuros documentos por skill: especificaciones consumidoras sobre el core.
