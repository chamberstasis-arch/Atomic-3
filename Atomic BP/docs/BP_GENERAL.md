# Atomic BP — Documentación general

## Propósito
Behavior Pack (BP) para Minecraft Bedrock (1.21.132) enfocado en ambientación, utilidades y sistemas de servidor/realm. Incluye scripts, funciones y entidades que extienden la jugabilidad.

## Compatibilidad y versiones
- **min_engine_version**: 1.21.93 en el manifest del BP.
- **Script API**: `@minecraft/server` 2.4.0 y `@minecraft/server-ui` 2.0.0.
- **Dependencia RP**: el BP depende del Resource Pack (UUID en manifest).

## Estructura principal

### Manifiesto
- Archivo: [Atomic BP/manifest.json](Atomic%20BP/manifest.json)
- Define módulos `data` y `script` y dependencias de la Script API.

### Scripts
- Entry point: [Atomic BP/scripts/main.js](Atomic%20BP/scripts/main.js)
- Inicializa features de forma centralizada.

#### Features (scripts/features)
- **anticheat**: sistema modular con scoreboards, reglas y flags.
- **chest-ui**: UI personalizada para inventarios/cofres.
- **custom-emojis**: emojis personalizados (README incluido en la carpeta).
- **custom-items**: items personalizados + configuración + fixes de durabilidad.
- **holograms**: hologramas con plantilla, interpolación y cache.
- **inventory**: guardado/restore de inventario.
- **skills**: regeneración, combate, cálculo de daño, etc.

### Funciones (mcfunction)
- Archivo de tick: [Atomic BP/functions/tick.json](Atomic%20BP/functions/tick.json)
- Ejecuta tareas por tick en carpetas como `General3` y `Seguridad1`.
- Ejemplo de tiempo jugado: [Atomic BP/functions/General3/Tiempo.mcfunction](Atomic%20BP/functions/General3/Tiempo.mcfunction)

### Entidades
- Entidad `atomic:hologram`: [Atomic BP/entities/hologram.json](Atomic%20BP/entities/hologram.json)
- Diseñada para portar `nameTag` y ser liviana/invisible (en RP se controla el render).

### Items
- Catálogo de items personalizados en [Atomic BP/items/](Atomic%20BP/items/).

## Feature destacada: Hologramas
- Documentación general: [Atomic BP/docs/hologram.md](Atomic%20BP/docs/hologram.md)
- Especificación de interpolación con scoreboards: [Atomic BP/docs/holograms/hologram-scoreboard-interpolation.md](Atomic%20BP/docs/holograms/hologram-scoreboard-interpolation.md)

## Feature planificada: Archivements
- Documento base: [Atomic BP/scripts/features/archivements/arch-list/LOGROS.md](Atomic%20BP/scripts/features/archivements/arch-list/LOGROS.md)
- Requisitos clave:
  - Logros “only-one-time”.
  - Mensajería con wrapping de 25 caracteres por línea.
  - Recompensa de corazones cada 10 logros con límite 5.
  - Condiciones basadas en scoreboards y eventos.

## Dependencias de scoreboards
El BP asume múltiples objetivos de scoreboard. Se recomienda:
- Inicializar objetivos al cargar el mundo (post-worldLoad).
- Validar existencia antes de leer/actualizar.
- Evitar loops pesados por tick si no es necesario.

## Buenas prácticas operativas
- Evitar trabajo por tick con `@a` cuando sea posible; preferir intervalos.
- Cachear resultados y actualizar solo cuando cambien.
- Mantener límites de entidades activas (p. ej., hologramas por dimensión).

## Riesgos y mitigaciones
- **Versiones dispares BP/RP**: alinear `min_engine_version` recomendado.
- **Scoreboards faltantes**: validar y crear al inicio.
- **Rendimiento**: reducir frecuencia de polling y agrupar tareas.

## Referencias oficiales (Microsoft)
- Creator Portal: https://learn.microsoft.com/en-us/minecraft/creator/
- Manifests: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/manifestreference
- Behavior packs: https://learn.microsoft.com/en-us/minecraft/creator/documents/behaviorpack
- Script API (`@minecraft/server`): https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/
- Dynamic properties: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entity#dynamic-properties
- Commands (scoreboard/tellraw): https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/commands/scoreboard
