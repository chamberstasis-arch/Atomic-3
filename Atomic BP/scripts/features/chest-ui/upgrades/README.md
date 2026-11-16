# Chest UI: Upgrades (Menú de Mejoras)

Feature: `Atomic BP/scripts/features/chest-ui/upgrades`

Este documento define la especificación funcional y de datos del sistema de “Mejoras” basado en `ChestFormData` (la Chest UI). Está pensado como guía para implementar menús/submenús reutilizables, configurables y escalables, sin modificar el core de la UI.

## 1) Alcance

### Objetivo

- Implementar una UI tipo cofre (Chest UI) para gestionar mejoras de armas/herramientas.
- Mostrar un slot espejo del ítem en la mano principal (mainhand) y permitir submenús que interactúen con ese ítem (p. ej. modificar lore) y refresquen el menú.
- Mantener el sistema dinámico: textos, posiciones, catálogos y lógica deben poder alterarse con configuración; evitar hardcodeo.

### No objetivos (por ahora)

- No cambiar el core de la Chest UI (`chestui/forms.js`, `chestui/typeIds.js`).
- No “calcular rareza” como propiedad del item: la rareza se toma del lore (display).
- No eliminar el uso de códigos `§` (estándar del proyecto).
- No implementar parsing avanzado de “encantamientos estéticos” para lógica (solo lectura/display a futuro).

## 2) Dependencias y referencias

### Chest UI core

- `Atomic BP/scripts/features/chest-ui/chestui/forms.js`
- `Atomic BP/scripts/features/chest-ui/chestui/typeIds.js`

### Referencia para lectura/parsing de lore

Para lectura tolerante del lore, seguir el estilo de:

- `Atomic BP/scripts/features/skills/lecture/equipmentReader.js`
- `Atomic BP/scripts/features/skills/lecture/loreParser.js`

Pautas consideradas estándar en el repo:

- Separar lectura segura (best-effort) de parsing.
- Ignorar colores y formato: stripping de `§x` antes de buscar etiquetas.
- Devolver `0`/`null` en fallos sin romper el flujo.

## 3) Arquitectura recomendada dentro de `upgrades/`

Responsabilidades esperadas:

1. Menú principal (`upgradesPrimaryMenu`)
    - Monta layout base.
    - Inserta el slot espejo.
    - Renderiza acciones en el grid según flags del lore.
2. Catálogo de acciones (data-driven)
    - Define acciones disponibles (id, nombre, lore, icono, handler/submenu).
3. Reader/Parser de item
    - Lee item mainhand, lore, glint, durabilidad.
    - Extrae flags de capacidades desde el lore (código oculto).
4. Submenús
    - Acciones concretas (modificar lore, confirmar, aplicar).
    - Al terminar, regresan y fuerzan refresh del menú principal.

Nota: se trabajará solo dentro de `chest-ui/` salvo tomar referencia de lectura/parsing en `skills/lecture`.

## 4) Items custom (clones) y visualización en la Chest UI

Existe un set grande de items custom en `Atomic BP/items/` que son clones (misma apariencia que vanilla) con variantes:

- `*_plain` (sin glint)
- `*_glint` (con glint)

Estos items usan texturas vanilla, pero su `typeId` es custom y puede no existir en `typeIds.js`.

### Estrategias posibles

Estrategia A (recomendada inicialmente): interpretar por equivalente vanilla

- Si el jugador sostiene `diamond_hoe_glint`:
  - La UI muestra `minecraft:diamond_hoe` con `enchanted=true`.
  - El item real sigue siendo el custom en la mano (no se reemplaza).
- Ventajas:
  - No requiere tocar `forms.js` ni ampliar catálogos.
  - Se apoya en `typeIds.js` existente.
  - Escala bien (solo requiere un mapeo por nombre).

Estrategia B: agregar items custom al catálogo de la UI

- Implica extender `forms.js` (`custom_content`) y lógica para glint/aux.
- No se recomienda para primera versión por riesgo: el core es frágil y reutilizado.

Decisión de diseño para esta feature: usar Estrategia A por defecto.

## 5) Slot espejo (mainhand mirror)

En el menú principal de mejoras existe un botón-slot (por ejemplo slot 20) que refleja dinámicamente el ítem del jugador en mainhand.

Debe reflejar:

- Nombre: `nameTag` si existe; si no, fallback derivado del `typeId` (solo display).
- Lore: `item.getLore()` como array de líneas.
- Textura:
  - Vanilla: `minecraft:...`
  - Custom clones: mapear a “equivalente vanilla” + glint por variante.
- Durabilidad: normalizar a `0..99` (estilo `forms.js`).
- Glint: boolean (según componente encantable o por variante `_glint` en clones).

Regla de refresco

Tras cualquier submenú que modifique el lore, el menú principal debe:

1. Releer el item actual en mainhand.
2. Reconstruir el slot espejo.
3. Recalcular qué acciones están disponibles (flags de lore).
4. Volver a mostrar la UI.

## 6) Grid de acciones (3x3) y render dinámico

El layout reserva un área 3x3 para acciones, con estos slots (orden row-major):

```text
14, 15, 16,
23, 24, 25,
32, 33, 34
```

El objetivo es renderizar hasta 9 acciones (hoy hay 4), de forma determinista.

El catálogo de acciones es la fuente de verdad de:

