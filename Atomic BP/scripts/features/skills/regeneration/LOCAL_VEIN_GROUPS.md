# Regeneration — Grupos Locales de Veta (Modelo D)

> Especificación funcional y operativa para agrupar roturas locales y regenerar en conjunto.

## 1) Objetivo

Definir un modelo seguro (multijugador) donde la regeneración se realice por **grupos locales de veta** y no por un grupo global de toda el área.

Este documento formaliza:

- reglas de pertenencia al grupo,
- cierre por ventana temporal,
- restauración conjunta por grupo,
- uso y límites de `dynamic properties`,
- capacidad estimada de vetas regenerables,
- casos de uso y flujo operativo.

---

## 2) Principio base (decisión tomada)

Se adopta el modelo D:

1. Se forman **grupos locales de veta**, nunca grupos globales del mapa.
2. Un bloque entra al grupo solo si cumple **todas** estas condiciones al mismo tiempo:
   - misma dimensión,
   - misma área,
   - misma skill / misma familia de bloque,
   - adyacencia física (vecinos ortogonales).
3. Existe una **ventana temporal corta** de unión.
4. Si vence la ventana sin nuevos bloques, el grupo se cierra.
5. Solo regeneran juntos los bloques minados dentro de ese grupo.

---

## 3) Invariantes obligatorias

## 3.1 Scope de grupo

Un grupo queda acotado por el scope:

`(dimensionId, areaId, skillId, familyId)`

Si cambia cualquiera de esos 4 campos, se crea grupo nuevo.

## 3.2 Regla de adyacencia

Un nuevo bloque solo puede unirse si es adyacente ortogonalmente a algún miembro ya existente del grupo:

- eje X: ±1
- eje Y: ±1
- eje Z: ±1

No cuenta diagonal.

## 3.3 Ventana de unión

`groupWindowMs` define cuánto tiempo permanece abierto el grupo para recibir bloques nuevos.

- Recomendado inicial: `3000ms` a `5000ms`.
- Cada bloque nuevo dentro de ventana extiende `closeAt` (ventana deslizante).

## 3.4 Cierre y regeneración

- Cuando `now >= closeAt`, el grupo queda **cerrado**.
- Un grupo cerrado no acepta más miembros.
- Se programa **un solo timer** de regeneración para el grupo.
- Al vencer, restaura todos sus miembros en lote.

---

## 4) Ejemplo canónico (G1 / G2)

1. Minas 1 carbón → se crea `G1` con 1 miembro.
2. Minas 4 carbones pegados en los siguientes segundos → se unen a `G1`.
3. `G1` queda con 5 miembros y un único timer de regeneración.
4. Cuando vence el timer, esos 5 bloques vuelven juntos.
5. Si otro carbón está lejos o se mina fuera de ventana, crea `G2` separado.

Resultado: comportamiento local, predecible y sin mezclar vetas no relacionadas.

---

## 5) Modelo de datos implementado

> Esta sección describe el contrato persistente aplicado en runtime para grupos locales.

## 5.1 Estructura de grupo persistible

```js
{
  id: "g:ovw:A:mining:coal:1710800012345:8f2c",
  dimensionId: "minecraft:overworld",
  areaId: "A",
  skillId: "mining",
  familyId: "coal",
  status: "open", // open | closed | restoring
  createdAt: 1710800012345,
  closeAt: 1710800016345,
  restoreAt: 1710800076345,
  members: [
    { x: 120, y: 14, z: 95, blockId: "minecraft:deepslate_coal_ore", minedBlockId: "minecraft:black_concrete" }
  ],
  owner: {
    firstPlayerId: "<runtime-id-opcional>",
    contributors: 1
  }
}
```

## 5.2 Clave lógica de partición

Para evitar colisiones/race y reducir payload por DP:

`scopeKey = atomic3:regen_groups:<dimension>:<area>:<skill>:<family>`

No usar una DP global para todos los grupos de todo el mundo.

---

## 6) Chequeo de posibilidades para Dynamic Properties

## 6.1 Opción A — DP única global

- Estructura: un solo JSON con todos los grupos.
- Ventaja: simple.
- Riesgo: alto (contención, truncado, recortes agresivos).
- Estado: **no recomendado**.

## 6.2 Opción B — DP por scope (recomendada)

- Estructura: una DP por `(dimension, area, skill, family)`.
- Ventaja: aislamiento, menor tamaño por key, mejor concurrencia lógica.
- Riesgo: medio-bajo.
- Estado: **recomendada**.

## 6.3 Opción C — Híbrida (índice + shards)

- Estructura: índice liviano global + payload en shards por scope.
- Ventaja: mejor observabilidad y limpieza.
- Riesgo: complejidad mayor.
- Estado: opción futura si escala de grupos aumenta mucho.

---

## 7) Límites y capacidad estimada

## 7.1 Límites actuales observados

Desde `config.js` y `persistence.js`:

- `maxStringLength = 30000`
- `maxEntries = 1500`

En práctica, para JSON persistido el límite dominante suele ser `maxStringLength`.

## 7.2 Fórmula de capacidad

Para un shard (una DP):

- `capacityGroups = min(maxEntries, floor(maxStringLength / avgCharsPerGroup))`
- `capacityBlocks = capacityGroups * avgMembersPerGroup`

Con margen de seguridad del 20%:

- `effectiveMaxChars = 24000`
- `safeGroups = floor(effectiveMaxChars / avgCharsPerGroup)`

