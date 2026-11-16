# Skills / Combat: Damage Cancel (HP vanilla)

Ruta: `Atomic BP/scripts/features/skills/combat/damageCancel`

## Objetivo

Evitar que el jugador pierda **HP vanilla** al recibir daño cuando su scoreboard `H` es `1`.

- `H == 1` → se intenta cancelar el daño vanilla.
- `H != 1` → el jugador se comporta normal.

Esto es un **prerrequisito** para implementar luego el sistema de daño custom (sin mezclarlo aquí).

## Reglas / restricciones

- No usa Dynamic Properties.
- No usa APIs experimentales.
- No sobreescribe `minecraft:player` con Behavior JSON.
  - Intentar `entities/player.json` suele causar errores de actor_definitions y comportamiento roto del jugador.

## Implementación

- `score.js`
  - Asegura/lee el objective `H` usando `world.scoreboard`.
  - Cachea el objective para evitar búsquedas repetidas.

- `index.js`
  - Mantiene un loop ligero (default cada 10 ticks) para cachear si el jugador está enabled (H==1).
  - Tag opcional `hp_mode` (solo debug): sirve para confirmar estado con `/tag @s list`.
  - API pública: `initVanillaDamageCancel(options?)`.
  - Cancela daño:
    - Preferido: `world.beforeEvents.entityHurt` y `ev.cancel = true`.
    - Fallback: `world.afterEvents.entityHurt` restaura HP sumando `ev.damage`.

## Limitaciones conocidas

- Si el runtime no expone `beforeEvents.entityHurt`, el fallback puede no evitar muertes por daño letal en el mismo tick.
- Mantener knockback/animación roja depende del motor y del tipo de daño.

## Prueba manual

1) Crear objective y activar:
   - `/scoreboard objectives add H dummy`
   - `/scoreboard players set @s H 1`

2) Verificar tag debug (opcional):
   - `/tag @s list` → debe contener `hp_mode` tras ~10 ticks.

3) Recibir daño (zombie/caída) y confirmar que no baja HP.

4) Desactivar:
   - `/scoreboard players set @s H 0`
   - Debe volver el daño vanilla.
