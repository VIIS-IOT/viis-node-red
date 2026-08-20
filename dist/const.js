"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MQTT_SERVER_URL = exports.DEFAULT_HTTP_SERVER_URL = void 0;
// Last-resort HTTP fallback when common.json has not loaded. MQTT broker has no host fallback — resolveThingsboardMqttBroker() reads THINGSBOARD_* from env-loader.
exports.DEFAULT_HTTP_SERVER_URL = "https://iot.viis.tech";
exports.DEFAULT_MQTT_SERVER_URL = "";
