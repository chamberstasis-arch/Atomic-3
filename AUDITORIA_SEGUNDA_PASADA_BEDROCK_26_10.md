# Auditoria Segunda Pasada - Bedrock 26.10

Fecha: 2026-03-25
Workspace: c:\Users\anthe\Desktop\Desarrollo
Repo auditado: Atomic-3
Objetivo: consolidar una segunda pasada de revision tecnica, con enfasis en integridad actual, compatibilidad con la linea estable actual de Minecraft Bedrock, escalabilidad del proyecto y cambios requeridos para reducir errores presentes y futuros.

## 1. Alcance y criterio de revision

Esta revision cubre:

- Packs y manifests.
- Inicializacion global del proyecto.
- Sistema de combate: calc, damageCancel, damage_dealt, health, damage_title y skill combat.
- Skills core y emision de titulos de XP.
- systems/titlesPriority.
- features/holograms.
- Riesgos de migracion desde 1.21.132 hacia la linea estable actual identificada por el usuario como 26.10.

La revision se hizo en dos pasadas:

- Primera pasada: deteccion amplia de riesgos y contraste con documentacion oficial.
- Segunda pasada: descarte de falsos positivos, confirmacion de hallazgos con lectura directa de codigo y consolidacion de cambios requeridos.

## 2. Fuentes oficiales Microsoft consideradas

Se contrastaron APIs estables actuales de Microsoft Learn para Minecraft Bedrock Script API.

Fuentes oficiales usadas en la revision:

- WorldBeforeEvents: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldbeforeevents?view=minecraft-bedrock-stable
- WorldAfterEvents: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldafterevents?view=minecraft-bedrock-stable
- EntityHurtBeforeEvent: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityhurtbeforeevent?view=minecraft-bedrock-stable
- EntityHurtAfterEvent: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityhurtafterevent?view=minecraft-bedrock-stable
- EntityHurtAfterEventSignal: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityhurtaftereventsignal?view=minecraft-bedrock-stable
- EntityHealthComponent: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityhealthcomponent?view=minecraft-bedrock-stable
- EntityDamageSource: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entitydamagesource?view=minecraft-bedrock-stable
- EntityDamageCause: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entitydamagecause?view=minecraft-bedrock-stable
- ProjectileHitEntityAfterEventSignal: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/projectilehitentityaftereventsignal?view=minecraft-bedrock-stable
- Pack manifest reference: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/examples/addonmanifest?view=minecraft-bedrock-stable

Hallazgos documentales clave:

- `world.beforeEvents.entityHurt` y `world.afterEvents.entityHurt` siguen presentes en la superficie estable.
- `EntityHurtBeforeEvent.cancel` sigue siendo valido.
- `minecraft:health` sigue exponiendo `currentValue` y `effectiveMax`.
- `EntityDamageSource` sigue exponiendo `cause`, `damagingEntity` y `damagingProjectile`.
- `ProjectileHitEntityAfterEventSignal` existe y es la superficie mas precisa para proyectiles.
- La documentacion de `WorldInitializeAfterEvent` aparece como documentacion de version 1.x.x y marcada como deprecada/removida en 2.0.0, lo cual afecta cualquier uso residual de `worldInitialize` para dynamic properties o bootstrap.

## 3. Resumen ejecutivo

Estado general del proyecto:

- El proyecto no muestra una rotura global por desaparicion de APIs basicas en la linea estable actual.
- El mayor riesgo actual no esta en la existencia de APIs, sino en la logica montada encima de ellas, especialmente en combate y en inicializacion basada en APIs heredadas.
- Hay un problema confirmado de integridad entre BP y RP por dependencia de version desalineada.
- Hay un problema confirmado de robustez en el manejo ranged actual de mobs, porque el hook actual es demasiado amplio para la variedad actual de `EntityDamageCause`.
- Hay deuda tecnica transversal por uso residual de `worldInitialize` y por caches permanentes sin invalidez.

Prioridad operativa sugerida:

1. Corregir integridad de manifests.
2. Corregir en combate el flujo de proyectiles usando el evento especifico de proyectiles.
3. Reducir o redisenar la ventana de sync de health.
4. Eliminar dependencia de APIs heredadas tipo `worldInitialize`.
5. Consolidar contratos internos comunes para scoreboards, bootstrap y cache.

