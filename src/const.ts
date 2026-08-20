// Last-resort HTTP fallback when common.json has not loaded. MQTT broker has no host fallback — resolveThingsboardMqttBroker() reads THINGSBOARD_* from env-loader.
export const DEFAULT_HTTP_SERVER_URL = "https://iot.viis.tech";
export const DEFAULT_MQTT_SERVER_URL = "";

