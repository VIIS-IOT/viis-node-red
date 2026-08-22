"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUrl = parseUrl;
/**
 * HTTP-in on the TCP flow is /api/v2/schedule*, while handlers compare /api/v3.
 * Rewrite only those prefixes so plan is checked before schedule (prefix collision).
 */
function parseUrl(url) {
    const path = String(url || '').split('?')[0];
    if (path === '/api/v2/schedulePlan' || path.startsWith('/api/v2/schedulePlan/')) {
        return `/api/v3${path.slice('/api/v2'.length)}`;
    }
    if (path === '/api/v2/schedule' || path.startsWith('/api/v2/schedule/')) {
        return `/api/v3${path.slice('/api/v2'.length)}`;
    }
    return path;
}