## 4. Hallazgos confirmados y cambios necesarios

### 4.1 Criticos

#### C1. Dependencia BP/RP desalineada

Archivos:

- Atomic BP/manifest.json
- RP/manifest.json

Estado actual:

- El BP declara `header.version` 1.0.1.
- El RP depende de la UUID del BP con version 1.0.0.

Implicacion:

- La referencia oficial de manifest indica que la dependencia debe coincidir con la version del pack requerido.
- Esto puede producir fallos de carga, cache inconsistente o desacoples silenciosos entre resource pack y behavior pack.

Cambio necesario:

- Alinear la dependencia del RP a la version actual real del BP.
- Definir una regla de versionado unica para BP, RP y modulos.

Prevencion futura:

- Introducir una verificacion automatica de coherencia de versions entre manifests antes de publicar.

#### C2. Manejo ranged de mobs demasiado amplio

Archivo:

- Atomic BP/scripts/features/skills/combat/damage_dealt/by_mob/index.js

Estado actual:

- Se usa `world.afterEvents.entityHurt` para capturar ranged.
- El filtro actual excluye parte del melee, pero el hook sigue siendo demasiado general para la variedad actual del enum `EntityDamageCause`.

Implicacion:

- El flujo custom puede dispararse sobre causas no deseadas: `magic`, `entityExplosion`, `sonicBoom`, `contact`, `projectile` indirecto o futuras ampliaciones del enum.
- En cambios de version, esta estrategia envejece peor que usar el evento especifico.

Cambio necesario:

- Reemplazar el hook principal ranged por `world.afterEvents.projectileHitEntity`.
- Dejar `entityHurt` solo como fallback cuidadosamente acotado, o eliminarlo si `projectileHitEntity` cubre los casos soportados por el diseño.
- Separar explicitamente melee, projectile y damage causes especiales.

Prevencion futura:

- Introducir una capa `damageSourceClassifier` centralizada que traduzca `EntityDamageSource` a categorias de negocio del proyecto.

#### C3. Uso de `worldInitialize` en una base que declara `@minecraft/server` 2.4.0

Archivos confirmados:

- Atomic BP/scripts/features/holograms/internal/dynamicProperties.js
- Atomic BP/scripts/features/skills/regeneration/persistence.js
- Atomic BP/scripts/features/anticheat/core/featureFlags.js

Estado actual:

- Hay codigo que todavia depende de `world.afterEvents.worldInitialize` y variantes relacionadas.
- La documentacion oficial de Microsoft para `WorldInitializeAfterEvent` aparece como documentacion heredada 1.x.x y la marca como deprecada/removida en 2.0.0.

Implicacion:

- Este es un riesgo directo de compatibilidad con la superficie actual del modulo declarado por el proyecto.
- Aunque pueda seguir existiendo alguna compatibilidad residual en runtime, no debe considerarse una base estable para evolucionar el proyecto.

Cambio necesario:

- Inventariar todos los usos de `worldInitialize`.
- Migrar bootstrap, registro y persistencia a superficies actuales soportadas.
- Donde no exista un reemplazo exacto, mover la inicializacion a rutas deterministicas de startup del pack y agregar validaciones de disponibilidad.

Prevencion futura:

- Definir una politica interna: no introducir nuevas dependencias a APIs marcadas como prior/legacy/deprecated en Microsoft Learn.

### 4.2 Altos

#### A1. Ventana de sync de health demasiado amplia para el nuevo modelo de knockback con dano vanilla no letal

Archivos:

- Atomic BP/scripts/features/skills/combat/health/defaults.js
- Atomic BP/scripts/features/skills/combat/health/syncPlayers.js
- Atomic BP/scripts/features/skills/combat/damageCancel/index.js

Estado actual:

- Player loop cada 10 ticks.
- Mob loop cada 20 ticks.
- `damageCancel` deja pasar dano vanilla no letal para conservar knockback.

Implicacion:

- El HP vanilla puede permanecer desacoplado de `Vida` durante demasiado tiempo.
- Esto puede producir percepcion de dano erronea, muerte aparente, jitter visual o decisiones letales basadas en HP vanilla transitorio.

