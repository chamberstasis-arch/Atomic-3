# Skills Core

> Minecraft Bedrock 1.21.132 · `@minecraft/server` 2.4.0

Documento rector de `skills/core/`.

Este modulo ya funciona como runtime compartido de `mining/`, `foraging/` y `farming/`. El contrato ya es consumible en produccion del addon.

---

## 1. Objetivo

`core/` es el motor compartido de progresion para las skills que comparten el patron:

- Ganancia de XP por evento.
- Resolucion de nivel por thresholds y requisitos.
- Reconciliacion del nivel y de la reward principal por politica de skill.
- Mensajeria de progreso y subida de nivel.
- API comun para integrarse con `regeneration/` y con skills consumidoras.

El objetivo es eliminar duplicacion entre `mining/`, `foraging/` y `farming/` sin colapsarlas en un unico archivo.

---

## 2. Responsabilidad del modulo

`core/` debe:

- Resolver nivel actual de una skill.
- Calcular XP requerida para el siguiente nivel.
- Reconciliar nivel, objective principal y mensajes de cambio de nivel.
- Proveer helpers para responder a scoreboards aplicados en runtime.
- Exponer una API estable para skills consumidoras.
- Trabajar por `skillId`, no por nombres hardcodeados de mineria.
- Emitir sonido y particulas de subida de nivel cuando el catalogo lo define.

`core/` no debe:

- Leer lore.
- Interceptar rotura de bloques.
- Crear objectives de scoreboard.
- Definir drops o bloques regenerables.
- Hardcodear reglas exclusivas de una skill.

## 2.1 Estado actual del runtime

El comportamiento vigente del runtime debe leerse tal como esta implementado hoy:

- `registerSkillDefinition()` esta pensado para bootstrap. Re-registrar una skill despues de activar su loop no reinicia el `runInterval` ya creado.
- La reward principal puede preservarse al maximo historico cuando la skill define `runtime.preserveHigherPrimary=true`.
- Las rewards aditivas declaradas en `rewards.scoreboardAdds` se aplican en subidas de nivel y saltos multiples hacia arriba.
- Las rewards aditivas no se reconstruyen automaticamente hacia abajo cuando la XP o los requisitos administrativos hacen bajar el nivel.

Esto significa que `core/` hoy resuelve correctamente XP, nivel, mensajes y reward principal segun politica, pero no debe documentarse como un reconciliador totalmente bidireccional para todos los objectives secundarios.

---

## 3. Dependencias oficiales

### Entrada esperada

- Objectives ya creados por `scripts/scoreboards/`.
- Eventos o scoreboards aplicados desde `regeneration/`.
- Catalogos de skill declarados por `mining/`, `foraging/` o `farming/`.

### Salida esperada

- Scoreboards de nivel actual.
- Objective principal segun la politica activa de la skill.
- Aplicacion incremental de rewards aditivas en level up.
- Mensajes, sonidos y particulas de level up, o hooks custom si la skill los redefine.

### Regla de dependencia

`core/` puede depender de scoreboards, pero no puede crear objectives.

Toda nueva necesidad de objective debe registrarse antes en:

- `scripts/scoreboards/catalog.js`
- `scripts/scoreboards/init.js`

---

## 4. API publica vigente

El modulo ya expone una API publica estable para consumo desde skills y motores globales.

Contratos recomendados:

```js
initSkillsCore(config)
registerSkillDefinition(skillId, definition)
getSkillDefinition(skillId)
getSkillNextXpRequirement(skillId, currentLevel)
reconcileSkillForPlayer(skillId, player, source)
onSkillScoreboardsApplied(skillId, player, addsMap)
```

### Regla de exportacion

- Preferir named exports.
- Evitar mezclar `default export` y `named exports` en el mismo contrato publico.
- Exponer la API publica desde `core/index.js`.
- Evitar que consumidores importen archivos internos salvo necesidad real de implementacion.
- Tratar `registerSkillDefinition()` como operacion de arranque y no como hot-reload completo del runtime.

---

## 5. Modelo de definicion por skill

Cada skill consumidora debe poder registrar un contrato declarativo similar a este:

```js
export const foragingSkillDefinition = {
  id: "foraging",
  displayName: "Tala",
  scoreboards: {
    xp: "SkillXpTala",
    level: "SkillLvlTala"
  },
  rewards: {
    primaryObjective: "FortTalPersonalH",
    perLevel: 4
  },
  levels: [
      { level: 1, xpRequired: 0 },
      { level: 2, xpRequired: 20, sound: "note.pling", particle: "minecraft:totem_particle" }
  ],
  presentation: {
    levelUpMessage: [
      "Habilidad mejorada",
      "<PreviousLevel> -> <NextLevel>"
    ]
  }
};
```

### Propiedades minimas esperadas

- `id`
- `displayName`
- `scoreboards.xp`
- `scoreboards.level`
- `levels`

### Propiedades opcionales recomendadas

- `requirements`
- `rewards`
- `presentation`
- `debug`

### Efectos visuales de subida de nivel

El `core/` reproduce por defecto en cada level up:

- Sonido: `random.levelup`
- Partícula: `minecraft:totem_particle`

Cada nivel puede sobrescribirlos con campos simples en la entrada del nivel:

