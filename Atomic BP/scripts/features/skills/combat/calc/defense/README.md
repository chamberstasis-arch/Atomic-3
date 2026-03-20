# Skills / Combat / Calc / Defense

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Ruta: `Atomic BP/scripts/features/skills/combat/calc/defense`

Este módulo define la capa de **mitigación de daño** del pipeline de combate.

## Objetivo

Separar la responsabilidad de mitigación para que `calc/` quede dividido en:

- cálculo base/final de daño,
- mitigación defensiva,
- outputs finales para consumidores.

La mitigación de defensa deja de ser una utilidad dispersa y pasa a un contrato explícito bajo `calc/defense`.

## Contrato funcional (objetivo)

Entradas mínimas:
- `danoBase` (sin mitigar)
- `defensaObjetivo`
- contexto opcional para mitigaciones adicionales

Salida:
- `danoMitigado` entero (`>= 0`)

Regla base de defensa (actual):

$$
danoMitigado = \left\lfloor danoBase \times \frac{75}{defensa + 75} \right\rfloor
$$

## Alcance actual vs siguiente fase

Estado actual del runtime:
- La mitigación efectiva hoy está aplicada en `combat/damage_dealt/math.js`.

Dirección aprobada:
- Migrar esa lógica al contrato de `calc/defense` para que `damage_dealt` solo consuma un resultado mitigado y no duplique reglas.

## Responsabilidades de `calc/defense`

- Resolver mitigación por defensa base.
- Preparar extensión para mitigaciones futuras (resistencias por tipo, caps, inmunidades parciales).
- Mantener comportamiento determinista e idempotente.
- No crear objectives; solo consumir scoreboards ya catalogados.

## Integración prevista

- `calc/index.js`: compone daño base y delega mitigación a `calc/defense`.
- `damage_dealt`: aplica daño ya mitigado y se enfoca en eventos/cooldowns/hook visual.

## Reglas de diseño

- Mantener funciones puras (sin side-effects de scoreboards).
- Clampear valores para evitar `NaN`, `Infinity` y negativos fuera de rango.
- Evitar acoplar mitigación a una sola fuente de defensa (`DefensaTotalH` vs `DtotalH`): la resolución de input debe quedar en capa de lectura, no en la fórmula.

## Nota

Este README define el contrato y la dirección de arquitectura. La migración de código puede ejecutarse en una fase posterior, manteniendo compatibilidad temporal con la implementación actual en `damage_dealt`.
