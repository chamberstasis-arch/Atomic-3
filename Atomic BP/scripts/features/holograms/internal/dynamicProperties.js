// @minecraft/server 2.x: Dynamic Properties son schemaless y no requieren registro previo.
// worldInitialize y DynamicPropertiesDefinition fueron removidos de la superficie estable 2.0.0+.
// Esta función se mantiene como no-op para compatibilidad de llamadas existentes.

export function registerHologramEntityDynamicProperties(config) {
	void config;
	// No-op: en @minecraft/server 2.x, entity.setDynamicProperty() funciona sin registro.
}
