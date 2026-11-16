# AntiCheat – Scoreboards

Este Behavior Pack usa scoreboards como almacenamiento **best-effort** (cuando Dynamic Properties no están disponibles o no son fiables).

La inicialización centralizada se hace en:
- [scripts/scoreboards/init.js](../../scoreboards/init.js)

> Importante: los objectives se crean **después de `worldLoad`** para evitar fallos en entornos donde el mundo todavía no está listo.

## Lista de objectives

### `ac_feature_flags`
- **Uso:** Persistir flags globales del anticheat (no por jugador).
- **Participantes (players set):**
  - `ac_enabled` → 0/1 (anticheat apagado/encendido)
  - `ac_ban_kick_enabled` → 0/1 (sistema de kick por ban apagado/encendido)
- **Módulo principal:** `core/featureFlags.js`

### `advertencias`
- **Uso:** Advertencias **persistentes por jugador**.
- **Valor:** número entero de warnings del jugador (ej. 0…3).
- **Módulo principal:** `core/playerStore.js` + `core/warnings.js`

### `ac_ban_until`
- **Uso:** Estado de ban por jugador basado en tiempo real.
- **Valor:** epoch seconds (segundos desde 1970).
- **Convenciones:**
  - `0` → no baneado
  - `INT32_MAX` (2147483647) → ban permanente
  - `> now()` → baneado hasta esa fecha
- **Módulo principal:** `core/sanctions.js`

### `ac_ban_seconds`
- **Uso:** Segundos restantes del ban (para comandos/admin).
- **Valor:**
  - `0` → no baneado
  - `INT32_MAX` (2147483647) → permanente
  - `N` → segundos restantes del ban
- **Actualización:** se mantiene sincronizado cada ~1s por `core/banClock.js`.
- **Nota:** el estado real sigue siendo `ac_ban_until` (epoch seconds).
- **Módulos principales:** `core/sanctions.js` + `core/banClock.js`

### `ac_ban_sanction`
- **Uso:** Guardar qué sanción (id) generó el ban.
- **Valor:** id de sanción (por ejemplo 2/3/6/7 según tu config).
- **Módulo principal:** `core/sanctions.js`

## Notas de compatibilidad

- Si el servidor/realm no permite `kick` por permisos/cheats, el sistema seguirá guardando el ban en scoreboards pero el kick puede fallar (se registra como warning en logs cuando ocurre).
- Los módulos también tienen lógica de fallback (best-effort) por seguridad, aunque la creación centralizada mantiene el orden y evita duplicación.

