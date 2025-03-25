import { Node } from 'node-red';

export const logger = {
    info: (node: Node | null, message: string) => {
        if (node) {
            node.warn(`[INFO] ${message}`);
        } else {
            console.log(`[INFO] ${message}`);
        }
    },
    error: (node: Node | null, message: string) => {
        if (node) {
            node.error(`[ERROR] ${message}`);
        } else {
            console.error(`[ERROR] ${message}`);
        }
    },
};