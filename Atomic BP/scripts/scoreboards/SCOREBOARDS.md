# Atomic BP — Scoreboards (inventario e inicialización)

Este documento lista **todos los scoreboards requeridos** por el BP, separando:

1) **Dónde se inicializan hoy** (init existente).
2) **Dónde se usan sin init** (pendientes de centralizar).
3) **Configurable** (nombres que vienen de config y pueden cambiar).

> Alcance: **solo init**. Aquí se documenta **qué objectives deben existir** y **quién los crea**.

---

## Estado de migración (actual)

- **Nuevo init central**: [Atomic BP/scripts/scoreboards/init.js](Atomic%20BP/scripts/scoreboards/init.js)
- **Catálogo**: [Atomic BP/scripts/scoreboards/catalog.js](Atomic%20BP/scripts/scoreboards/catalog.js)
- **Entry**: [Atomic BP/scripts/main.js](Atomic%20BP/scripts/main.js)

Los **inits antiguos siguen existiendo**, pero sus llamadas están **comentadas** temporalmente para probar el init central.

---

## Ruta central (implementada)

- [Atomic BP/scripts/scoreboards/](Atomic%20BP/scripts/scoreboards/)
  - `catalog.js` (lista de IDs + displayName)
  - `init.js` (crea todos los objectives en `worldLoad`)
  - `index.js` (exports)

Motivo:
- Un solo lugar evita duplicados y colisiones entre sistemas.
- Permite detectar rápido qué objectives faltan.
- Facilita documentación y mantenimiento.

---

## 1) Inicializadores existentes (JS)

### AntiCheat (centralizado)
- Init: [Atomic BP/scripts/features/anticheat/core/scoreboardsInit.js](Atomic%20BP/scripts/features/anticheat/core/scoreboardsInit.js)
- Estado: **call comentado** en [Atomic BP/scripts/features/anticheat/index.js](Atomic%20BP/scripts/features/anticheat/index.js)
- Objectives creados:
  - `ac_feature_flags`
  - `advertencias`
  - `ac_ban_until`
  - `ac_ban_seconds`
  - `ac_ban_sanction`
- Config: [Atomic BP/scripts/features/anticheat/anticheat.config.js](Atomic%20BP/scripts/features/anticheat/anticheat.config.js)

### Skills / Combat Calc + Lecture (daño y stats)
- Ruta actual del calculador: [Atomic BP/scripts/features/skills/combat/calc/README.md](Atomic%20BP/scripts/features/skills/combat/calc/README.md)
- Lectura centralizada de lore: [Atomic BP/scripts/features/skills/lecture](Atomic%20BP/scripts/features/skills/lecture)
- Estado: **call comentado** en [Atomic BP/scripts/main.js](Atomic%20BP/scripts/main.js)
- Refuerzo adicional histórico: ahora debe considerarse migrado al init central y a los módulos vigentes de `combat/calc` + `lecture/`
- Objectives (desde config):
  - `H`
  - `DMGH`, `CDH`, `CCH`, `DH`, `MH`, `VidaMaxH`
  - `MAH`, `MMH`
  - `DanoFinalSC`, `DanoFinalCC`, `ProbabilidadCriticaTotal`
  - `DtotalH`, `MtotalH`, `VidaMaxTotalH`
- Config: [Atomic BP/scripts/features/skills/combat/calc/config.js](Atomic%20BP/scripts/features/skills/combat/calc/config.js)

### Combat / Health
- Init: [Atomic BP/scripts/features/skills/combat/health/scoreboards.js](Atomic%20BP/scripts/features/skills/combat/health/scoreboards.js)
- Estado: **call comentado** en [Atomic BP/scripts/features/skills/combat/health/index.js](Atomic%20BP/scripts/features/skills/combat/health/index.js)
- Objectives creados:
  - `H`
  - `Vida`
  - `VidaMaxH`
  - `VidaMaxTotalH`
  - `VidaAbsorcion`
  - `HDead`

### Combat / Damage Dealt
- Init: [Atomic BP/scripts/features/skills/combat/damage_dealt/scoreboard.js](Atomic%20BP/scripts/features/skills/combat/damage_dealt/scoreboard.js)
- Estado: **call comentado** en [Atomic BP/scripts/features/skills/combat/damage_dealt/index.js](Atomic%20BP/scripts/features/skills/combat/damage_dealt/index.js)
- Objectives creados:
  - `H`
  - `Vida`
  - `VidaMaxTotalH`
  - `DanoFinalSC`
  - `DanoFinalCC`
  - `ProbabilidadCriticaTotal`
  - `DtotalH`
  - `DMGH`
  - `LastKillerId`
  - `LastKillTick`

### Combat / Damage Cancel
- Init parcial: [Atomic BP/scripts/features/skills/combat/damageCancel/score.js](Atomic%20BP/scripts/features/skills/combat/damageCancel/score.js)
- Estado: **call comentado** en [Atomic BP/scripts/features/skills/combat/damageCancel/index.js](Atomic%20BP/scripts/features/skills/combat/damageCancel/index.js)
- Objective creado:
  - `H`

---

## 2) Scoreboards usados por mcfunction (sin init en scripts)

> Estos objectives se usan en funciones por tick. No se encontró creación explícita de objectives en mcfunction. Deben existir previamente o centralizarse en el init.