- `actionId` interno estable
- nombre/lore
- icono/texture
- handler (abrir submenú o ejecutar lógica)

## 7) Flags de capacidades en el lore (código oculto de 5 dígitos)

### Idea

Al final del lore de items con estadísticas existe una última línea que incluye:

1. Un texto de rareza (display)
2. Inmediatamente después, un código oculto para el jugador: cinco secuencias `§<dígito>`

Ejemplo:

```text
§d§lMíTICO§0§0§0§0§0
```

Formatos válidos (espacio opcional entre rareza y código):

```text
RAREZA §0§0§0§0§0
RAREZA§0§0§0§0§0
```

Interpretación:

- Se toman solo los 5 dígitos (removiendo los `§`).
- Ejemplo: `§0§1§0§1§0` → `01010`.

### Reglas

- Si el item no tiene lore, o no tiene este código al final, se asume que no hay acciones disponibles.
- Si el código existe pero es `00000`, no se muestra ninguna acción.
- Para cada dígito:
  - `0` = deshabilitado
  - `1..9` = habilitado, pero **el valor numérico importa** (define variante/capacidad)

### Contrato de extracción del código (robusto)

Para evitar fallos por espacios o rarezas con texto variable, el código debe extraerse de la **última línea** del lore con estas reglas:

1. Tomar la última línea y aplicar `trimEnd()` (ignorar espacios al final).
2. Leer **desde el final hacia la izquierda** buscando exactamente 5 secuencias `§<dígito>`.
  - Entre secuencias puede existir `\s` (espacios) y debe ignorarse.
  - Las secuencias del código siempre son dígitos `0..9`.
3. Si se encuentran 5 secuencias, ese es el código (en orden natural).
4. Si **no** se encuentran 5 secuencias (por ejemplo, la línea tiene solo la rareza), el código se interpreta como `00000`.

Implicación:

- Un item que tenga solo la rareza (sin código) se comporta igual que `00000` y no mostrará ningún menú/acción.

### Mapeo actual (1..4 usados)

Orden base (jerarquía):

1. Encantamientos de herramienta
2. Modificadores de herramienta
3. Información de herramienta
4. Atributos de herramienta
5. Reservado (no usado)

### Semántica de los dígitos (0, 1, 2..9)

En esta feature, cada dígito representa **dos cosas**:

1. **Visibilidad** del botón (si se muestra o no)
2. **Variante de comportamiento** del botón (qué soporta, qué lore muestra y qué submenú abre)

Contrato:

- `0` → no se muestra el botón (acción deshabilitada)
- `1` → se muestra el botón en su **variante estándar** (soporta “todo lo normal”)
- `2..9` → se muestra el botón, pero en una **variante específica por acción**

> Importante: el significado exacto de `2..9` depende de la acción (posición). Por ejemplo, el dígito 2 en “Modificadores” no tiene por qué significar lo mismo que el dígito 2 en “Atributos”.

### Ejemplo: Modificadores de herramienta (dígito #2)

El botón de “Modificadores de herramienta” existe si el segundo dígito es `>= 1`. Pero:

- `§1§1§1§1§0` (11110): muestra Modificadores en variante estándar (soporta todas las categorías)
- `§1§2§1§1§0` (12110): muestra Modificadores en variante alternativa (no soporta una categoría)

#### Variantes (6 casos) para el dígito #2

Los “Modificadores” tienen 3 categorías posibles:

- Sellos effrenatus
- Runas tier III
- Meliorems maestros

En términos combinatorios existen $2^3-1 = 7$ subconjuntos no-vacíos. Para este sistema se definen **7 variantes** (dígitos `1..7`) para cubrir todos los subconjuntos de categorías.