Cambio necesario:

- Reducir el loop de jugador a 1-2 ticks si se mantiene el modelo actual.
- Revisar si el sync de mobs debe bajar de 20 ticks a 5-10 ticks.
- Alternativamente, reemplazar el modelo por uno donde el knockback se conserve sin depender tanto del HP vanilla visible.

Prevencion futura:

- Establecer budget de latencia maxima aceptable para cada subsistema de combate.

#### A2. Criterio letal acoplado a HP vanilla transitorio

Archivo:

- Atomic BP/scripts/features/skills/combat/damageCancel/index.js

Estado actual:

- La cancelacion letal se decide con `currentValue` y `ev.damage`.

Implicacion:

- En golpes muy cercanos o varios eventos dentro de una misma ventana de sync, la decision puede no coincidir con la salud logica real del sistema custom.

Cambio necesario:

- Integrar el estado de `Vida` y `VidaMaxTotalH` en la decision letal cuando sea posible.
- Si se mantiene HP vanilla como criterio parcial, documentar claramente la ventana de inconsistencia y testear golpes apilados.

#### A3. Contrato de scoreboards fragmentado entre modulos

Zonas afectadas:

- skills/core/scoreboards.js
- holograms/internal/scoreboard.js
- systems/titlesPriority/index.js
- combat/damage_dealt/scoreboard.js
- combat/health/scoreboards.js

Estado actual:

- Existen helpers de scoreboard distintos por subsistema, con contratos y orden de parametros diferentes.

Implicacion:

- Dificulta escalar features, complica mantenimiento y aumenta el riesgo de errores al reutilizar helpers entre sistemas.

Cambio necesario:

- Crear una capa compartida de acceso a scoreboards con contratos tipados y consistentes.
- Mantener wrappers locales solo cuando exista una razon fuerte de negocio.

#### A4. Duplicidad/ambiguedad de contenido en features

Evidencia:

- Existe `features/achievements` como modulo activo.
- Existe `features/archivements` como arbol documental/historico paralelo.

Implicacion:

- El arbol duplicado con nombre inconsistente aumenta costo cognitivo y riesgo de documentacion obsoleta.

Cambio necesario:

- Marcar formalmente `archivements` como legado o moverlo fuera de `features`.
- Corregir referencias documentales a esa ruta si ya no representa codigo vivo.

### 4.3 Medios

#### M1. Caches permanentes sin estrategia de invalidez

Zonas afectadas:

- systems/titlesPriority
- skills/core/scoreboards
- holograms/internal/scoreboard
- combat/health/scoreboards
- combat/damage_dealt/scoreboard

Implicacion:

- Si un objective se elimina, recrea o cambia de estado durante runtime, el cache puede quedarse con referencias viejas.

Cambio necesario:

- Incorporar invalidacion por fallo o reintento periodico controlado.
- Agregar herramientas de debug/reload para limpiar caches en entornos de desarrollo.

#### M2. titlesPriority estable, pero sin politica formal de concurrencia o degradacion observada

Archivo:

- Atomic BP/scripts/systems/titlesPriority/index.js

Estado actual:

- El sistema es razonablemente correcto y no presenta una rotura critica confirmada en esta revision.

Mejora sugerida:

- Documentar throughput esperado y limites de actualizacion por tick.
- Medir el costo de `runCommandAsync` por jugador bajo carga alta.

#### M3. Holograms funcional, pero sostenido por bootstrap heredado para dynamic properties

Archivos:

- Atomic BP/scripts/features/holograms/index.js
- Atomic BP/scripts/features/holograms/internal/dynamicProperties.js

Estado actual:

- El sistema no muestra una rotura funcional critica confirmada.
- Su mayor fragilidad actual es el bootstrap de dynamic properties y la dependencia de APIs heredadas.

Cambio necesario:

- Replantear el registro/persistencia de DP con una estrategia compatible con la superficie actual.

## 5. Hallazgos descartados en segunda pasada

Para evitar ruido tecnico, se descartaron como no confirmados o ya resueltos:

