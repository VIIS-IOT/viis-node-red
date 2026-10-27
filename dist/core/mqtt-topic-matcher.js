"use strict";
/**
 * MQTT topic matching utility
 * Supports + (single-level) and # (multi-level) wildcards per MQTT spec
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PENDING_MESSAGES = void 0;
exports.matchTopic = matchTopic;
/**
 * Match MQTT topic with wildcard support (+ and #)
 * + matches exactly one level
 * # matches zero or more levels (must be last)
 */
function matchTopic(pattern, topic) {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i] === '#') {
            return true;
        }
        if (i >= topicParts.length) {
            return false;
        }
        if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
            return false;
        }
    }
    return patternParts.length === topicParts.length;
}
exports.MAX_PENDING_MESSAGES = 100;