Mapeo propuesto (dígito #2 → categorías soportadas y mostradas):

- `1`: Sellos + Runas + Meliorems (todas)
- `2`: Runas + Meliorems (sin Sellos)
- `3`: Sellos + Meliorems (sin Runas)
- `4`: Sellos + Runas (sin Meliorems)
- `5`: solo Runas
- `6`: solo Meliorems
- `7`: solo Sellos

Reglas de render:

- La descripción base puede mencionar categorías que no se soportan; lo que decide si aparece el contador y si el submenú permite aplicarla es la **variante**.
- Si la categoría no es soportada por la variante, su línea se **omite** completamente.

Caso estándar (soporta 3 categorías; los contadores son dinámicos):

```js
"§r§aModificadores de herramienta",
[
  "§r§7Aplica modificadores especiales tales como",
  "§r§7los §6Sellos effrenatus§7, las §5Runas tier III",
  "§r§7y §cMeliorems maestros§7 necesitan un",
  "§r§7poco de §6ayuda§r§7 extra.",
  "",
  "§r§6 Sellos effrenatus §e0§7/§a10",
  "§r§5 Runas tier III §e0§7/§a1",
  "§r§c Meliorems maestros §e0§7/§a3",
  "",
  "§r§eClic para detalles",
]
```

Caso alternativo (no soporta “Sellos effrenatus”; se omite la línea del contador):

```js
"§r§aModificadores de herramienta",
[
  "§r§7Aplica modificadores especiales tales como",
  "§r§7los §6Sellos effrenatus§7, las §5Runas tier III",
  "§r§7y §cMeliorems maestros§7 necesitan un",
  "§r§7poco de §6ayuda§r§7 extra.",
  "",
  "§r§5 Runas tier III §e0§7/§a1",
  "§r§c Meliorems maestros §e0§7/§a3",
  "",
  "§r§eClic para detalles",
]
```

Notas:

- En ambos casos, la descripción base puede seguir mencionando la categoría omitida; lo que cambia es si el item **la soporta** y por tanto si se imprime su contador y si el submenú permite aplicarla.
- Los valores tipo `0/10`, `0/1`, `0/3`:
  - el **`0`** es dinámico (depende de la lectura del item: qué ya está aplicado)
  - el **máximo** (`10`, `1`, `3`) es parte del diseño de esa variante (normalmente fijo por categoría/variante, aunque podría volverse data-driven)

#### Lectura de modificadores desde el lore del item (sumatorios)

Estos modificadores funcionan agregando valores a canales de sumatorio del item (ver modelo de sumatorios en la sección 8). En particular, para armas/herramientas:

- **Sellos effrenatus**: cada sello agrega `+4` a `DañoSumatorio2` (canal `S2` del Daño)
- **Meliorems maestros**: cada meliorem agrega `+20` a `DañoSumatorio1` (canal `S1` del Daño)
- **Runas tier III**: por ahora **no se interpretan** (se reservará su lectura/estado para una fase posterior para evitar errores)

Ejemplo de lore de Daño:

```text
Daño: +25 §c[+10] §6[+4] §9(+1)
```

Interpretación:

- `DañoSumatorio2 = 4` → `SellosEffrenatusAplicados = 1`
- `DañoSumatorio1 = 10` → `MelioremsAplicados = 1` **solo si** el sistema define que el canal S1 en Daño representa meliorems (en este spec sí: `+20` por meliorem). En este ejemplo sería un valor “anómalo” (no múltiplo de 20), ver redondeo.

Reglas de cálculo (lectura):

- Si la variante no soporta la categoría, su contador se trata como 0 (y se omite en el lore del botón).
- Sellos effrenatus (desde `DañoSumatorio2`):

$$
Sellos = \left\lceil \frac{DañoSumatorio2}{4} \right\rceil
$$

- Meliorems maestros (desde `DañoSumatorio1`):

$$
Meliorems = \left\lceil \frac{DañoSumatorio1}{20} \right\rceil
$$

Redondeo hacia arriba (casos no múltiplos):

- Si por fuerza bruta el valor no es múltiplo del paso (ej. `DañoSumatorio2=6`), se aproxima hacia arriba:
  - `6/4 = 1.5` → `ceil` = 2 sellos
- Estos casos idealmente no deberían ocurrir si esos canales solo son manejados por este sistema.

Implicación para UI:

- Los contadores `0/10`, `0/1`, `0/3` del botón “Modificadores” deben derivarse de estas lecturas cuando aplique.
- Runas tier III: mientras no se interpreten, el contador aplicado debe mostrarse como `0` (modo desarrollo) y el submenú debe evitar decisiones basadas en lectura hasta que exista un contrato.

Regla de seguridad para contadores:

- En cualquier contador `X/Y`, **X nunca puede ser mayor que Y**. Si por lectura/errores el cálculo arrojara un valor mayor, el UI debe mostrar como máximo `Y/Y`.

### Consideración: Información de herramienta (dígito #3)

Por ahora, “Información de herramienta” se considera **display-only**:

- Si el dígito #3 es `0`: no se muestra el botón.
- Si es `1..9`: se muestra el botón.
- En principio el lore del botón no cambia aunque el dígito sea `2,3,4,5...`, pero se reserva como variante para excepciones futuras.

### Especificación: Encantamientos de herramienta (dígito #1)

Los “Encantamientos de herramienta” se implementarán como encantamientos **cosméticos** (solo en lore). Por eso el sistema debe:

- Poder listar encantamientos por categorías.
- Contar cuántos hay aplicados leyendo el lore del item.
- Variar el submenú/alcance según el valor del dígito #1.

#### Modos del dígito #1

- `0`: no se muestra el botón.
- `1`: modo “genérico / debug” (temporal). Trata el item como si soportara **todas** las categorías para fines de test.
- `2..9`: modo por categoría (8 variantes). Mapea a qué pool de encantamientos se permite y qué submenú se abre.

Mapeo recomendado (8 categorías):

- `2` → `sword`
- `3` → `bow`
- `4` → `armor`
- `5` → `hoe`
- `6` → `axe`
- `7` → `pickaxe`
- `8` → `helmet`
- `9` → `boots`

> Nota: `helmet` y `boots` también pertenecen conceptualmente a `armor` (ver herencia más abajo).

#### Pools de encantamientos por categoría

Los nombres incluyen su nivel máximo de referencia, pero el conteo debe ignorar el nivel romano.

`sword`:

- Filo VII
- Primer Golpe IV
- Critico VIII
- Aspecto Ígneo III
- Castigo V
- Perdición de los Artrópodos VIII
- Discordancia III
- Corte Veloz II
- Oxidación III
- Asesino del Fin VII
- Saqueo V
- Lux III
- Nux III
- Verosimilitud I

`bow`:

- Power X
- Flame II
- Punch III
- Salvación IV
- Sobrecarga V
- Caprificación I
- Obliteración V
- Terminación I
- Artigeno III
- Magmatismo IV
- Tormenta III

`armor`:

- Protección VI
- Rejuvenecimiento V

`helmet`:

- Afinidad aquatica I
- Respiración III

`boots`:

- Caida de pluma XII
- Lijereza II

`pickaxe`:

- Eficiencia V
- Fortuna V
- Prisa espontánea III
- Linaje II
- Convicción XII

`axe`:

- Eficiencia V
- Fortuna V
- Prisa espontánea III
- Convicción XII

`hoe`:

- Eficiencia V
- Fortuna V
- Cultivador X
- Convicción XII

#### Herencia/Composición de categorías (para ítems híbridos)

Algunos ítems pertenecen a más de una categoría. En esos casos, el máximo del contador y el pool permitido se calcula como la **unión sin repetidos**.

- `boots` también es `armor` → pool = `boots ∪ armor`
- `helmet` también es `armor` → pool = `helmet ∪ armor`

Ejemplo: botas en mainhand

- pool(boots) = 2
- pool(armor) = 2
- total máximo mostrado = 4

#### Conteo “X/Y” mostrado en el lore del botón

El botón “Encantamientos de herramienta” debe mostrar:

```text
Encantamientos: <aplicados>/<máximo>
```

- `<máximo>` = cantidad de encantamientos únicos del pool aplicable (según categoría/union).
- `<aplicados>` = cantidad de encantamientos únicos detectados en el lore real del item.

Reglas para el conteo:

- Se cuenta por **nombre base** del encantamiento, ignorando nivel (romanos). Ejemplos:
  - `Eficiencia IV` cuenta como 1
  - `Eficiencia V` cuenta como 1
- Si el item tiene dos veces el mismo encantamiento (por errores de lore), debe contarse como 1 (dedupe).
- Si el item no pertenece a ninguna categoría:
  - Temporal (testing): modo dígito `1` puede mostrar el total global para probar todo.
  - Futuro (producción): el item debe considerarse “inválido” y no soportar encantamientos (dígito `0`).

> Nota: el número que aparece hoy en la UI (por ejemplo `0/17`) debe tratarse como placeholder; el valor real debe derivarse del catálogo/config.

### Orden y colocación en el grid

Para evitar patrones aleatorios, la colocación debe ser determinista:

- Se recorre el mapeo en orden (1 → 2 → 3 → 4 → 5).
- Por cada acción habilitada, se asigna el siguiente slot disponible del grid en el orden:

```text
14 → 15 → 16 → 23 → 24 → 25 → 32 → 33 → 34
```

Ejemplo: `01010` (habilita 2 y 4)

```text
+-------+-------+-------+
|   2   |   4   |       |
+-------+-------+-------+
|       |       |       |
+-------+-------+-------+
|       |       |       |
+-------+-------+-------+
```

## 8) Formato del lore (especificación para lectura)

Importante (Script API)

En Bedrock, `item.getLore()` retorna un array de strings, donde cada elemento representa una línea.

- En documentación puede representarse con `\n`, pero la API real suele entregar líneas separadas.
- Las líneas vacías típicamente aparecen como `""` (string vacío) en el array.

Estructura conceptual (4 secciones)

1. Estadísticas del objeto (varias líneas, por etiquetas)
2. Encantamientos estéticos (opcional)
3. Descripción/flavor (opcional)
4. Rareza + flags (obligatorio solo para items “upgradeables”)

La UI de upgrades debe ser tolerante: muchas partes pueden faltar, pero si faltan los flags, no se muestran acciones.

Estadísticas soportadas (para lectura, no necesariamente para UI)

- Poder
- Vida
- Defensa
- Daño
- Daño Crítico
- Probabilidad Crítica
- Daño Verdadero
- Mana
- Fortuna Minera
- Experiencia Minera
- Fortuna de Tala
- Frenesí de Tala
- Experiencia de Talado
- Fortuna de Cosecha
- Mutación Activa
- Experiencia de Cosecha

Reglas:

- Los colores (`§x`) no se usan para parsing.
- Los íconos/símbolos pueden cambiar o faltar.
- La etiqueta (ej. `Daño:`) es la clave estable.

### Modelo de sumatorios (canales) para upgrades (todas las estadísticas)

Varias estadísticas del lore usan un modelo de **Total = Base + Sumatorios**, donde los “sumatorios” representan aportes por origen (encantamientos, runas, atributos, mejoras, etc.).

Esto es clave para la UI de mejoras porque:

- Permite **aumentar el Total** sin cambiar el Base.
- Permite **bloquear** ciertas aplicaciones si ya existe un aporte en un canal (por ejemplo: si ya hay un `Sumatorio2`, entonces “runa tier 3” ya está aplicada).

Contrato conceptual:

$$
Total = Base + (S1 + S2 + S3)
$$

Donde:

- `S1` = canal 1 (ejemplo: “Meliorem Maestro”)
- `S2` = canal 2 (ejemplo: “Runa Tier 3”)
- `S3` = canal 3 (ejemplo: “Encantamiento”)

> Nota: los nombres anteriores son ejemplos. La implementación debe ser data-driven (catálogo) para que cada componente decida qué canal incrementa.

#### Caso específico: Línea de Daño

Estructura lógica:

```text
Daño: +<TotalDañoPlano> ... [ +<DañoSumatorio1> ] [ +<DañoSumatorio2> ] ( +<DañoSumatorio3> )
```

- `TotalDañoPlano` (int): daño total mostrado en el lore (ej. `21`).
- `DañoSumatorio1` (opcional): va entre `[]`.
- `DañoSumatorio2` (opcional): va entre `[]`.
- `DañoSumatorio3` (opcional): va entre `()`.
- Si un sumatorio es `0` o “no aplica”, **no se muestra** (la sección completa se omite).

Base:

$$
DañoBase = TotalDañoPlano - (DañoSumatorio1 + DañoSumatorio2 + DañoSumatorio3)
$$

Interpretación para mejoras:

- Una mejora (encantamiento/atributo/runa/etc.) **no debería tocar `DañoBase`** si su objetivo es “daño adicional”; debe sumar al canal correcto (`DañoSumatorio1/2/3`).
- Al sumar al canal, el `TotalDañoPlano` sube, pero el `DañoBase` se mantiene.

Ejemplos de display (simplificados, sin colores):

- Solo base: `Daño: +10`
- Base + S3: `Daño: +10 (+5)`
- Base + S1 + S2 + S3: `Daño: +999 [+99] [+99] (+99)`

#### Colores por canal (convención visual)

En el lore “completo” (mejor caso), suele verse algo como:

```text
§7Daño: §c+999🗡 §c[+99] §6[+99] §9(+99)
```

Convención recomendada (para escritura del lore):

- `DañoSumatorio1` se renderiza como `§c[+N]`
- `DañoSumatorio2` se renderiza como `§6[+N]`
- `DañoSumatorio3` se renderiza como `§9(+N)`

Si un canal no existe (o es 0), se omite completamente. Ejemplo (faltando S1):

```text
§7Daño: §c+900🗡 §6[+99] §9(+99)
```

Nota importante:

- Para **parsing**, no dependas de los colores.
- Para **escritura**, sí conviene preservar la convención de colores por canal (porque hace legible el origen del bonus y simplifica el debugging visual).

#### Implicación para lógica futura de UI

La UI puede usar la lectura de canales para:

- Mostrar en el lore de un botón “YA APLICADO” si detecta, por ejemplo, `DañoSumatorio2 > 0` (runa tier 3 ya presente).
- Bloquear o reemplazar upgrades por canal (política a definir: “no apilar”, “reemplazar”, “permitir apilar”, etc.).
- Separar mecánicas que afectan `Base` vs mecánicas que afectan `Total`.

> Este mismo modelo aplica a cualquier estadística que tenga sumatorios en `[]` y/o `()`.

#### Convención de colores por estadística y canal (para escritura)

Para mantener consistencia visual, cada estadística puede tener colores distintos para:

- el **Total** (el `+N` principal)
- el canal `S1` (primer `[...]`)
- el canal `S2` (segundo `[...]`)
- el canal `S3` (el `(...)`)

Reglas:

- Esta tabla es una **convención de render** (escritura del lore).
- Para **parsing**, no se debe depender de los colores (ver sección de parsing).
- Si un canal no existe o vale `0`, **se omite completo** (no se imprime ni el bracket/paréntesis).

Tabla basada en el ejemplo extenso de lore que se usa en el proyecto:

| Etiqueta | Total | S1 (`[...]`) | S2 (`[...]`) | S3 (`(...)`) | Notas |
|---|---:|---:|---:|---:|---|
| Poder | `§c` | — | — | — | Normalmente solo Total |
| Vida | `§c` | `§e` | `§6` | `§9` | `(...)` suele ser el tercer canal |
| Defensa | `§7` | `§e` | `§6` | `§9` | Total en gris en el ejemplo |
| Daño | `§c` | `§c` | `§6` | `§9` | S1 comparte color con Total |
| Daño Crítico | `§9` | — | — | `§9` | Solo canal `(...)` en el ejemplo |
| Probabilidad Crítica | `§9` | — | — | `§9` | Solo canal `(...)` en el ejemplo |
| Daño Verdadero | `§f` | `§i` | — | — | Solo primer `[...]` en el ejemplo |
| Mana | `§d` | — | — | `§u` | Solo `(...)` con color distinto |
| Fortuna Minera | `§6` | `§e` | `§g` | `§p` | Tiene 3 canales |
| Experiencia Minera | `§3` | `§s` | — | — | Solo primer `[...]` |
| Fortuna de Tala | `§6` | `§e` | `§g` | `§p` | Tiene 3 canales |
| Frenesí de Tala | `§e` | `§p` | — | — | En el ejemplo es `§p[+N]` |
| Experiencia de Talado | `§3` | `§s` | — | — | Solo primer `[...]` |
| Fortuna de Cosecha | `§6` | `§e` | `§g` | `§p` | Tiene 3 canales |
| Mutación Activa | `§a` | `§2` | — | `§q` | Tiene `[...]` + `(...)` |
| Experiencia de Cosecha | `§3` | `§s` | — | — | Solo primer `[...]` |

Ejemplo de render “completo” (Daño):

```text
§7Daño: §c+999🗡 §c[+99] §6[+99] §9(+99)
```

Ejemplo de omisión de canal (faltando S1):

```text
§7Daño: §c+900🗡 §6[+99] §9(+99)
```

## 9) Reglas de parsing (tolerancia y compatibilidad)

Inspirado en `skills/lecture/loreParser.js`:

1. Strip de formato: eliminar `§.` antes de normalizar.
2. Normalización: compactar espacios múltiples, trim.
3. Búsqueda por etiqueta: `startsWith("Daño:")` (case-insensitive).
4. Lectura numérica:
    - primer número después de `:` y opcional `+`
    - permitir `,` o `.` como decimal cuando aplique
5. Sumatorias opcionales:
    - `[...]` hasta 2
    - `(...)` hasta 1
6. Fallos:
    - si no se parsea, retornar `0`/`null` sin romper ejecución

En esta feature, el parsing numérico completo no es requisito inmediato, pero sí:

- lectura segura del lore
- parsing del código de flags final

## 10) Rarezas (display)

Las rarezas pueden variar en texto/colores, pero el código de 5 dígitos es lo que habilita acciones.

### Rarezas soportadas (formato exacto)

Estas son las rarezas y su formato exacto (incluyendo colores) tal como aparecerán en el lore. Inmediatamente después de esta secuencia (con o sin un espacio) estará el código de 5 dígitos:

Rarezas “estándar”:

- `§f§lCOMÚN`
- `§q§lPOCO COMÚN`
- `§t§lRARO`
- `§u§lMUY RARO`
- `§5§lÉPICO`
- `§6§lLEGENDARIO`
- `§e§lASCENDIDO`
- `§d§lMÍTICO`

Rarezas “especiales”:

- `§j§lOLVIDADO`
- `§s§lRELIQUÍA`
- `§c§lESPECIAL`
- `§m§lANA§4TEMA`
- `§b§lDIVINO`
- `§4§lS§cI§vN §gL§eI§aM§qI§sT§9E§uS`

Nota: pueden existir espacios extra al final de la línea; se ignoran (ver contrato de extracción del código).

### Color del panel `y` según rareza (match visual)

El patrón base del menú usa un carácter `y` para un relleno “decorativo” (glass pane). Ese `y` debe cambiar su textura/desc según la rareza del item, para hacer match con el color.

Ejemplo (pseudocódigo):

```js
ui.pattern(
  [
    "xxxxxxxxx",
    "xyyyx___x",
    "xy_yx___x",
    "xy_yx___x",
    "xxxxxxxxx",
  ],
  {
    x: { itemName: { rawtext: [{ text: "§8" }] }, itemDesc: ["§8"], enchanted: false, stackAmount: 0, texture: "g/black" },
    y: { itemName: { rawtext: [{ text: "§8" }] }, itemDesc: ["§8"], enchanted: false, stackAmount: 0, texture: "g/blue" },
  }
);
```

Donde `y.texture` y `y.itemDesc` se resuelven dinámicamente desde una configuración de rarezas.

## 11) Flujo esperado de submenús (alto nivel)

Cada acción del grid debe abrir un submenú con este patrón:

1. Validar que existe item en mainhand.
2. Validar que el item aún es el mismo objetivo (firma estable: `typeId | nameTag | lore`).
3. Ejecutar la interacción (ej. modificar lore).
4. Volver al menú principal y refrescar.

Si el jugador cambió el ítem durante la navegación:

- Dar feedback.
- Refrescar el menú principal con el item actual.

## 12) Checklist para implementación (cuando toque código)

- Resolver equivalentes vanilla para items custom clones (plain/glint).
- Implementar parser de flags de 5 dígitos al final del lore.
- Renderizar acciones dinámicas en grid 3x3 según flags.
- Crear submenús stub (mínimos) que demuestren refresh y validación de item objetivo.

### Atajos de desarrollo (testing)

Para facilitar pruebas sin comandos extra:

- Abrir menú de mejoras: agachado (sneaking) + clic derecho usando cualquier ítem (excepto brújulas).

## 13) Observaciones y correcciones lógicas (del documento original)

1. Inconsistencia de orden: se mencionó “izquierda a derecha y de abajo para arriba”, pero el ejemplo coloca acciones en la fila superior. Aquí se estandariza a orden row-major (14→15→16→...). Si se quiere bottom-up, hay que redefinir lista de slots y ejemplo.
2. Lore en Script API no es un string con `\n`: normalmente es un array; en documentación puede representarse con `\n`, pero al implementar hay que operar por líneas.
3. Ejemplo con typo: la línea `Frenesí de Tala` terminaba con un `"` sobrante; el parser no debe depender de exactitud del ejemplo.
4. “Cada arma puede tener estas 4 estadísticas”: se listaron muchas más. Se corrige a “estadísticas soportadas (opcionales)”.
5. Flags `1..9`: hoy se tratan como boolean. Si más adelante el dígito representa nivel/cantidad, conviene reservar contrato desde ya, pero el render actual solo necesita `>0`.
6. Items custom no mapeados: con Estrategia A, cualquier clon debe mapearse por nombre. Si aparece un custom no clon, definir icono fallback (p. ej. barrier) o registrar mapping explícito.

## 14) Recomendación: configuración data-driven (tipo `config.js`)

Para evitar hardcodeo y simplificar futuras variantes, se recomienda definir una configuración en un módulo tipo `config.js`, similar al patrón usado en `skills/combat/calc/config.js`.

Objetivo:

- Describir, en un objeto literal, qué significa cada dígito `1..9` por acción.
- Definir qué categorías aparecen en el lore del botón, sus máximos, textos y qué submenú/handler se usa.

Ejemplo conceptual (pseudocódigo):

```js
export const upgradesUiConfig = {
  actionSlots: [14, 15, 16, 23, 24, 25, 32, 33, 34],

  actionsByCodeIndex: {
    // 1: Encantamientos
    1: {
      actionId: "tool_enchants",
      title: "§r§aEncantamientos de herramienta",
      variantsByDigit: {
        // 1 = debug/all categories (temporal)
        1: { variantId: "debug_all", handler: "enchantsMenu", categoryMode: "all" },
        // 2..9 = categorías
        2: { variantId: "sword", handler: "enchantsMenu", categoryMode: "sword" },
        3: { variantId: "bow", handler: "enchantsMenu", categoryMode: "bow" },
        4: { variantId: "armor", handler: "enchantsMenu", categoryMode: "armor" },
        5: { variantId: "hoe", handler: "enchantsMenu", categoryMode: "hoe" },
        6: { variantId: "axe", handler: "enchantsMenu", categoryMode: "axe" },
        7: { variantId: "pickaxe", handler: "enchantsMenu", categoryMode: "pickaxe" },
        8: { variantId: "helmet", handler: "enchantsMenu", categoryMode: "helmet" },
        9: { variantId: "boots", handler: "enchantsMenu", categoryMode: "boots" },
      },
    },

    // 2: Modificadores
    2: {
      actionId: "tool_modifiers",
      title: "§r§aModificadores de herramienta",
      descriptionLines: [
        "§r§7Aplica modificadores especiales tales como",
        "§r§7los §6Sellos effrenatus§7, las §5Runas tier III",
        "§r§7y §cMeliorems maestros§7 necesitan un",
        "§r§7poco de §6ayuda§r§7 extra.",
      ],
      categories: {
        effrenatus: { label: "§r§6 Sellos effrenatus", max: 10 },
        rune_t3: { label: "§r§5 Runas tier III", max: 1 },
        meliorem_master: { label: "§r§c Meliorems maestros", max: 3 },
      },
      variantsByDigit: {
        // 1 = soporta todo
        1: {
          variantId: "default",
          supportedCategories: ["effrenatus", "rune_t3", "meliorem_master"],
          handler: "modifiersMenu",
        },
        // 2 = no soporta effrenatus
        2: {
          variantId: "no_effrenatus",
          supportedCategories: ["rune_t3", "meliorem_master"],
          handler: "modifiersMenu",
        },
        // 3 = no soporta runas
        3: {
          variantId: "no_rune_t3",
          supportedCategories: ["effrenatus", "meliorem_master"],
          handler: "modifiersMenu",
        },
        // 4 = no soporta meliorems
        4: {
          variantId: "no_meliorem_master",
          supportedCategories: ["effrenatus", "rune_t3"],
          handler: "modifiersMenu",
        },
        // 5 = solo runas
        5: {
          variantId: "only_rune_t3",
          supportedCategories: ["rune_t3"],
          handler: "modifiersMenu",
        },
        // 6 = solo meliorems
        6: {
          variantId: "only_meliorem_master",
          supportedCategories: ["meliorem_master"],
          handler: "modifiersMenu",
        },
        // 7 = solo sellos
        7: {
          variantId: "only_effrenatus",
          supportedCategories: ["effrenatus"],
          handler: "modifiersMenu",
        },
      },
    },

    // 3: Información
    3: {
      actionId: "tool_info",
      title: "§r§aInformación de herramienta",
      variantsByDigit: {
        1: { variantId: "default", handler: "infoMenu" },
        2: { variantId: "default", handler: "infoMenu" },
      },
    },

    // 4: Atributos
    4: {
      actionId: "tool_attributes",
      title: "§r§aAtributos de herramienta",
      variantsByDigit: {
        1: { variantId: "default", handler: "attributesMenu" },
      },
    },
  },

  // Catálogo de encantamientos (cosméticos, solo lore)
  enchantments: [
    {
      key: "efficiency",
      name: "Eficiencia",
      maxLevel: 5,
      description: ["(placeholder)"],
      compatible: ["axe", "pickaxe", "hoe"],
    },
    {
      key: "fortune",
      name: "Fortuna",
      maxLevel: 5,
      description: ["(placeholder)"],
      compatible: ["axe", "pickaxe", "hoe"],
    },
    // ...etc
  ],

  // Rarezas: texto exacto + metadatos de UI (para el panel `y`)
  // Nota: `qualityText` debe coincidir exactamente con el lore (incluyendo códigos §).
  rarities: [
    {
      key: "common",
      qualityText: "§f§lCOMÚN",
      paneTexture: "g/white",
      paneDescription: ["Rareza común",]
    },
    {
      key: "uncommon",
      qualityText: "§q§lPOCO COMÚN",
      paneTexture: "g/lime",
      paneDescription: ["Poco común",]
    },
    {
      key: "rare",
      qualityText: "§t§lRARO",
      paneTexture: "g/blue",
      paneDescription: ["Raro",]
    },
    {
      key: "very_rare",
      qualityText: "§u§lMUY RARO",
      paneTexture: "g/magenta",
      paneDescription: ["Muy raro",]
    },
    {
      key: "epic",
      qualityText: "§5§lÉPICO",
      paneTexture: "g/purple",
      paneDescription: ["Épico",]
    },
    {
      key: "legendary",
      qualityText: "§6§lLEGENDARIO",
      paneTexture: "g/orange",
      paneDescription: ["Legendario",]
    },
    {
      key: "ascended",
      qualityText: "§e§lASCENDIDO",
      paneTexture: "g/yellow",
      paneDescription: ["Ascendido",]
    },
    {
      key: "mythic",
      qualityText: "§d§lMÍTICO",
      paneTexture: "g/pink",
      paneDescription: ["Mítico",]
    },
    {
      key: "unic",
      qualityText: "§v§lÚNICO",
      paneTexture: "g/orange",
      paneDescription: ["Único",]
    },
    {
      key: "forgotten",
      qualityText: "§j§lOLVIDADO",
      paneTexture: "g/gray",
      paneDescription: ["Olvidado",]
    },
    {
      key: "relic",
      qualityText: "§s§lRELIQUÍA",
      paneTexture: "g/cyan",
      paneDescription: ["Reliquía",]
    },
    {
      key: "special",
      qualityText: "§c§lESPECIAL",
      paneTexture: "g/red",
      paneDescription: ["Especial",]
    },
    {
      key: "anatema",
      qualityText: "§m§lANA§4TEMA",
      paneTexture: "g/black",
      paneDescription: ["Anatema",]
    },
    {
      key: "absolute",
      qualityText: "§b§lABSO§fLUTO",
      paneTexture: "g/light_blue",
      paneDescription: ["Divino",]
    },
    {
      key: "limitless",
      qualityText: "§4§lL§cI§vM§gI§eT§aL§qE§sS§9S",
      paneTexture: "g/white",
      paneDescription: ["Sin límites",]
    },
  ],
};
```

Puntos clave del enfoque:

- El código `§d§l<RAREZA>§a§b§c§d§e` decide **qué acciones aparecen** y **qué variante usan**.
- El lore de cada botón se renderiza desde config + valores leídos del item (por ejemplo, el “0” del contador).
- El máximo del contador `X/Y` (ej. `0/5`) se deriva del catálogo (`enchantments` filtrado por `compatible`) y de la unión de categorías aplicables.
- La decisión de “ya aplicado / no aplicable” se toma leyendo el estado del item (por ejemplo canales de sumatorios u otras marcas), no por strings fijos.

## 15) Casos de uso (ejemplos)

### Caso de uso A: hacha “MÍTICO” con encantamientos cosméticos

Entrada: ejemplo de lore (representación conceptual con `\n`):

```text
§r§8Poder de Tala 5\\n\\n

§7Daño: §c+15🗡\\n
§7Fortuna de Tala: §6+50🪓\\n
§7Frenesí de Tala: §e+1⭐\\n
§7Experiencia de Talado: §3+10☯\\n\\n"

§9Fortuna IV, Eficiencia V\\n
Prisa Espontánea III, Convicción X\\n\\n

§o§8Un hacha de este tamaño deberia ser mejor\\n
un pedazo de piedra gigante y no un hacha.\\n\\n

§r§d§lMÍTICO§6§1§1§1§0"
```

Extracción del código (última línea):

- Rareza detectada (display): `§d§lMÍTICO`
- Código detectado (5 secuencias): `§6§1§1§1§0` → dígitos: `61110`

Interpretación por dígito:

- Dígito #1 (Encantamientos): `6` → modo categoría `axe`
- Dígito #2 (Modificadores): `1` → soporta `effrenatus + rune_t3 + meliorem_master`
- Dígito #3 (Información): `1` → se muestra
- Dígito #4 (Atributos): `1` → se muestra
- Dígito #5: `0` → no se usa

Resultado esperado en el menú principal:

1) Paneles