```js
{ level: 5, xpRequired: 260, sound: "note.pling", particle: "minecraft:happy_villager_particle" }
```

También acepta formato objeto para personalizar volumen, pitch, cantidad u offset:

```js
{
   level: 10,
   xpRequired: 1460,
   sound: { id: "note.pling", volume: 0.8, pitch: 1.25 },
   particle: {
      id: "minecraft:totem_particle",
      count: 6,
      offset: { x: 0, y: 0.5, z: 0 }
   }
}
```

---

## 6. Flujo funcional actual

```mermaid
flowchart TD
    A[regeneration aplica addsMap] --> B[core identifica skillId]
    B --> C[core lee XP y level actuales]
    C --> D[core resuelve nuevo nivel]
   D --> E[core ajusta level y objective principal segun politica]
   E --> F[core aplica rewards aditivas si hubo level up]
   F --> G[core emite mensaje y efectos o delega hook custom]
```

---

## 7. Responsabilidades internas

### `registry.js`

- Registrar definiciones por `skillId`.
- Validar shape minimo del contrato.
- Mantener una fuente simple de verdad por definicion registrada.

### `progression.js`

- Resolver nivel alcanzable.
- Calcular siguiente threshold.
- Validar requirements adicionales.
- Aplicar reward principal por target segun configuracion.
- Aplicar rewards aditivas en subidas de nivel.
- Construir payloads de mensaje y placeholders de subida.
- Emitir sonido y particulas de level up.

### `scoreboards.js`

- Centralizar helpers de lectura y escritura de score.
- Compartir politicas de clamp, validacion y retry.
- No crear objectives.

---

## 8. Casos de uso

### Caso 1. Mining como skill consumidora

- `regeneration/` suma `SkillXpMineria`.
- `core/` resuelve `SkillLvlMineria`.
- `mining/` define rewards y mensaje de subida.

### Caso 2. Foraging como skill consumidora

- `regeneration/` suma `SkillXpTala`.
- `core/` resuelve `SkillLvlTala`.
- `foraging/` define rewards de tala y presentation layer.

### Caso 3. Farming como skill consumidora

- `regeneration/` suma `SkillXpCosecha`.
- `core/` resuelve `SkillLvlCosecha`.
- `farming/` define requisitos y mensajes propios.

### Caso 4. Skill futura con mismo patron

- Registra definicion declarativa.
- Usa el mismo motor de progresion.
- No copia la implementacion de otra skill.

---

## 9. Casos borde obligatorios

- Jugador nuevo con XP o nivel inexistente.
- XP negativa por error externo.
- Scoreboard configurado pero no catalogado.
- Nivel mal configurado o duplicado.
- Rewards desincronizadas respecto al nivel actual.
- Salto multiple de niveles en un solo evento.
- Bajada de XP por comando o ajuste administrativo.
- Re-registro accidental de una misma skill durante runtime.

---

## 10. Pruebas manuales en Minecraft

### Preparacion

- Confirmar que `initAllScoreboards()` corre antes de skills.
- Confirmar que los objectives de la skill existen en el mundo.
- Tener una zona de prueba con bloques validos para la skill.

### Validaciones de progresion

1. Jugador nuevo entra al mundo.
   Resultado esperado:
   `SkillXp* = 0` y `SkillLvl* = 1` o al baseline definido por el contrato.

2. Jugador gana XP por un evento valido.
   Resultado esperado:
   sube solo la XP correspondiente a la skill activa.

3. Jugador alcanza el threshold de nivel.
   Resultado esperado:
   `core/` recalcula nivel y reconcilia reward.

4. Jugador recibe un salto grande de XP.
   Resultado esperado:
   se calcula el nivel final maximo alcanzable, sin pasar por niveles invalidos.

5. Se reduce XP por comando.
   Resultado esperado:
   el nivel baja si corresponde. La reward principal sigue la politica `preserveHigherPrimary` de la skill y las rewards aditivas no se retiran automaticamente hacia abajo.

### Validaciones de robustez

1. Desactivar temporalmente una skill en config.
   Resultado esperado:
   el core no debe romperse ni contaminar otras skills.

2. Forzar un objective faltante en catalogo durante desarrollo.
   Resultado esperado:
   se detecta error de dependencia documental, no se resuelve creando objectives desde `core/`.

3. Probar con varios jugadores simultaneos.
   Resultado esperado:
   el progreso se resuelve por jugador sin mezclar scoreboards.

---

## 11. Criterios de exito

- `mining/`, `foraging/` y `farming/` comparten el mismo motor de progreso.
- `regeneration/` deja de depender de `mining/` como caso especial.
- Ninguna skill crea objectives por su cuenta.
- La API publica del core es estable y facil de consumir.
- Las pruebas manuales en Minecraft confirman progresion consistente y documentan claramente la politica actual de rewards persistentes.

---

## 12. Siguiente paso recomendado

Formalizar `farming/` sobre el mismo contrato y decidir si la siguiente iteracion del core debe volver bidireccional la reconciliacion de rewards secundarias o mantener la politica incremental actual como decision de gameplay permanente.

---

## 13. Seguridad y hardening

- **isValid guard en reconciliación**: `reconcileSkillForDefinition()` retorna `false` inmediatamente si `player.isValid === false`, evitando acceso a propiedades de entidades desconectadas.