### General3
- [Atomic BP/functions/General3/Tiempo.mcfunction](Atomic%20BP/functions/General3/Tiempo.mcfunction)
  - `ticksegundos`, `segundos`, `minutos`, `horas`, `dias`
- [Atomic BP/functions/General3/Muertes.mcfunction](Atomic%20BP/functions/General3/Muertes.mcfunction)
  - `muerto`, `M`, `MsgMuerte`
- [Atomic BP/functions/General3/On_Join.mcfunction](Atomic%20BP/functions/General3/On_Join.mcfunction)
  - `NoTpUnido`, `unido`
- [Atomic BP/functions/General3/Spawns.mcfunction](Atomic%20BP/functions/General3/Spawns.mcfunction)
  - `limbo`, `ExcMuerte`
- [Atomic BP/functions/General3/LobbyTitle.mcfunction](Atomic%20BP/functions/General3/LobbyTitle.mcfunction)
  - `lobbytitle`, `Coo`, `CooHelper`
  - `D`, `xptitle`, `XP`
  - `dias`, `horas`, `minutos`, `segundos`
  - `killtitle`, `Se`
  - `muertetitle`, `M`
  - `almatitle`, `So`
  - `versiontitle`, `versiontitlevalor1`, `versiontitlevalor2`, `versiontitlevalor3`
- [Atomic BP/functions/General3/LobbyTitleMulticolor.mcfunction](Atomic%20BP/functions/General3/LobbyTitleMulticolor.mcfunction)
  - `lt`, `ltsuperior`
  - `D`, `XP`, `dias`, `horas`, `minutos`, `segundos`, `Se`, `M`, `So`

### Seguridad1
- [Atomic BP/functions/Seguridad1/ID.mcfunction](Atomic%20BP/functions/Seguridad1/ID.mcfunction)
  - `ID`, `IDAsignada`, `TotalIDs`
- [Atomic BP/functions/Seguridad1/EntityCramming.mcfunction](Atomic%20BP/functions/Seguridad1/EntityCramming.mcfunction)
  - `EntityCramming`
- [Atomic BP/functions/Seguridad1/AntiHacks/Fill.mcfunction](Atomic%20BP/functions/Seguridad1/AntiHacks/Fill.mcfunction)
  - `FillBeeHiveNest`
- [Atomic BP/functions/Seguridad1/MonsterEffects.mcfunction](Atomic%20BP/functions/Seguridad1/MonsterEffects.mcfunction)
  - `H`

---

## 3) Scoreboards usados en documentación/archivements

Fuente: [Atomic BP/scripts/features/archivements/arch-list/LOGROS.md](Atomic%20BP/scripts/features/archivements/arch-list/LOGROS.md)

Requeridos (según reglas de logros):
- `segundos`, `minutos`, `horas`, `dias`
- `mobs`
- `muertes`
- `Se`
- `D`
- `Parcela`
- `Corazones`

---

## 4) Scoreboards configurables (skills/regeneration)

Fuente: [Atomic BP/scripts/features/skills/regeneration/config.js](Atomic%20BP/scripts/features/skills/regeneration/config.js)

Estos objetivos se agregan por **config** y se deben crear si se habilita el feature:
- Global (metrics): `metrics.scoreboardAddsOnBreak`
- Por bloque/modifier (ejemplos actuales en config):
  - `CARBON`
  - `DINERO`
  - `TRONCOS`
  - `ZANAHORIAS`

---

## 5) Resumen de objetivos (consolidado)

> Lista única de objetivos detectados (sin duplicados). Útil para el init central.

**Core/Skills**
- `H`, `Vida`, `VidaMaxH`, `VidaMaxTotalH`, `VidaAbsorcion`, `HDead`
- `DMGH`, `CDH`, `CCH`, `DH`, `MH`
- `MAH`, `MMH`
- `DanoFinalSC`, `DanoFinalCC`, `ProbabilidadCriticaTotal`
- `DtotalH`, `MtotalH`
- `LastKillerId`, `LastKillTick`

**AntiCheat**
- `ac_feature_flags`, `advertencias`, `ac_ban_until`, `ac_ban_seconds`, `ac_ban_sanction`

**Tiempo / Lobby / UI (mcfunction)**
- `ticksegundos`, `segundos`, `minutos`, `horas`, `dias`
- `lobbytitle`, `lt`, `ltsuperior`, `Coo`, `CooHelper`
- `D`, `xptitle`, `XP`
- `killtitle`, `Se`
- `muertetitle`, `M`
- `almatitle`, `So`
- `versiontitle`, `versiontitlevalor1`, `versiontitlevalor2`, `versiontitlevalor3`
- `muerto`, `MsgMuerte`, `NoTpUnido`, `unido`, `limbo`, `ExcMuerte`
- `ID`, `IDAsignada`, `TotalIDs`
- `EntityCramming`, `FillBeeHiveNest`

**Economía / VIP (death system)**
- `muertes`, `D`, `vip`

**Spawnpoints (spawnpoints system)**
- `spawnpoint`

**Archivements (LOGROS)**
- `mobs`, `muertes`, `Parcela`, `Corazones`
- `Logros` (contador total por jugador)
- `Logro_<id>` (one-time por logro)

**Regeneración (configurable)**
- `CARBON`, `DINERO`, `TRONCOS`, `ZANAHORIAS`
