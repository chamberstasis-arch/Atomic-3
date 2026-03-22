## Combat Health (MVP)

Sistema de vida por scoreboards para **jugadores y mobs**.

### Objetivos (scoreboards)
- `H` habilita el sistema (`H==1`).
- `Vida` vida actual.
- `VidaMaxH` vida máxima base/personal (solo se inicializa una vez si falta).
- `VidaMaxTotalH` vida máxima (total).
- `VidaAbsorcion` vida extra temporal (escudo) asociada a corazones amarillos.
- `HDead` flag interno (muerte lógica / respawn).

Reglas:
- Si un jugador activa el sistema por primera vez (`H==1`) y **no tiene** `VidaMaxH`, se le asigna `VidaMaxH=100` (configurable). Esto pasa **solo una vez** (no se sobreescribe si ya existe).
- `Vida` se clampa a `0..VidaMaxTotalH` cuando `VidaMaxTotalH>0`.
- Si una entidad entra al sistema (`H==1`) y **no tiene** `VidaMaxTotalH`, se asigna default:
	- Players: `VidaMaxTotalH=100` (configurable).
	- Mobs: `VidaMaxTotalH = (vida vanilla actual * 5)`.
- Luego se inicializa `Vida=VidaMaxTotalH`.

Caso especial:
- Si `VidaMaxTotalH==0`, se trata como **inmortal lógica** (no se ejecuta kill por `Vida<=0`).

## Absorción (corazones amarillos) — Implementación actual

Objetivo: que la absorción vanilla (p.ej. manzana de oro) **no rompa** el sistema de vida, tratándola como una “bolsa” aparte.

Reglas:
- El sistema mantiene `VidaAbsorcion` como vida extra que **se consume antes que `Vida`** cuando un sistema externo resta `Vida` (daño del sistema).
- La absorción se visualiza en **corazones amarillos**. El tiempo del efecto lo maneja el motor vanilla.
- Cuando el motor reduce/elimina los corazones amarillos por tiempo (fin del efecto), el sistema lo detecta (best-effort) y ajusta `VidaAbsorcion` para que no quede bonus “fantasma”.
- Cuando `VidaAbsorcion` se consume por daño custom, el sistema intenta **decrementar** los corazones amarillos para reflejar el gasto (no los incrementa por script; el incremento viene de vanilla al comer la manzana).
- Se asume que existe un sistema aparte que cancela daño vanilla; por eso la absorción debe funcionar como escudo contra cambios en el scoreboard `Vida`.

### Conversión

Se toma la absorción en HP vanilla (1 corazón = 2 HP). Cada 1 HP de absorción equivale a **5%** de `VidaMaxTotalH` como vida extra:

- `VidaAbsorcion = floor(AbsHP * VidaMaxTotalH / 20)`

Ejemplos (si `VidaMaxTotalH = 100`):
- 2 corazones (4 HP) -> `VidaAbsorcion = 20`
- 4 corazones (8 HP) -> `VidaAbsorcion = 40`

### Orden de consumo (escudo primero)

Si un sistema externo aplica daño restando `Vida`, el loop de health lo reinterpreta así:

1) Consumir de `VidaAbsorcion` hasta 0
2) El resto del daño se aplica a `Vida`

Ejemplo:
- `VidaMaxTotalH = 100`
- `Vida = 100`
- `VidaAbsorcion = 40`
- Sistema externo resta 50 a `Vida` (queda `Vida=50` antes del tick)

En el tick de health:
- Se consumen 40 de `VidaAbsorcion` (queda `VidaAbsorcion=0`)
- Quedan 10 de daño que sí afectan a `Vida`
- Resultado final: `Vida=90`

### Casos de uso

