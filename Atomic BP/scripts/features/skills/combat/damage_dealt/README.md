# Combat / Skills: Damage Dealt (aplicar dano a `Vida`)

Ruta: `Atomic BP/scripts/features/skills/combat/damage_dealt`

Este feature aplica el **daño real** a la vida custom (`Vida`, scoreboard) cuando ocurre un golpe melee.

No recalcula lore ni stats: **consume** los scoreboards ya calculados por `skills/combat/calc` y deja que `combat/health` se encargue de sincronizar `Vida` con corazones vanilla.

---

## Gate global (OBLIGATORIO)

Este sistema aplica el gate por flujo:

- **Player -> Entity**: requiere `H == 1` en atacante y objetivo.
- **Mob -> Player**: requiere `H == 1` en el objetivo (player).

Equivalente vanilla:

- `/scoreboard players test <Entidad> H 1..`

Si no se cumple el gate del flujo correspondiente, el sistema hace **early-exit** y NO modifica `Vida`.

---

## Objetivo MVP

- Aplicar daño “real” a `Vida` (scoreboard) **en tiempo real** cuando ocurre el hit.
- Precisión similar a vanilla (sin delays visibles) y buen rendimiento.

Restricciones:

- `danoReal` nunca puede terminar siendo float: si lo es, usar `Math.floor`.
- No usar `ñ` en nombres de variables/archivos (usar `n`: `danoReal`, `probCrit`, etc.).
- Evitar excepciones: todo best-effort y early-exit cuando falten datos.

No-alcances (por ahora):

- Proyectiles, magia, tridentes, TNT, etc. (MVP usa solo melee).
- UI/feedback visual (eso vive en `damage_title/`; aquí solo se dejan hooks).
- Recalcular stats del arma/armadura en el golpe (eso es `skills/combat/calc`).

---

## Dependencias y cómo encaja con lo ya implementado

### `skills/combat/calc` (fuente de verdad del daño)

Este feature consume scoreboards calculados por:

`Atomic BP/scripts/features/skills/combat/calc`

Scoreboards relevantes (IDs ASCII):

- Atacante (player):
	- `DanoFinalSC` (int) — daño teórico sin crítico
	- `DanoFinalCC` (int) — daño teórico con crítico
	- `ProbCritTotalH` (0..100; prioritario)
	- `ProbabilidadCriticaTotal` (0..100; fallback legacy)
- Objetivo (entidad):
	- `DefensaTotalH` (int; prioritario)
	- `DtotalH` (int; fallback legacy)

Nota: este feature no calcula ni inicializa `VidaMaxTotalH`; solo consume los outputs que ya llegan desde el pipeline de combate.

### `combat/health` (vida custom + display)

`damage_dealt` solo modifica el scoreboard `Vida`. Luego:

- `combat/health` toma `Vida` y sincroniza los corazones vanilla.
- Si está habilitado el escudo `VidaAbsorcion`, el daño “real” puede ser absorbido en el tick siguiente (según lógica de `combat/health`).

Esto es intencional: `damage_dealt` no decide nada sobre display ni sobre absorción; solo aplica el daño base del golpe.

### `combat/damageCancel` (opcional pero recomendado)

Si estás cancelando daño vanilla con `damageCancel/`, entonces:

- El motor no baja HP vanilla.
- `damage_dealt` se vuelve la ruta “real” de daño al jugador/mob (vía `Vida`).

---

## Arquitectura requerida (archivos)

Dentro de `Atomic BP/scripts/features/skills/combat/damage_dealt/`:

```text
damage_dealt/
	README.md
	index.js                # initDamageDealt(config?)
	scoreboard.js           # getScore/setScore/addScore/removeScore/hasHEnabled
	math.js                 # floorInt/clampMin0/rollCrit
	damage_title_hook.js    # emitDamageTitle(...) (no-op por ahora)
	byplayer/
		index.js              # initByPlayerDamageDealt(config?)
	by_mob/
		index.js              # initByMobDamageDealt(config?)
```

