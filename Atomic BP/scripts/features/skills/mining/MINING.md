# Skill Mining — Especificación de Niveles (v1)

Documento de diseño para la skill de minería por niveles.

Objetivo: definir una lógica clara, configurable y lista para implementar en scripts, sin ambigüedades de reglas.

---

## 1) Alcance

Este documento cubre:

- Modelo de XP y nivel para mining.
- Contrato de configuración de niveles (60 niveles iniciales).
- Requisitos adicionales por nivel (ejemplo: scoreboard Acto).
- Recompensas por nivel (incluyendo scoreboards).
- Formato de mensajes de subida.
- Conversión a números romanos para mostrar niveles.
- Integración con el sistema actual de minería/regeneración.

Este documento no implementa código.

---

## 2) Estado actual de la implementación (referencia)

Actualmente la minería se procesa desde skills/regeneration:

- Se intercepta el minado y se aplican drops custom.
- Ya existe soporte para sumar scoreboards por bloque/modifier mediante scoreboardAddsOnBreak.
- El catálogo central de scoreboards se inicializa en scripts/scoreboards.

Implicación para mining levels:

- La fuente principal de XP de minería puede entrar por scoreboardAddsOnBreak.
- El sistema de niveles leerá scoreboards persistentes por jugador (sin dynamic properties para XP/lvl).

---

## 3) Scoreboards oficiales de mining levels

Para esta feature se oficializan estos objetivos:

- SkillXpMineria: XP acumulada total de minería.
- SkillLvlMineria: nivel actual de minería.

Notas:

- Estos nombres se usarán como contrato aunque en esta rama aún no estén mergeados.
- La XP no se reinicia al subir nivel; siempre es acumulativa.

---

## 4) Reglas funcionales de nivelado

### 4.1 Regla base

- El jugador inicia en Nivel 1 con 0 XP.
- Umbrales ejemplo:
    - Nivel 1: 0 XP
    - Nivel 2: 20 XP
    - Nivel 3: 100 XP

### 4.2 Nivel único

- Un jugador solo puede tener un nivel activo a la vez.
- El nivel final debe ser el nivel más alto cuyo requisito esté cumplido.

### 4.3 XP acumulativa

- Toda XP ganada se suma en SkillXpMineria.
- Nunca se hace reset de XP por subir nivel.

### 4.4 Requisitos adicionales por nivel

Un nivel puede pedir condiciones extra además de XP.

Ejemplo:

- Nivel 4 requiere:
    - XP mínima: 500
    - Acto >= 1

Si el jugador tiene XP suficiente pero no cumple Acto, no sube a ese nivel.

### 4.5 Dependencia estricta entre XP, nivel y recompensas

- El nivel depende únicamente de la XP y requisitos del nivel.
- Las recompensas activas dependen del nivel actual resuelto.
- Si el nivel sube, se aplican recompensas del nuevo rango alcanzado.
- Si el nivel baja (porque bajó la XP), se retiran recompensas de niveles ya no alcanzados.

Regla clave:

- XP cambia -> se recalcula nivel -> se reconcilian recompensas.

---

## 5) Contrato de configuración sugerido

Archivo recomendado: skills/mining/config.js

```js
export const miningSkillConfig = {
    enabled: true,

    scoreboards: {
        xp: "SkillXpMineria",
        level: "SkillLvlMineria"
    },

    maxLevel: 60,

    // Mensaje de subida (chat)
    levelUpMessage: [
        "Habilidad mejorada!!!",
        "RECOMPENSAS",
        "+<PreviousFortune> -> <NextFortune> de Fortuna Minera",
        "<OtherAwards>"
    ],

    // Definición de niveles (ejemplo parcial)
    // level: número de nivel (1..60)
    // xpRequired: XP mínima acumulada
    // requirements: reglas extra opcionales
    levels: [
        {
            level: 1,
            xpRequired: 0,
            rewards: {
                scoreboardAdds: [
                    { objective: "FortMin", amount: 4 }
                ],
                messageAwards: []
            }
        },
        { level: 2, xpRequired: 20 },
        { level: 3, xpRequired: 100 },
        {
            level: 4,
            xpRequired: 500,
            requirements: [
                { type: "scoreboardMin", objective: "Acto", min: 1 }
            ],
            rewards: {
                scoreboardAdds: [
                    { objective: "FortMin", amount: 4 }
                ],
                messageAwards: [
                    "Acceso a zona de minería avanzada"
                ]
            }
        }
    ]
};
```

Reglas de validez del contrato:

- levels debe estar ordenado por level ascendente.
- level no se repite.
- xpRequired es monotónico no decreciente.
- level 1 debe existir con xpRequired = 0.
- levels no debe superar maxLevel.
- rewards (si existe) debe ser válido:
    - scoreboardAdds: array de `{ objective, amount }`.
    - messageAwards: array de strings para líneas extra del mensaje.

Contrato recomendado para esta versión:

- Todos los niveles 1..60 otorgan `+4` de `FortMin`.
- Resultado acumulativo: en nivel `N`, Fortuna Minera otorgada por niveles = `N * 4`.
- Ejemplo: nivel 10 => +40, nivel 20 => +80.

---

## 6) Algoritmo esperado de resolución de nivel

Entrada por jugador:

- XP actual = SkillXpMineria.
- Nivel actual = SkillLvlMineria.
- Estado de scoreboards extra (ejemplo: Acto).

Proceso:

1. Leer XP actual.
2. Evaluar niveles en orden ascendente.
3. Un nivel se considera alcanzable si:
     - XP actual >= xpRequired.
     - Se cumplen todos los requirements del nivel (si existen).
