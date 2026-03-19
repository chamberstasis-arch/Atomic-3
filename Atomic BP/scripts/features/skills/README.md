# Skills — Índice actual

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Documento índice de `Atomic BP/scripts/features/skills/`.

Su objetivo es dejar claro **dónde está cada cosa** y qué módulos están en estado productivo, en transición o pendientes.

---

## 1. Estado general del directorio

- `lecture/`: runtime activo. Lee lore/equipo y escribe scoreboards por capa (`Personal`, `Equipamiento`, `Otros`, `Total`).
- `core/`: runtime activo. Gestiona progresión compartida por `skillId` para skills tipo mining/foraging/farming.
- `regeneration/`: runtime activo. Motor global de minado/tala/cosecha, drops, XP por evento, persistencia y spread.
- `mining/`: skill activa y registrada en `core/`.
- `foraging/`: skill activa y registrada en `core/`.
- `farming/`: skill activa y registrada en `core/`.
- `combat/`: sistema activo y documentado en submódulos.
- `fishing/`: fuera de alcance por ahora (sin documentación técnica formal en esta carpeta).

---

## 2. Flujo de inicialización real

Entrada principal:

- `scripts/main.js`

Orden actual relevante para skills:

1. `initAllScoreboards()`
2. `initLecture(lectureConfig)`
3. `initSkillsCore(skillsCoreConfig)`
4. `initSkillMining(miningSkillConfig)`
5. `initSkillForaging(foragingSkillConfig)`
6. `initSkillFarming(farmingSkillConfig)`
7. `initSkillRegeneration(skillRegenConfig)`

Implicación:

- `farming` ya se inicializa de forma explícita como skill sobre `core/`.
- El procesamiento por bloque de cosecha continúa en `regeneration/config.js` (bloques con `skill: "farming"`).

---

## 3. Dónde está cada responsabilidad

### 3.1 Scoreboards (alta de objectives)

- Archivo: `scripts/scoreboards/catalog.js`
- Inicialización: `scripts/scoreboards/init.js` vía `initAllScoreboards()`

Regla vigente:

- Ningún módulo de `skills/` debe crear objectives como comportamiento normal.

### 3.2 Registro de estadísticas base

- Archivo: `skills/lecture/statRegistry.js`

Incluye, entre otras:

- `FortMin`, `ExpMin`
- `FortTal`, `FrenTal`, `ExpTal`
- `FortCos`, `MutAct`, `ExpCos`

### 3.3 Progresión compartida

- API pública: `skills/core/index.js`
- Internos:
  - `skills/core/registry.js`
  - `skills/core/progression.js`
  - `skills/core/scoreboards.js`

Docs:

- `skills/core/README.md`

### 3.4 Motor global de bloques

- Entrada: `skills/regeneration/index.js`
- Configuración: `skills/regeneration/config.js`
- Spread: `skills/regeneration/spread.js`
- Validación: `skills/regeneration/validate.js`
- Persistencia: `skills/regeneration/persistence.js`

Docs:

- `skills/regeneration/README.md`

### 3.5 Skills consumidoras hoy

- Mining:
  - `skills/mining/index.js`
  - `skills/mining/config.js`
  - `skills/mining/MINING.md`

- Foraging:
  - `skills/foraging/index.js`
  - `skills/foraging/config.js`
  - `skills/foraging/README.md`

- Farming:
  - `skills/farming/index.js`
  - `skills/farming/config.js`
  - `skills/farming/README.md`
  - Integración de bloque y mutación dentro de `skills/regeneration/config.js`

---

## 4. Documentación activa por módulo

- `skills/core/README.md`
- `skills/regeneration/README.md`
- `skills/mining/MINING.md`
- `skills/foraging/README.md`
- `skills/farming/README.md`
- `skills/combat/README.md` + READMEs internos

Este archivo (`skills/README.md`) funciona como índice maestro y referencia rápida de ubicación.
