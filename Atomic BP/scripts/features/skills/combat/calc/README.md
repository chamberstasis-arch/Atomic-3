# Skills / Combat / Calc

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Ruta: `Atomic BP/scripts/features/skills/combat/calc`

Este módulo aplica la **fórmula de daño final** consumiendo los **totales por capa** calculados por `skills/lecture/`.

Incluye la dirección de mitigación en `calc/defense` como contrato separado dentro del mismo dominio.

## Responsabilidad

- Lee (por player con `H == 1`):
  - `DanoTotalH`, `PoderTotalH`, `DanoCritTotalH`, `ProbCritTotalH`
  - `MATotalH`, `MMTotalH`
  - `DefensaTotalH`, `ManaTotalH`
- Escribe (outputs legacy consumidos por combat/):
  - `DanoFinalSC`, `DanoFinalCC`
  - `ProbabilidadCriticaTotal` (int)
  - `DtotalH` (copia de `DefensaTotalH`) y `MtotalH` (copia de `ManaTotalH`)

### Submódulo de mitigación

- `calc/defense/` implementa la mitigación de daño por defensa como funciones puras.
- `damage_dealt/byplayer` y `damage_dealt/by_mob` consumen `computeDefenseMitigation()` directamente.
- Soporta penetración de armadura (`PenArmorTotalH`) y cap configurable de reducción máxima.
- Ver `calc/defense/README.md` para contrato completo, fórmula y guía de extensión.

> `VidaMaxTotalH` ya lo escribe `skills/lecture/` (no se escribe aquí para evitar múltiples writers).

## Notas de compatibilidad

- La capa **Personal** actualmente sigue viviendo en scoreboards legacy (`DMGH`, `CDH`, `CCH`, `DH`, `MH`, `MAH`, `MMH`).
- `skills/lecture/` los consume como Personal para construir `*TotalH` durante la migración.

Compatibilidad de lectura/escritura en transición:
- `calc` prioriza los inputs `*TotalH` de `lecture/`.
- Mantiene salidas legacy (`ProbabilidadCriticaTotal`, `DtotalH`, `MtotalH`) porque todavía hay consumidores en `combat/`.
  
## Optimización runtime (estado actual)

- Existe caché por jugador (`cacheByPlayerKey`) para evitar recalcular cuando los inputs no cambiaron.
- Hay escritura condicional: solo se escriben outputs si el resultado difiere del último cálculo.
- Si `H != 1`, el módulo hace early-exit y puede poner salidas en `0` según configuración (`disabledBehavior.zeroOutputs`).

## Seguridad y hardening

- **Limpieza de debug map**: `lastDebugMsByPlayerKey` se elimina junto con `cacheByPlayerKey` cuando un jugador deja el set activo, evitando leak de memoria por sesión.
- **NaN en lecture/totales**: `lecture/index.js` guarda `0` en lugar de `NaN` cuando la suma de stats no es finita (`Number.isFinite` guard). La comparación de caché reemplazó `JSON.stringify` (que convierte NaN a null) por comparación directa por stat.