Notas:

- `damage_title_hook.js` existe solo para dejar el punto de integración con `combat/damage_title/` sin acoplar módulos.
- `index.js` inicializa ambos submódulos.

---

## Scoreboards usados por este feature

Gate:

- `H` (dummy): habilita el sistema para atacante y objetivo.

Vida aplicada:

- `Vida` (dummy): vida actual custom del objetivo.

Inputs (por `skills/combat/calc`):

- Atacante jugador:
	- `DanoFinalSC`
	- `DanoFinalCC`
	- `ProbCritTotalH` (si existe)
	- `ProbabilidadCriticaTotal`
- Objetivo:
	- `DefensaTotalH` (si existe)
	- `DtotalH`

Internos de tracking/cooldown:
- `LastKillerId`
- `LastKillTick`

Inputs para mobs (MVP):

- Atacante mob:
	- `DMGH` (si no existe: 0)

---

## Eventos (detección de golpes)

MVP: usar melee hit inmediato:

- `world.afterEvents.entityHitEntity`

Datos clave:

- `ev.damagingEntity` (atacante)
- `ev.hitEntity` (objetivo)

Fallback (PvP):

- En algunos runtimes `entityHitEntity` no dispara consistentemente para player->player. En ese caso se usa `world.afterEvents.entityHurt` como fallback **solo para PvP**, protegido por cooldown por target para evitar doble-aplicación.

Futuro (NO en MVP general):

- `world.afterEvents.entityHurt` para cubrir proyectiles u otros daños (fuera de PvP fallback).

Importante:

- Para evitar doble-aplicación al mezclar eventos (por el fallback PvP), existe un cooldown por TARGET (immunity frames) que evita duplicados en el mismo rango de ticks.

---

## Fórmulas (NO cambiar lógica)

### A) Player -> Entity (mobs o players)

Aplica solo si:

- atacante es jugador
- objetivo es entidad (mob o jugador)
- atacante.H == 1
- objetivo.H == 1

Inputs (atacante):

- `DanoFinalSC` (int)
- `DanoFinalCC` (int)
- `ProbCritTotalH` (0..100; si no existe, fallback a `ProbabilidadCriticaTotal`)

Inputs (objetivo):

- `DefensaTotalH` (defensaEnemigo; si no existe, fallback a `DtotalH`)
- `Vida` (vida actual; si no existe, tratar como 0 o hacer early-exit según config)

Paso 1: decidir crítico

- `isCrit = random(0..100) < ProbCritTotalH`
- Si `ProbCritTotalH >= 100` => crítico garantizado
- Si `ProbCritTotalH <= 0` => nunca crítico

Paso 2: elegir danoBase

- `danoBase = isCrit ? DanoFinalCC : DanoFinalSC`

Paso 3: reducción por defensa

Mantener EXACTA esta fórmula:

- `danoReal = danoBase * (75 / (defensaEnemigo + 75))`

Reglas:

- `danoReal = Math.floor(danoReal)`
- `danoReal = max(0, danoReal)`

Notas:

- Si `defensaEnemigo <= 0`, el multiplicador se trata como 1 (sin reducción).
- A mayor defensa, menor daño (monótono), sin `NaN/Infinity`.

Paso 4: aplicar a vida scoreboard

- `Vida = Vida - danoReal`
- Si `danoReal == 0`, no escribir.

Nota (mobs):

- Para un mejor efecto visual en `damage_title`, cuando el objetivo es un mob se permite que `Vida` baje por debajo de 0. La muerte ocurre igual cuando `Vida <= 0`.

Paso 5: hook visual (no implementarlo aquí)

- `emitDamageTitle({ attacker, target, danoReal, isCrit })`
---

### B) Mob -> Player

Aplica solo si:

- atacante NO es jugador (mob)
- objetivo es jugador
- objetivo.H == 1

Inputs (mob):

