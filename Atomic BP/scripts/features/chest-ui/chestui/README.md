Chest UI (ChestFormData)

## Import

```js
import ChestFormData from './chestui/forms.js' // No brackets
```

## Create

Supports sizes up to 81 plus 108 and 162.

```js
const defaultUi = new ChestFormData()
const ui = new ChestFormData(63, "63 slot ui")
```

## Buttons

```js
ui.button(10, "slot 10", [], "apple", 10) // index, hover text, subtext, texture, stack text
ui.button({x: 4, y: 6}, "x 4 y 6", "", "g/lime", "+", 0, false, "a") // coords, hover text, subtext, texture, stack text, durability, enchanted, color
```

### Batch buttons: `.buttons(buttons)`

Adds multiple buttons at once (useful to keep menus declarative and avoid repeated `ui.button(...)`).

```js
ui.buttons([
	{ slot: 20, itemName: "§aCentro", itemDesc: ["§7Hola"], texture: "i/book", stackAmount: 0, durability: 0, enchanted: false },
	{ slot: { x: 1, y: 1 }, itemName: "§bXY", itemDesc: [], texture: "g/blue", stackAmount: 0 },
])
```

Supported fields per entry:
- `slot` (number or `{x,y}`)
- `itemName`, `itemDesc`, `texture`, `stackAmount`/`stackSize`, `durability`, `enchanted`, `color`

### Parameter notes

- Slot: can be a number or coordinates `{x,y}`.
- Texture: assumes the `minecraft:` namespace. Numbers are accepted and show aux values.
- Stack Amount: shows 6 bytes of characters.
	- number → shows from -99 to 999 (excluding 0)
	- string → any simple chars up to 6 bytes
	- `["..."]` → manual control when using multi-byte chars
- Color: applies a `§` color code to stack text (1 char).

## New functions

### `.border(data, thickness)`

Fills a border around the chest ui and updates `borderSlots`.

```js
ui.border({ itemName: "border item", texture: "g/gray" }, 1)
```

### `.fill(from, to, data)`

Fills slots consecutively (index) or a bounds (coords).

```js
ui.fill(1, 2, { texture: "g/blue" })
ui.fill({ x: 1, y: 1 }, { x: 3, y: 5 }, { texture: "t/ui/background_image" })
```

### `.default(data)`

Sets default data used by `.pattern`, `.border`, `.fill`.

```js
ui.default({ itemName: "...", texture: "b/barrier" })
ui.border() // uses default
```

## Scoreboard placeholders in text

Any button label/lore string can include scoreboard placeholders that get replaced at `ui.show(player)` time (snapshot).

### Syntax

New (standard):

```
${(objective)[capObjective]:target:useCommas:multiplier}
```

Legacy (compat):

```
${objective:selector:useCommas:multiplier}
```

- `objective`: scoreboard objective id (e.g. `D`, `DB`).
  - In the new format, it is wrapped in parentheses to allow `:` inside objective names.
- `capExpr` (optional, new format only): caps the value after scaling.
	- Order: `scaled = floor(base * multiplier)` then `final = min(scaled, capValue)`.
	- `capExpr` can be:
		- an objective id: `DBlimite`
		- a simple binary expression between two objective ids: `DBlimite-DB`, `A+B`, `A*B`, `A/B`
	- Division rule: `floor(a / b)`. If `b <= 0` → `0`.
	- If an objective in `capExpr` does not exist, it is treated as `0`.
- `selector`:
	- `@s` = the player that opened the UI
	- any other string = fake player / scoreboard participant name (e.g. `Jugadorfalso`)
- `useCommas`: `true` → format with commas (`1000` → `1,000`), otherwise treated as `false`.
- `multiplier` (optional): decimal or integer, default `1`.
	- final value shown is `floor(baseScore * multiplier)` (then capped if `capExpr` exists).

### Examples

- `${(D):@s:true:1}` with `D=10000` → `10,000`
- `${(D):@s:true:0.5}` with `D=10001` → `5,000`
- `${(D)[DBlimite]:@s:true:0.5}` with `D=100`, `DBlimite=10` → `10`
- `${(D)[DBlimite-DB]:@s:true:0.5}` with `D=100`, `DBlimite=10`, `DB=1` → `9`
- `${DB:Jugadorfalso:false:1}` with fake player `Jugadorfalso` DB=123 → `123`
- `${(NoExiste):@s:true:1}` → `0`
- `${(D)[NoExiste]:@s:true:1}` → `0`

### Robustness rules

- Any parse/read error → `0`.
- Never displays floats (always `floor`).
- Negative results clamp to `0` by default.

## Conditional placeholders in text

Any button label/lore string can also include conditional placeholders that get replaced at `ui.show(player)` time (before `${...}` replacements).

### Syntax

```
$[condTarget:condScore:condSign:condInt:(message)]
```

- `condTarget`: currently only `@s` is supported.
- `condScore`: scoreboard objective id to read (e.g. `D`, `Acto`, `Mejora`).
- `condSign`: one of `>=`, `<=`, `==`, `!=`, `>`, `<`.
- `condInt`: value to compare against.
	- integer: `10`
	- scoreboard objective id: `DB` or `(DBlimite)`
	- if your objective id contains spaces, wrap it in parentheses: `(Mi Score con espacios)`
- `message`: text to insert when the condition is true (must be wrapped in parentheses).
	- The message may contain `${...}` placeholders; they are resolved after this step.

If the condition is false, or the placeholder is malformed, it is replaced with an empty string.

Lore note: if a whole lore line is only a `$[...]` placeholder and it evaluates false, that line is removed (so it does not show as a blank line).

### Examples

- `$[@s:D:>=:1000:(§a✔ Tienes suficiente dinero)]`
- `$[@s:Mejora:==:0:(§ePrimera mejora disponible)]`
- `$[@s:D:<:1000:(§cDinero actual: ${(D):@s:true:1})]` (message supports `${...}`)

## Variables

- `borderSlots`: array of slots considered part of the border.
- `centerSlots`: array containing all slots not part of the border.
- `center`, `upperCenter`, `lowerCenter`, `bottom`: convenience indices.

## Texture path shortcuts

- `i/` = `textures/items/`
- `b/` = `textures/blocks/`
- `g/` = `textures/blocks/glass_` (falls back to regular glass if no color)
- `t/` = `textures/`