- Manzana de oro: al ganar corazones amarillos, se incrementa `VidaAbsorcion` automáticamente según `VidaMaxTotalH`.
- Skills/daño custom: cualquier resta directa a `Vida` se “absorbe” primero con `VidaAbsorcion`.
- Expiración del efecto: si los corazones amarillos bajan a 0 por tiempo, `VidaAbsorcion` se clampa a 0.
- Cambios de equipo: si `VidaMaxTotalH` cambia mientras hay absorción, la equivalencia cambia (la conversión depende del máximo).

### Debug (diagnóstico)

Si la absorción no se está detectando (p.ej. manzana de oro), activa el debug global:

- Inicializa el sistema con `initCombatHealth({ debug: true })`.

El debug imprime (rate-limited) datos como:
- AbsHP detectado
- Fuente (`effect`/`component`/`health`)
- `VidaAbsorcion`, `Vida`, `VidaMaxTotalH`

## Seguridad y hardening

- **NaN guard en `clampVida`**: Si `VidaMaxTotalH` se lee como `NaN` (score inexistente o corrupto), `clampVida` hace early-return sin modificar `Vida`, evitando propagación de NaN a través de `Math.min`/`Math.max`.
- **isValid en `syncMobs`**: El loop de mobs tracked valida `entity.isValid` antes de acceder propiedades; entidades inválidas se eliminan del Set inmediatamente.

Nota: en algunos runtimes no existe un componente directo de absorción; por eso el sistema deriva AbsHP desde el efecto `absorption` cuando está disponible.

### Jugadores (H==1)
- La vida vanilla es **solo display**.
- Cada intervalo:
	- Sincroniza `Vida/VidaMaxTotalH` -> corazones vanilla (proporción sobre `health.effectiveMax`).
		- Fix anti-instant-death: si `Vida > 0` pero la proporción es tan baja que el display caería a `0`, se clampa a **1 corazón mínimo** para que cambios bruscos de `VidaMaxTotalH` (equipo) no maten instantáneamente.
		- Se intenta conservar precisión de **medio corazón** (el sistema usa HP enteros; 1 HP = 1/2 corazón).
	- Detecta **curación vanilla** (delta positivo desde el tick anterior) y la convierte a incremento de `Vida`:
		- `addVida = floor((deltaVanilla / vanillaMax) * VidaMaxTotalH)`.
	- Ignora bajadas vanilla (delta negativo): **NO** reduce `Vida`.

Muerte / respawn:
- Si `Vida<=0` y `VidaMaxTotalH>0`, el sistema mata al jugador (best-effort) y setea `HDead=1`.
- En `playerSpawn`, si `H==1`, se resetea `Vida=VidaMaxTotalH` y `HDead=0`.

Muertes vanilla instantáneas:
- Este MVP **no** da inmunidad a jugadores; si mueren por un one-shot vanilla (p.ej. creeper cargado), se considera una muerte normal.
- Al respawnear, `Vida` se vuelve a setear a `VidaMaxTotalH`.

### Mobs (H==1)
- Mata el mob solo cuando `Vida<=0` y `VidaMaxTotalH>0`.

### Archivos
- `index.js`: exporta `initCombatHealth(config?)`.
- `scoreboards.js`: init + helpers de score.
- `defaults.js`: defaults y funciones de vida máxima.
- `syncPlayers.js`: sync scoreboard <-> vanilla (solo heals vanilla -> scoreboard).
- `syncMobs.js`: kill por Vida<=0.

### Integración
En `scripts/main.js`:
```js
import { initCombatHealth } from "./features/skills/combat/health/index.js";
initCombatHealth();
```

### Pruebas rápidas (en juego)
1) Habilitar sistema al jugador:
`/scoreboard players set @s H 1`
2) Forzar valores:
`/scoreboard players set @s VidaMaxTotalH 100`
`/scoreboard players set @s Vida 50`
3) Verificar que los corazones se ajustan a ~50%.
4) Comer / regenerar y verificar que `Vida` sube (hasta `VidaMaxTotalH`).

5) Probar muerte lógica:
`/scoreboard players set @s Vida 0`
Debe morir y respawnear con `Vida` al máximo.
}
