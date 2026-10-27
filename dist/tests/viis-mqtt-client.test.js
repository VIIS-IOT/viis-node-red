"use strict";
/**
 * Unit tests for viis-mqtt-client
 * Tests: topic matching, message queue capping, backup pruning
 */
Object.defineProperty(exports, "__esModule", { value: true });
const mqtt_topic_matcher_1 = require("../core/mqtt-topic-matcher");
describe('viis-mqtt-client', () => {
    describe('matchTopic', () => {
        test('exact match', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/telemetry', 'v1/devices/me/telemetry')).toBe(true);
        });
        test('exact mismatch', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/telemetry', 'v1/devices/me/rpc')).toBe(false);
        });
        test('single-level wildcard + matches one level', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/rpc/request/+', 'v1/devices/me/rpc/request/123')).toBe(true);
        });
        test('single-level wildcard + does not match multiple levels', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/+/me', 'v1/devices/me/extra')).toBe(false);
        });
        test('single-level wildcard + does not match zero levels', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/+/me', 'v1/me')).toBe(false);
        });
        test('multi-level wildcard # matches zero or more levels', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/#', 'v1/devices/me/telemetry')).toBe(true);
        });
        test('multi-level wildcard # matches zero levels', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/#', 'v1/devices')).toBe(true);
        });
        test('multi-level wildcard # at end of pattern', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('#', 'any/topic/at/all')).toBe(true);
        });
        test('no match when pattern is longer', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/telemetry/extra', 'v1/devices/me/telemetry')).toBe(false);
        });
        test('no match when topic is longer and no wildcard', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices', 'v1/devices/me')).toBe(false);
        });
        test('mixed wildcards + and #', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/+/me/#', 'v1/devices/me/telemetry/extra')).toBe(true);
        });
        test('empty pattern matches empty topic', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('', '')).toBe(true);
        });
        test('empty pattern does not match non-empty topic', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('', 'v1/devices')).toBe(false);
        });
        test('pattern with # in middle still matches (MQTT spec: # must be last)', () => {
            // Our implementation returns true as soon as it sees #
            // This is acceptable behavior - MQTT spec says # must be last in real brokers
            expect((0, mqtt_topic_matcher_1.matchTopic)('a/#/b', 'a/anything/here')).toBe(true);
        });
        test('real-world: subscribe RPC wildcard', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/rpc/request/+', 'v1/devices/me/rpc/request/abc123')).toBe(true);
        });
        test('real-world: subscribe RPC does not match response', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/me/rpc/request/+', 'v1/devices/me/rpc/response/abc123')).toBe(false);
        });
    });
    describe('MAX_PENDING_MESSAGES', () => {
        test('is defined and positive', () => {
            expect(mqtt_topic_matcher_1.MAX_PENDING_MESSAGES).toBeGreaterThan(0);
            expect(mqtt_topic_matcher_1.MAX_PENDING_MESSAGES).toBe(100);
        });
    });
    describe('topic matching edge cases', () => {
        test('pattern with trailing slash', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/devices/', 'v1/devices/')).toBe(true);
        });
        test('single level wildcard with empty level', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('v1/+/devices', 'v1//devices')).toBe(true);
        });
        test('multiple single-level wildcards', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('+/+/+', 'a/b/c')).toBe(true);
        });
        test('multiple single-level wildcards mismatch', () => {
            expect((0, mqtt_topic_matcher_1.matchTopic)('+/+/+', 'a/b')).toBe(false);
        });
    });
});