- `DMGH` (scoreboard). Si el mob tiene `H==1` y `DMGH` falta o es `<=0`, se fuerza un mínimo de `1`.

Inputs (player):

- `DefensaTotalH` (defensaJugador; si no existe, fallback a `DtotalH`)
- `Vida`

Fórmula:

- `danoRealMob = DMGH * (75 / (defensaJugador + 75))`

Reglas:

- `danoRealMob = Math.floor(danoRealMob)`
- `danoRealMob = max(0, danoRealMob)`
- `Vida = Vida - danoRealMob`

Cooldown (mobs):

- Para evitar multi-disparos por swing/tick, existe un cooldown por ATACANTE (por mob) de ~1.2s (24 ticks) por defecto.
- Es decir: cada mob puede aplicar daño como máximo 1 vez por ventana de cooldown, independientemente de cuántos players haya.

---

## Casos de uso (MVP)

### Caso 1: player golpea zombie sin defensa

- Player: `H=1`, `DanoFinalSC=30`, `DanoFinalCC=60`, `ProbabilidadCriticaTotal=0`
- Zombie: `H=1`, `DtotalH=0`, `Vida=100`

Resultado:

- No crítico => `danoBase=30`
- Defensa 0 => `danoReal=30`
- `Vida=70`

### Caso 2: player golpea player con crítico garantizado

- Attacker: `H=1`, `ProbabilidadCriticaTotal=100`, `DanoFinalCC=120`
- Target: `H=1`, `DtotalH=0`, `Vida=1000`

Resultado:

- Crítico => `danoReal=120`
- `Vida=880`

### Caso 3: mob (zombie) golpea player

- Zombie: `H=1`, `DMGH=5`
- Player: `H=1`, `DtotalH=0`, `Vida=100`

Resultado:

- `danoRealMob=5`
- `Vida=95`

### Caso 4: gate H (no aplica)

- Attacker `H=1`
- Target `H=0`

Resultado:

- No se aplica daño custom (NO tocar scoreboard `Vida`).

### Caso 5: valores faltantes

- Si faltan scores como `DtotalH` => tratar como 0.
- Si faltan scores como `DanoFinalSC/DanoFinalCC` => tratar como 0.
- Si `Vida` no existe en el objetivo:
	- Recomendado: tratar como 0 o hacer early-exit según la política del módulo.
	- No crear objectives ni auto-init de scoreboards desde este feature; la existencia del objective debe venir de `scripts/scoreboards/`.

---

## Notas de rendimiento

- Ejecutar en el evento (sin interval) para que se sienta inmediato.
- Early-exit agresivo:
	- Si `attacker` o `target` es null
	- Si cualquiera no tiene `H==1`
	- Si `danoBase <= 0`
- Evitar escrituras redundantes:
	- Si `danoReal == 0`, no llamar `removeScore`.
- Considerar rate-limit por atacante si notas multi-disparo por swing.

---

## Plan de integración (cuando se implemente)

1) Implementar `damage_dealt/index.js` exportando `initDamageDealt(config?)`.
2) Desde `Atomic BP/scripts/main.js` (o tu init central de combat), llamar:

```js
import { initDamageDealt } from "./features/skills/combat/damage_dealt/index.js";
initDamageDealt({ debug: false });
```

3) Mantener `combat/health` activo para que el display de corazones siga a `Vida`.
4) (Opcional) Mantener `combat/damageCancel` activo si quieres que la vida vanilla no baje nunca.

---

## Debug mode (runtime)

El entrypoint acepta un booleano de debug:

- `initDamageDealt({ debug: true })`

Cuando está activo, el sistema imprime (en chat) valores usados en el cálculo en el momento del hit, por ejemplo:

- Player -> Entity: probCrit, isCrit, `DanoFinalSC/DanoFinalCC`, `DtotalH`, `danoReal`
- Mob -> Player: `DMGH`, `DtotalH`, `danoReal`

Nota: el debug es global (no por scoreboard) para evitar dependencias extra.