- El panel `y` debe resolver su textura/desc desde `rarities[]` usando la rareza detectada.
  - Para `§d§lMÍTICO`, el ejemplo de config propone `paneTexture: "g/pink"` y `paneDescription: "Mítico"`.

2) Slot espejo

- Slot espejo (ej. 20): muestra el ítem real (hacha) con su nombre/lore/glint según reglas del espejo.

3) Botones en el grid (orden determinista)

Como están habilitadas las acciones 1..4, deben colocarse en el grid en este orden:

```text
slot 14: Encantamientos
slot 15: Modificadores
slot 16: Información
slot 23: Atributos
```

4) Contadores mostrados

Encantamientos:

- Categoría efectiva: `axe`
- Pool `axe` (según este documento): { `Eficiencia`, `Fortuna`, `Prisa espontánea`, `Convicción` } → máximo `4`
- Lore del item incluye: `Fortuna`, `Eficiencia`, `Prisa Espontánea`, `Convicción` → aplicados `4` (dedupe, ignorando nivel)
- Por lo tanto, el botón debe mostrar: `Encantamientos: 4/4`

Modificadores:

- La línea de Daño no muestra sumatorios (`[...]` / `(...)`), por lo que se interpreta `DañoSumatorio1=0` y `DañoSumatorio2=0`.
- Sellos effrenatus: `ceil(0/4)=0` → `0/10`
- Meliorems maestros: `ceil(0/20)=0` → `0/3`
- Runas tier III: no se interpretan todavía → `0/1` (modo desarrollo)

Regla de consistencia (aplica a todo contador):

- En cualquier `X/Y`, nunca se debe mostrar `X > Y`.

Nota de implementación futura (sin tocar código ahora):

- Este caso es útil como test porque valida simultáneamente: parsing del código desde el final, selección de categoría `axe`, dedupe de encantamientos por nombre y render de 4 acciones en el grid.
