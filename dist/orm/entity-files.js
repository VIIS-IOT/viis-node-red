"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.entityFiles = entityFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MODULE_FILE = /\.[cm]?[jt]s$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;
const TEST_DIRS = new Set(["__tests__", "tests"]);
/**
 * The entity modules under `dir`, for TypeORM's `entities`. A plain `entities/**\/*.js` glob also matched compiled
 * jest files (`__tests__/*.test.js` land in `dist` when the build includes tests): TypeORM required them at startup,
 * hit `describe is not defined`, and every node that needs the gateway database failed to start.
 */
function entityFiles(dir) {
    if (!fs.existsSync(dir))
        return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!TEST_DIRS.has(entry.name))
                files.push(...entityFiles(full));
        }
        else if (MODULE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts") && !TEST_FILE.test(entry.name)) {
            files.push(full);
        }
    }
    return files.sort();
}
