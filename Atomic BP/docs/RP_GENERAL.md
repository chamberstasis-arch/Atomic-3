# Atomic RP — Documentación general

## Propósito
Resource Pack (RP) para Minecraft Bedrock (1.21.132) enfocado en render, UI y assets que soportan los sistemas del BP.

## Compatibilidad y versiones
- **min_engine_version**: 1.21.0 en el manifest del RP.
- **Dependencia BP**: el RP depende del Behavior Pack (UUID en manifest).

## Estructura principal

### Manifiesto
- Archivo: [RP/manifest.json](RP/manifest.json)
- Módulo `resources` y dependencia hacia el BP.

### Carpetas clave
- **entity**: client entities para renderizado de entidades.
- **models**: geometrías para entidades.
- **render_controllers**: control de renderización.
- **textures**: texturas y atlas.
- **ui**: UI personalizada.
- **attachables**: accesorios vinculados a entidades/items.
- **font**: fuentes o iconos en texto.

## Hologramas (render)
- Documentación: [RP/docs/hologram.md](RP/docs/hologram.md)
- La entidad `atomic:hologram` se renderiza como invisible:
  - Geometría vacía.
  - Textura base segura para evitar warnings.
  - Render controller mínimo.

## Buenas prácticas
- Mantener geometrías y texturas livianas para entidades invisibles.
- Validar rutas y nombres en client entity y render controllers.
- Evitar assets innecesarios en packs de servidor/realm.

## Riesgos y mitigaciones
- **Versiones dispares BP/RP**: alinear `min_engine_version` recomendado.
- **Referencias cruzadas**: validar UUIDs y versiones en ambos manifests.

## Referencias oficiales (Microsoft)
- Resource packs: https://learn.microsoft.com/en-us/minecraft/creator/documents/resourcepack
- Manifests: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/manifestreference
- Client entity: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/cliententity
- Render controllers: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/rendercontrollervalue
