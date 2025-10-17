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
exports.AppDataSource = void 0;
exports.createDataSource = createDataSource;
require("reflect-metadata");
const dotenv_1 = require("dotenv");
const typeorm_1 = require("typeorm");
const global_context_helper_1 = require("../ultils/global-context-helper");
const path = __importStar(require("path"));
// Load common.env from centralized env directory
// Provides DB_* variables for migrations from host (localhost:3308)
(0, dotenv_1.config)({ path: path.resolve(__dirname, "../../../../../env/common.env") });
// Shared DataSource instance (singleton pattern)
let sharedDataSource = null;
/**
 * Factory function to create or get shared DataSource with proper configuration
 * Can use NodeContext for global context access or fallback to process.env
 *
 * @param nodeContext - Optional Node-RED context for accessing global variables
 * @returns DataSource instance (shared singleton)
 */
function createDataSource(nodeContext) {
    // Return existing instance if available
    if (sharedDataSource) {
        return sharedDataSource;
    }
    // Create new instance
    // Use GlobalContextHelper if nodeContext is available
    const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
    // Helper function to get config value with fallback
    const getConfigValue = (envKey, defaultValue) => {
        if (helper) {
            return helper.getEnvVar(envKey, defaultValue);
        }
        return process.env[envKey] || defaultValue;
    };
    const getNumericValue = (envKey, defaultValue) => {
        if (helper) {
            return helper.getNumericEnvVar(envKey, defaultValue);
        }
        return parseInt(process.env[envKey] || String(defaultValue));
    };
    // Create and cache the shared instance
    sharedDataSource = new typeorm_1.DataSource({
        type: "mysql",
        host: getConfigValue('DB_HOST', 'viis-local-mysql'), // Use container name by default
        port: getNumericValue('DB_PORT', 3306),
        username: getConfigValue('DB_USERNAME', 'root'),
        password: getConfigValue('DB_PASSWORD', 'admin@123'),
        database: getConfigValue('DB_DATABASE', 'viis_local'),
        // Sử dụng glob pattern để load tất cả các file .ts hoặc .js trong thư mục entities và các thư mục con
        entities: [__dirname + "/entities/**/*.{js,ts}"],
        // Tương tự cho migrations
        migrations: [__dirname + "/migrations/**/*.{js,ts}"],
        synchronize: false, // Sử dụng false trong production, dùng migration thay cho synchronize
        logging: false,
    });
    return sharedDataSource;
}
// Default instance for backward compatibility (uses process.env)
exports.AppDataSource = createDataSource();
