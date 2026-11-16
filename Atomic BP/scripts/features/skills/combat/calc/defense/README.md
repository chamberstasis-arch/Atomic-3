# Skills / Combat / Calc / Defense

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Ruta: `Atomic BP/scripts/features/skills/combat/calc/defense`

Este módulo implementa la capa de **mitigación de daño por defensa** del pipeline de combate.

## Estado

**Activo** — la lógica de mitigación vive en `index.js` como funciones puras. `damage_dealt/byplayer` y `damage_dealt/by_mob` consumen directamente `computeDefenseMitigation()`.

## Archivos

| Archivo | Responsabilidad |
|---------|----------------|
| `config.js` | Constantes de fórmula, scores referenciados, modifiers extensibles |
| `index.js` | Funciones puras de mitigación (`computeDefenseMitigation`, `applyDefenseMultiplier`) |

## Contrato funcional

### `computeDefenseMitigation(cfg, danoBase, defensa, armorPenetrationPct)` → `number`

Entradas:
- `cfg` — configuración (`defenseCalcConfig` o override)
- `danoBase` — daño antes de mitigación (entero positivo)
- `defensa` — defensa total del objetivo (`DefensaTotalH` / `DtotalH`)
- `armorPenetrationPct` — penetración de armadura del atacante (0–100, `PenArmorTotalH`)

Salida:
- `danoMitigado` entero (`>= 0`)

### `applyDefenseMultiplier(danoBase, defensa)` → `number`

Wrapper de compatibilidad — misma firma que la función original en `damage_dealt/math.js`.
Internamente llama `computeDefenseMitigation(defenseCalcConfig, danoBase, defensa, 0)`.

## Fórmula completa

### Penetración de armadura

$$
defEfectiva = defensa \times \left(1 - \frac{\text{clamp}(pen, 0, 100)}{100}\right)
$$

### Ratio de mitigación

$$
ratio = \frac{baseConstant}{defEfectiva + baseConstant}
$$

Donde `baseConstant` = 75 por defecto (configurable en `config.js`).

### Cap de reducción máxima

$$
ratio = \max\left(ratio,\ 1 - \frac{maxReductionPercent}{100}\right)
$$

Con `maxReductionPercent` = 90 por defecto → defensa nunca reduce más del 90%.

### Resultado final

$$
danoMitigado = \left\lfloor danoBase \times ratio \right\rfloor,\quad \geq 0
$$

## Scoreboards referenciados

| Score | Dirección | Descripción |
|-------|-----------|-------------|
| `DefensaTotalH` | input | Defensa total del objetivo (producido por `lecture/`) |
| `DtotalH` | input (legacy) | Fallback de defensa total |
| `PenArmorTotalH` | input | Penetración de armadura del atacante (0–100%) |

> `PenArmorTotalH` sigue convención de `lecture/` (`*TotalH`). Se registrará en `statRegistry` cuando `lecture/` le dé soporte.

## Configuración (`config.js`)

```js
defenseCalcConfig = {
  formula: {
    baseConstant: 75,          // constante de la curva
    maxReductionPercent: 90,   // cap de reducción (1–100)
  },
  scores: {
    defenseTotal: "DefensaTotalH",
    defenseTotalLegacy: "DtotalH",
    armorPenetration: "PenArmorTotalH",
  },
  modifiers: [],               // extensible para mitigaciones futuras
}
```

### Cómo agregar nuevos modifiers

1. Definir el score en `scores` (convención `*TotalH`)
2. Añadir entrada en `modifiers[]` con `{ type: "flat"|"percent", source: "ScoreName", value: 0 }`
3. El consumidor lee el score y lo pasa como argumento adicional

## Integración con effects/ (futuro)

`effects/` puede consumir `computeDefenseMitigation()` opcionalmente para aplicar mitigación a daño por efectos. Actualmente los efectos calculan daño como `% de VidaMax` y **no pasan por defensa**. La activación requiere:

1. Agregar flag `applyDefense: true` en la config del efecto
2. En `effects/tick.js`, importar y llamar `computeDefenseMitigation()` antes de aplicar el daño
3. Decidir si penetración del efecto es fija (config) o variable (score)

## Reglas de diseño

- Funciones puras: sin side-effects de scoreboards ni dimensión.
- Determinista e idempotente: mismos inputs → mismo output.
- No crear objectives; solo referenciar scoreboards catalogados.
- Clampear para evitar `NaN`, `Infinity` y negativos.
- Resolución de input (fallback `DefensaTotalH` → `DtotalH`) queda en el consumidor, no en la fórmula.