## 7.3 Escenarios de capacidad (estimación)

> Supuestos explícitos:
> - payload pequeño: grupo compacto (coords + ids cortos), `avgCharsPerGroup ≈ 220`
> - payload medio: metadata normal + miembros moderados, `avgCharsPerGroup ≈ 420`
> - payload grande: más miembros y estados, `avgCharsPerGroup ≈ 800`

| Escenario | avgCharsPerGroup | safeGroups por DP (24k) | Miembros promedio | safeBlocks por DP |
|---|---:|---:|---:|---:|
| Pequeño | 220 | 109 | 6 | 654 |
| Medio | 420 | 57 | 8 | 456 |
| Grande | 800 | 30 | 10 | 300 |

Lectura operativa:

- En operación real, una DP por scope debería moverse en torno a **30–100 grupos activos** según payload.
- Traducido a bloques pendientes, rango seguro típico: **300–650 bloques por DP**.

## 7.4 Límites operativos recomendados (guardrails)

Para minimizar truncados y mantener estabilidad:

- `maxMembersPerGroup`: 12
- `maxOpenGroupsPerScope`: 40
- `maxClosedPendingPerScope`: 80
- `maxGroupsPerScopeTotal`: 120 (open + closed)
- `groupWindowMs`: 3000–5000
- limpieza preventiva cuando payload del shard supere ~80% del presupuesto.

---

## 8) Casos de uso

## Caso 1 — Merge local dentro de ventana

- Player mina 1 bloque de carbón.
- Mina 3 carbones adyacentes en < 3s.
- Se mantiene un único grupo y un único restore.

## Caso 2 — Fuera de ventana

- Player mina 2 carbones.
- Espera 8s (ventana 4s) y mina otro cercano.
- El nuevo bloque crea grupo distinto.

## Caso 3 — Mismo lugar, distinta familia

- Mina carbón y luego hierro adyacente.
- Aunque estén pegados, si `familyId` cambia, van a grupos distintos.

## Caso 4 — Cambio de área

- Mina bloque al borde y otro en área vecina.
- Como `areaId` cambia, no mergea; se abre nuevo grupo.

## Caso 5 — Multijugador simultáneo

- Jugador A y B minan la misma veta local en ventana.
- Se fusiona en un único grupo de scope si cumple invariantes.
- Contribuciones pueden registrarse en `contributors` sin romper timer único.

## Caso 6 — Spread + grupo local

- Un bloque inicial dispara spread y afecta vecinos válidos.
- Los targets válidos se agregan al mismo grupo si están en ventana/scope.
- Si algún target cae fuera de scope, se descarta o abre grupo independiente según regla de integración.

---

## 9) Reglas anti-riesgo (multijugador)

1. No mezclar miembros de distintos scopes.
2. No abrir grupos infinitos: usar `maxMembersPerGroup`.
3. No reusar grupo cerrado.
4. No agendar múltiples timers por mismo grupo.
5. Restauración idempotente: si un bloque ya fue restaurado, saltar sin error.
6. En reinicio de mundo, rehidratar por shard y resolver por estado (`open/closed/restoring`).

---

## 10) Diagrama Mermaid (flujo)

```mermaid
flowchart TD
    A[Player break block] --> B{Gate H >= 1}
    B -- No --> Z[Ignorar evento]
    B -- Yes --> C{Bloque configurado\n+ area valida}
    C -- No --> Z
    C -- Yes --> D[Resolver scope\n(dimension, area, skill, family)]

    D --> E{Existe grupo OPEN\nadyacente y dentro de ventana?}
    E -- Yes --> F[Agregar bloque a grupo existente]
    E -- No --> G[Crear nuevo grupo OPEN]

    F --> H[Actualizar closeAt (ventana deslizante)]
    G --> H

    H --> I{Spread activo?}
    I -- Yes --> J[Resolver targets BFS\nvalidar scope + adyacencia]
    I -- No --> K
    J --> K[Persistir shard DP del scope]

    K --> L{now >= closeAt?}
    L -- No --> M[Esperar mas eventos]
    L -- Yes --> N[Cerrar grupo\nstatus=closed]

    N --> O[Programar timer unico por grupo\nrestoreAt]
    O --> P{Timer vencido}
    P -- No --> O
    P -- Yes --> Q[Restaurar todos los miembros]
    Q --> R[Marcar grupo completado\nlimpiar persistencia]
```

---

## 11) Checklist de implementación

- [x] Añadir identificador de `familyId` consistente por bloque/definición.
- [x] Introducir particionado de DP por scope (con índice + fallback controlado).
- [x] Definir compactación/recorte seguro JSON bajo límite de DP.
- [ ] Instrumentar métricas detalladas: grupos abiertos/cerrados, restore latency, payload chars.
- [x] Definir y aplicar política de guardrails cuando se exceden límites por scope.

---

## 12) Resumen ejecutivo

- La regeneración por grupos locales evita mezclar vetas no relacionadas.
- El criterio de pertenencia simultánea (dimensión + área + skill/familia + adyacencia + ventana) garantiza coherencia de gameplay.
- Para `dynamic properties`, la opción más balanceada es **DP por scope**.
- Con límites actuales de 30k chars por DP, el rango seguro típico es **30–100 grupos** o **300–650 bloques** por shard, según payload.
- El modelo es viable para multijugador si se aplican guardrails de tamaño, estados y timer único por grupo.
