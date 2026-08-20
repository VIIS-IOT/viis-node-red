"use strict";
/**
 * Resolve the Demeter/VIIS HTTP backend URL from Node-RED global context.
 *
 * env-loader writes common.json after custom nodes construct, so callers must
 * resolve on each request rather than capturing the URL in a constructor.
 * Node.js `global` is not Node-RED context — use GlobalContextHelper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveViisBackendUrl = resolveViisBackendUrl;
const global_context_helper_1 = require("./global-context-helper");
const const_1 = require("../const");
function isNode(source) {
    return typeof source.context === 'function';
}
function resolveViisBackendUrl(source, editorOverride, fallback = const_1.DEFAULT_HTTP_SERVER_URL) {
    const override = (editorOverride || '').trim();
    if (override) {
        return override.replace(/\/$/, '');
    }
    if (!source) {
        return fallback;
    }
    const nodeContext = isNode(source) ? source.context() : source;
    const helper = new global_context_helper_1.GlobalContextHelper(nodeContext);
    const url = helper.getEnvVar('VIIS_BACKEND', '') ||
        helper.getEnvVar('BACKEND_URL', '') ||
        fallback;
    return String(url).replace(/\/$/, '');
}
