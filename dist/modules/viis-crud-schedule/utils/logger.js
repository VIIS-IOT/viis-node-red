"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (node, message) => {
        if (node) {
            node.warn(`[INFO] ${message}`);
        }
        else {
            console.log(`[INFO] ${message}`);
        }
    },
    error: (node, message) => {
        if (node) {
            node.error(`[ERROR] ${message}`);
        }
        else {
            console.error(`[ERROR] ${message}`);
        }
    },
};