4. Elegir el nivel alcanzable más alto.
5. Reconciliar recompensas según diferencia de nivel:
    - Si sube: aplicar recompensas de los niveles nuevos.
    - Si baja: retirar recompensas de niveles ya no alcanzados.
6. Actualizar SkillLvlMineria al nivel final resuelto.
7. Emitir mensaje de cambio de nivel según política final.

Comportamiento recomendado para saltos múltiples:

- Si el jugador pasa de Nivel 1 a Nivel 4 en una sola operación, mostrar una única notificación final:
    - PreviousLevel = 1
    - NextLevel = 4

Política de recompensas recomendada (idempotente):

- En lugar de aplicar/restar incrementos acumulativos por eventos, calcular valor objetivo por fórmula.
- Para Fortuna Minera por nivel:
    - `targetFortMin = SkillLvlMineria * 4`
- Ajustar el scoreboard al target para evitar desincronización.

---

## 7) Mensajería de subida de nivel

Canal inicial: chat.

Plantilla configurable (array de líneas):

- Línea 1: título libre.
- Líneas siguientes: detalle de recompensas y extras.

Placeholders soportados:

- <PreviousLevel>
- <NextLevel>
- <PreviousFortune>
- <NextFortune>
- <OtherAwards>

Semántica sugerida:

- `<PreviousFortune>`: valor de Fortuna Minera antes de reconciliar.
- `<NextFortune>`: valor final de Fortuna Minera después de reconciliar.
- `<OtherAwards>`: bloque de líneas dinámicas (0..N) con recompensas textuales del nivel alcanzado.

Ejemplo de template:

```js
levelUpMessage: [
    "Habilidad mejorada!!!",
    "RECOMPENSAS",
    "+<PreviousFortune> -> <NextFortune> de Fortuna Minera",
    "<OtherAwards>"
]
```

Ejemplo final en chat (sube a nivel 20):

Habilidad mejorada!!!
RECOMPENSAS
+76 -> 80 de Fortuna Minera
- Acceso a Zona X

---

## 8) Números romanos (visual)

Regla:

- El scoreboard guarda nivel en entero.
- Solo para mostrar, se convierte a romano.

Requisitos:

- Soportar al menos 1..60.
- Validar entradas fuera de rango para evitar errores visuales.
- Si llega un valor inválido, fallback recomendado: mostrar número arábigo.

---

## 9) Integración con regeneración/minado

Para conectar con el sistema actual:

- Usar scoreboardAddsOnBreak para sumar SkillXpMineria al romper bloques válidos.
- Luego ejecutar la verificación de nivel (resolver nivel más alto alcanzable).
- Después reconciliar recompensas dependientes del nivel (incluyendo FortMin).

Ejemplo conceptual por bloque de carbón:

```js
scoreboardAddsOnBreak: {
    SkillXpMineria: 1
}
```

Esto permite que mining levels sea independiente de la lógica de drops/regeneración.

---

## 10) Casos borde obligatorios

- Jugador nuevo sin entradas previas: inicializar XP=0 y Level=1.
- Scoreboard inexistente: crear/asegurar objetivo antes de operar.
- XP negativa por error externo: clamp mínimo a 0.
- Niveles mal configurados: desactivar subida y loggear warning de configuración.
- Requisitos extra no válidos: ignorar ese nivel y registrar warning.
- Bajada de XP por fuente externa: recalcular nivel hacia abajo y retirar recompensas de niveles no alcanzados.
- Desincronización de recompensa (FortMin distinto al target): corregir al valor objetivo en reconciliación.

---

## 11) Checklist de pruebas manuales (post-implementación)

1. Jugador nuevo entra:
     - SkillXpMineria = 0
     - SkillLvlMineria = 1
2. Suma XP hasta 19:
     - Permanece en nivel 1.
3. Suma XP hasta 20:
     - Sube a nivel 2.
    - Mensaje muestra recompensa de fortuna (anterior -> nuevo).
4. Subida con salto (ej: de 20 a 500):
     - Resuelve nivel máximo permitido por requisitos.
5. Nivel con requisito Acto:
     - Sin Acto suficiente no sube.
     - Al cumplir Acto, sube correctamente.
6. Bajada de XP (simulada por admin):
    - Baja nivel si corresponde.
    - Se ajusta Fortuna Minera al valor del nuevo nivel.
7. Nivel con recompensa especial (ej: nivel 20):
    - Mensaje incluye líneas extra en `<OtherAwards>`.

---

## 12) Mejoras recomendadas para considerar

1. Cache de último nivel mostrado por tick para evitar mensajes duplicados.
2. Cooldown corto de notificaciones (anti-spam en granjas de minería).
3. Modo debug por jugador para trazar por qué no sube (XP o requisito faltante).
4. Hook reutilizable para otras skills (foraging/farming) con mismo motor de niveles.
5. Registro de telemetría opcional: XP/minuto y niveles alcanzados.

---

## 13) Decisiones de contrato cerradas en esta versión

- Se usará SkillXpMineria y SkillLvlMineria como IDs oficiales.
- Nivel inicial: 1 con 0 XP.
- Se documenta estado actual + objetivo futuro.
- Mensaje de subida por chat con array configurable:
    - ["Habilidad mejorada!!!", "RECOMPENSAS", "+<PreviousFortune> -> <NextFortune> de Fortuna Minera", "<OtherAwards>"]
- Visual de niveles en números romanos.
- Recompensa base por nivel 1..60: `+4` a `FortMin` (acumulativa por nivel actual).
- Si el nivel baja por XP, se retiran recompensas de niveles superiores automáticamente.