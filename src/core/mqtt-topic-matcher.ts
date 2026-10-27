/**
 * MQTT topic matching utility
 * Supports + (single-level) and # (multi-level) wildcards per MQTT spec
 */

/**
 * Match MQTT topic with wildcard support (+ and #)
 * + matches exactly one level
 * # matches zero or more levels (must be last)
 */
export function matchTopic(pattern: string, topic: string): boolean {
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

export const MAX_PENDING_MESSAGES = 100;