- Error de `preserveHigherFortune` en foraging/farming: actualmente el adaptador de cada skill lo traduce a `preserveHigherPrimary` correctamente.
- Falta de `runtime.titles` en mining: ya esta estandarizado y presente.
- Rotura critica actual en titlesPriority por la version nueva: no confirmada.
- Rotura critica actual en holograms por la version nueva: no confirmada; el riesgo real esta en el bootstrap heredado.

## 6. Diagnostico general por feature

### 6.0 Inventario funcional actual

Segun `main.js` y la estructura actual de carpetas, el proyecto inicializa de forma activa al menos estos dominios:

- scoreboards
- chest-ui
- commands
- anticheat
- custom-emojis
- custom-items
- holograms
- lecture
- skills/core
- skills/mining
- skills/foraging
- skills/farming
- skills/combat
- skills/regeneration
- combat/calc
- combat/damageCancel
- combat/health
- combat/damage_dealt
- combat/damage_title
- combat/effects
- achievements
- death
- spawnpoints
- onJoinFirstTime
- titlesPriority
- inventory/saves

Observaciones estructurales:

- Hay un arbol `features/archivements` que no aparece como modulo activo en `main.js`.
- Existe una alta concentracion de logica sensible en el arranque lineal de `main.js`.
- La frontera entre infraestructura reutilizable y feature de negocio aun no esta completamente formalizada.

### 6.1 skills/combat

Diagnostico:

- Es la zona mas fragil del proyecto.
- Tiene demasiada logica repartida entre calculo, cancelacion de dano, sync de salud, UI de dano y rewards de XP.
- La separacion actual funciona, pero exige contratos internos mas estrictos y mejor orquestacion temporal.

Cambios recomendados:

- Introducir una arquitectura de pipeline para dano:
  - clasificacion de fuente
  - validacion de reglas
  - calculo
  - aplicacion
  - efectos secundarios
  - telemetria/debug
- Evitar que cada modulo consulte y reinterprete por su cuenta `EntityDamageSource`.

### 6.2 skills/core

Diagnostico:

- El core esta en mejor estado estructural que combat.
- El gate `H` hardcodeado sigue siendo una decision de arquitectura centralizada y fragile.

Cambios recomendados:

- Mover el gate a configuracion central.
- Documentar el contrato minimo que una skill debe exponer para registrarse en core.

### 6.3 titlesPriority

Diagnostico:

- El sistema es util y relativamente limpio.
- Tiene buen potencial de escalado como bus de actionbar para multiples features.

Cambios recomendados:

- Formalizar prioridades por dominio.
- Definir ownership de IDs, sources y tiempo de vida.
- Agregar tests de conflicto entre titulos persistentes y temporales.

### 6.4 holograms

Diagnostico:

- Buen candidato para convertirse en infraestructura transversal reutilizable.
- Actualmente depende demasiado de compatibilidad best-effort y de la salud del bootstrap de dynamic properties.

Cambios recomendados:

- Separar claramente persistencia, render y resolucion de scoreboards.
- Introducir una interfaz de proveedor de datos para no depender solo de scoreboards.

### 6.5 achievements

Diagnostico:

- El modulo activo parece ser `achievements`.
- La presencia de `archivements` como rama paralela sugiere deuda historica y riesgo documental.

Cambios recomendados:

- Depurar o mover contenido legado fuera de `features`.

### 6.6 anticheat y regeneration

Diagnostico:

- Ambos presentan indicios de dependencia a `worldInitialize` o rutas heredadas similares.
- Deben incluirse en el plan de migracion de bootstrap compatible con la linea estable actual.

## 7. Cambios arquitectonicos propuestos

### 7.1 Crear una capa de compatibilidad Bedrock

Propuesta:

- Nuevo modulo interno tipo `platform/bedrockCompat`.
- Responsabilidades:
  - deteccion de APIs disponibles
  - wrappers de events
  - wrappers de components
  - wrappers de property registration
  - helpers de damage source

Beneficio:

- El resto del proyecto deja de acoplarse directamente a diferencias de version o a superficies ambiguas.

### 7.2 Crear un bootstrap central formal

Problema actual:

- `main.js` inicializa muchos sistemas linealmente, pero varios modulos siguen esperando bootstrap por eventos heredados.

Propuesta:

- Definir fases:
  - phase 0: scoreboards y compatibilidad
  - phase 1: registries y servicios base
  - phase 2: systems globales
  - phase 3: features
  - phase 4: validaciones post-init

Beneficio:

- Menos incertidumbre de orden y mejor observabilidad.

### 7.3 Estandarizar contratos de datos

Propuesta:

- Unificar acceso a scoreboards.
- Unificar lectura de health/absorption.
- Unificar templates y render payloads.

Beneficio:

- Menor duplicacion y mejor testabilidad.

## 8. Escalabilidad del proyecto

Riesgos de crecimiento observados:

- Multiples sistemas escribiendo/leyendo los mismos objectives sin contrato comun.
- Caches locales sin invalidez.
- Eventos globales con logica de negocio embebida.
- Dependencia de `runCommandAsync` en sistemas de UI bajo carga.
- Documentacion y carpetas historicas mezcladas con codigo vivo.

Practicas recomendadas:

- Definir convenciones formales de ownership por objective.
- Agregar pruebas de smoke por feature antes de release.
- Introducir una capa de diagnostico central con feature flags y logging por subsistema.
- Mantener un changelog tecnico por migracion de version Bedrock.
- Definir policy de deprecacion interna: cuando Microsoft marque una API como vieja o prior, abrir issue de migracion en el sprint siguiente.

## 9. Plan de accion recomendado

### Fase 1 - Correccion inmediata

- Alinear versions entre BP y RP.
- Reemplazar ranged mob hook por `projectileHitEntity`.
- Reducir ventana de sync de health o redefinir el criterio letal.

### Fase 2 - Compatibilidad de plataforma

- Auditar y migrar todos los usos de `worldInitialize`.
- Introducir modulo `bedrockCompat`.
- Centralizar clasificacion de `EntityDamageSource`.

### Fase 3 - Robustez y mantenimiento

- Unificar acceso a scoreboards.
- Agregar invalidacion de cache.
- Limpiar `archivements` o moverlo a un area legado/docs.

### Fase 4 - Escalado

- Definir pipeline formal para combate.
- Definir contratos publicos por subsistema.
- Agregar pruebas funcionales de integracion por feature.

## 10. Checklist de validacion antes de aplicar cambios

- Confirmar version target real de BP y RP.
- Confirmar todas las fuentes de dano que el proyecto quiere customizar.
- Confirmar si proyectiles especiales deben entrar o no al sistema custom.
- Confirmar presupuesto de latencia aceptable para sync de vida.
- Confirmar estrategia oficial del proyecto para APIs heredadas.

## 11. Conclusion

El proyecto esta en una situacion recuperable y no muestra evidencia de una ruptura total por el salto de version. La base principal del Script API usada por el proyecto sigue existiendo en la linea estable actual. Sin embargo, la base de robustez si necesita mejoras concretas.

La segunda pasada confirma que los problemas mas importantes no son genericos ni abstractos:

- hay un desacople real de manifest/dependencias,
- hay una implementacion ranged mejorable y frágil ante cambios del enum de causas,
- hay una dependencia residual a APIs heredadas que debe eliminarse,
- y hay deuda estructural en bootstrap, scoreboards y caches.

Si se corrigen esos puntos primero, el resto del proyecto puede escalar con bastante mejor seguridad.

---

## 12. Registro de correcciones aplicadas (2026-03-25)

### Estado de resolucion por hallazgo

| ID | Severidad | Hallazgo | Estado | Archivo(s) afectados |
|----|-----------|----------|--------|---------------------|
| C1 | Critico | Dependencia BP/RP desalineada | **RESUELTO** | `RP/manifest.json` |
| C2 | Critico | Hook ranged demasiado amplio | **RESUELTO** | `combat/damage_dealt/by_mob/index.js` |
| C3 | Critico | worldInitialize deprecado (3 archivos) | **RESUELTO** | `holograms/internal/dynamicProperties.js`, `anticheat/core/featureFlags.js`, `regeneration/persistence.js` |
| A1 | Alto | Ventana de sync de health muy amplia | **RESUELTO** | `combat/health/defaults.js` |
| A2 | Alto | Criterio letal acoplado a HP vanilla | **RESUELTO** | `combat/damageCancel/score.js`, `combat/damageCancel/index.js` |
| A3 | Alto | Contrato scoreboards fragmentado | PENDIENTE | Requiere refactoring transversal |
| A4 | Alto | Duplicidad archivements/achievements | **RESUELTO** | `archivements/LEGACY.md` creado |
| M1 | Medio | Caches sin invalidez | PENDIENTE | Mejora incremental futura |
| M2 | Medio | titlesPriority sin politica formal | PENDIENTE | Documentacion futura |
| M3 | Medio | Holograms bootstrap heredado | **RESUELTO** (via C3) | `holograms/internal/dynamicProperties.js` |

