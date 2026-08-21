"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const demeter_mqtt_topics_1 = require("../demeter-mqtt-topics");
const DEVICE_ID = 'b4daa293-9086-47ee-8b62-cdc64a61d4ee';
const COMMAND_ID = '11111111-2222-4333-8444-555555555555';
describe('parseDeviceRpcRequestTopic', () => {
    test('reads command id from Demeter downlink topic', () => {
        expect((0, demeter_mqtt_topics_1.parseDeviceRpcRequestTopic)(`v1/device/${DEVICE_ID}/rpc/${COMMAND_ID}`)).toEqual({
            deviceId: DEVICE_ID,
            commandId: COMMAND_ID,
        });
    });
    test('ignores rpc/response uplink so a loop cannot ACK itself', () => {
        expect((0, demeter_mqtt_topics_1.parseDeviceRpcRequestTopic)(`v1/device/${DEVICE_ID}/rpc/response/${COMMAND_ID}`)).toBeNull();
    });
    test('ignores telemetry', () => {
        expect((0, demeter_mqtt_topics_1.parseDeviceRpcRequestTopic)(`v1/device/${DEVICE_ID}/telemetry`)).toBeNull();
    });
});
describe('extractRpcCommandId', () => {
    test('prefers payload.command_id from Demeter publishIoTCoreCommand', () => {
        expect((0, demeter_mqtt_topics_1.extractRpcCommandId)({ command_id: COMMAND_ID, method: 'set_state' }, `v1/device/${DEVICE_ID}/rpc/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`)).toBe(COMMAND_ID);
    });
    test('falls back to MQTT topic when payload omits command_id', () => {
        expect((0, demeter_mqtt_topics_1.extractRpcCommandId)({ method: 'set_state', params: { power: true } }, `v1/device/${DEVICE_ID}/rpc/${COMMAND_ID}`)).toBe(COMMAND_ID);
    });
    test('returns null for local wire input without a command id (oneway-compatible no-op)', () => {
        expect((0, demeter_mqtt_topics_1.extractRpcCommandId)({ method: 'set_state', params: { power: true } })).toBeNull();
    });
    test('rejects non-uuid ids so backend CAST uuid cannot fail the ACK path', () => {
        expect((0, demeter_mqtt_topics_1.extractRpcCommandId)({ command_id: 'not-a-uuid' })).toBeNull();
    });
});
describe('isHandledRpcControlMethod', () => {
    test('acks only methods this node executes', () => {
        expect((0, demeter_mqtt_topics_1.isHandledRpcControlMethod)('set_state')).toBe(true);
        expect((0, demeter_mqtt_topics_1.isHandledRpcControlMethod)('set_state_batch')).toBe(true);
    });
    test('does not ack schedule/oneway methods owned by other nodes', () => {
        expect((0, demeter_mqtt_topics_1.isHandledRpcControlMethod)('create-schedule-by-backend')).toBe(false);
        expect((0, demeter_mqtt_topics_1.isHandledRpcControlMethod)('schedule-enable-by-backend')).toBe(false);
        expect((0, demeter_mqtt_topics_1.isHandledRpcControlMethod)('control')).toBe(false);
    });
});
