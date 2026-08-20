"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MQTT_SERVER_URL = exports.DEFAULT_HTTP_SERVER_URL = void 0;
// Default server URLs - use GlobalContextHelper.getEnvVar() to get actual values from global context
exports.DEFAULT_HTTP_SERVER_URL = "https://iot.viis.tech";
exports.DEFAULT_MQTT_SERVER_URL = "host.docker.internal";