### Detalle de cada correccion

#### C1 — Manifest alineado

- `RP/manifest.json`: dependencia de BP cambiada de `[1, 0, 0]` a `[1, 0, 1]`.
- BP header.version es `[1, 0, 1]`, ahora coincide.

#### C2 — Hook ranged migrado a projectileHitEntity

- `by_mob/index.js`: se reemplazo `world.afterEvents.entityHurt` (hook generico con filtro fragil) por `world.afterEvents.projectileHitEntity`.
- Se usa `ev.source` como atacante y `ev.getEntityHit().entity` como target.
- El cooldown por TARGET sigue deduplicando melee vs ranged en el mismo tick.

#### C3 — worldInitialize eliminado (3 archivos)

Los tres archivos que usaban `worldInitialize` + `DynamicPropertiesDefinition` + `PropertyRegistry` fueron migrados:

- `holograms/internal/dynamicProperties.js`: convertido a no-op con documentacion. `registerHologramEntityDynamicProperties()` mantiene su firma para compatibilidad de llamadas.
- `anticheat/core/featureFlags.js`: `initFeatureFlagsDynamicProperties()` convertido a no-op. Import `* as mc` eliminado (ya no se usa).
- `regeneration/persistence.js`: `initMiningRegenDynamicProperties()` convertido a no-op. Import `* as mc` eliminado.

Justificacion: en `@minecraft/server` 2.x, Dynamic Properties son schemaless. `world.setDynamicProperty()` y `entity.setDynamicProperty()` funcionan directamente sin registro previo.

#### A1 — Ventana de sync reducida

- `defaults.js`: `DEFAULT_PLAYER_LOOP_TICKS` cambiado de 10 a **2** (100ms de latencia maxima).
- `defaults.js`: `DEFAULT_MOB_LOOP_TICKS` cambiado de 20 a **10** (500ms de latencia maxima).
- `DEFAULT_MOB_SCAN_TICKS` se mantiene en 40 (scan lento, no afecta sync activo).

#### A2 — Vida integrada en decision letal

- `damageCancel/score.js`: nueva funcion `getVidaScoreBestEffort(player)` que lee el objective `Vida` por API de scoreboard. Cache unificado con patron `{ obj: null }`.
- `damageCancel/index.js`: antes de la decision letal vanilla, se consulta `Vida`:
  - Si `Vida <= 0`, no se cancela el dano (muerte natural).
  - Si `Vida > 0` o `Vida` no disponible, se mantiene la logica de cancelacion letal por HP vanilla.
- Variables no usadas (`cachedObjectiveH`, `cachedObjectiveVida` legacy) eliminadas.

#### A4 — archivements marcado como legacy

- Creado `archivements/LEGACY.md` indicando que es contenido documental inactivo.
- El modulo activo sigue siendo `achievements/`.

### Validacion aplicada

- Los 7 archivos JS modificados pasaron `node --check` sin errores de sintaxis.
- Los 8 archivos (7 JS + 1 JSON) pasaron verificacion de errores de VS Code sin diagnosticos.
- No se introdujeron imports muertos ni variables no usadas.

### Pendientes para fases futuras

Los hallazgos A3, M1 y M2 quedan pendientes como mejoras de robustez para futuras iteraciones:

- **A3**: Unificar contratos de scoreboards requiere un refactoring transversal planificado.
- **M1**: Invalidacion de cache puede implementarse incrementalmente por subsistema.
- **M2**: Documentacion de throughput de titlesPriority es trabajo de profiling, no de correccion.
