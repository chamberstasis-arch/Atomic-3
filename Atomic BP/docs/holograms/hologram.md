# Entidad `atomic:hologram`

Este documento describe la entidad del **Behavior Pack** `atomic:hologram`.

## Objetivo

`atomic:hologram` es una entidad mínima pensada para funcionar como **portador de texto flotante** mediante su `nameTag`.

- No tiene IA ni movimiento.
- No tiene gravedad ni colisión.
- No se puede empujar.
- No recibe daño (best-effort).
- Es persistente (no debería despawnear de forma natural).

## Archivo

- [../../entities/hologram.json](../../entities/hologram.json): define la entidad `atomic:hologram`.

## Uso previsto (Script API)

Desde scripts puedes crear y actualizar el texto así:

- Spawnear: `dimension.spawnEntity("atomic:hologram", location)`
- Cambiar texto: `entity.nameTag = "§aTexto\n§7Segunda línea"`

Notas:
- Los códigos `§` funcionan para colores/estilos.
- El `\n` permite múltiples líneas.

## Rendimiento (recomendaciones)

- Evita actualizar `nameTag` cada tick.
- Actualiza por intervalos (ej. cada 10–20 ticks) y **solo si el texto cambió**.
- Mantén un límite razonable de hologramas activos por zona/dimensión.

## Importante: visibilidad (RP)

Este archivo **no controla el render**. Para que la entidad sea realmente “invisible” (sin modelo), se recomienda añadir en el Resource Pack un *client entity* para `atomic:hologram` con geometría vacía.

## Compatibilidad

- `format_version` está fijado en `1.19.30` por compatibilidad con componentes usados (ej. `minecraft:damage_sensor` con `cause: all`).
- El Behavior Pack requiere la versión de motor indicada en tu `manifest.json`.
