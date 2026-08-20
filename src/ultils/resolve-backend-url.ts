/**
 * Resolve the Demeter/VIIS HTTP backend URL from Node-RED global context.
 *
 * env-loader writes common.json after custom nodes construct, so callers must
 * resolve on each request rather than capturing the URL in a constructor.
 * Node.js `global` is not Node-RED context — use GlobalContextHelper.
 */

import { Node, NodeContext } from 'node-red';
import { GlobalContextHelper } from './global-context-helper';
import { DEFAULT_HTTP_SERVER_URL } from '../const';

function isNode(source: Node | NodeContext): source is Node {
    return typeof (source as Node).context === 'function';
}

export function resolveViisBackendUrl(
    source: Node | NodeContext | null | undefined,
    editorOverride?: string,
    fallback: string = DEFAULT_HTTP_SERVER_URL
): string {
    const override = (editorOverride || '').trim();
    if (override) {
        return override.replace(/\/$/, '');
    }

    if (!source) {
        return fallback;
    }

    const nodeContext = isNode(source) ? source.context() : source;
    const helper = new GlobalContextHelper(nodeContext);
    const url =
        helper.getEnvVar('VIIS_BACKEND', '') ||
        helper.getEnvVar('BACKEND_URL', '') ||
        fallback;

    return String(url).replace(/\/$/, '');
}
