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
exports.AppDataSource = exports.getDataSourceRefCount = exports.releaseDataSource = exports.createDataSource = exports.DataSourceManager = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const global_context_helper_1 = require("../ultils/global-context-helper");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function resolveCommonJsonPath() {
    const containerPath = path.resolve(__dirname, "../../../../app/env/configs/common.json");
    const hostPath = path.resolve(__dirname, "../../../../../env/configs/common.json");
    if (fs.existsSync(containerPath)) return containerPath;
    if (fs.existsSync(hostPath)) return hostPath;
    return containerPath;
}
const COMMON_JSON_PATH = resolveCommonJsonPath();
function isRunningInDocker() {
    return fs.existsSync("/.dockerenv") || !!process.env.DOCKER_CONTAINER;
}
function readDbConfigFromJson() {
    var _a;
    try {
        const raw = fs.readFileSync(COMMON_JSON_PATH, "utf8");
        const json = JSON.parse(raw);
        const db = ((_a = json.result) === null || _a === void 0 ? void 0 : _a.databaseHost) || json.databaseHost || {};
        let host = db.DB_HOST || "localhost";
        const port = parseInt(db.DB_PORT || "3308", 10);
        if (isRunningInDocker() && (host === "localhost" || host === "127.0.0.1")) {
            host = "viis-local-mysql";
        }
        return {
            host,
            port: isRunningInDocker() && host === "viis-local-mysql" ? 3306 : port,
            username: db.DB_USERNAME || "root",
            password: db.DB_PASSWORD || "admin@123",
            database: db.DB_DATABASE || "viis_local",
        };
    }
    catch (e) {
        throw new Error(`Failed to read DB config from ${COMMON_JSON_PATH}: ${e.message}`);
    }
}
/**
 * DataSource Manager - Thread-safe singleton with reference counting
 *
 * Usage:
 *   const ds = await DataSourceManager.acquire(nodeContext);
 *   // ... use ds ...
 *   await DataSourceManager.release();
 */
class DataSourceManager {
    static async acquire(nodeContext) {
        var _a;
        this.refCount++;
        if ((_a = this.instance) === null || _a === void 0 ? void 0 : _a.isInitialized) {
            return this.instance;
        }
        if (!this.initPromise) {
            this.initPromise = this.initialize(nodeContext);
        }
        this.instance = await this.initPromise;
        this.initPromise = null;
        return this.instance;
    }
    static async release() {
        var _a;
        this.refCount = Math.max(0, this.refCount - 1);
        if (this.refCount === 0 && ((_a = this.instance) === null || _a === void 0 ? void 0 : _a.isInitialized)) {
            await this.instance.destroy().catch(() => { });
            this.instance = null;
        }
    }
    static getRefCount() {
        return this.refCount;
    }
    static async initialize(nodeContext) {
        const cfg = this.getConfig(nodeContext);
        const ds = new typeorm_1.DataSource({
            type: "mysql",
            host: cfg.host,
            port: cfg.port,
            username: cfg.username,
            password: cfg.password,
            database: cfg.database,
            entities: [__dirname + "/entities/**/*.{js,ts}"],
            migrations: [__dirname + "/migrations/**/*.{js,ts}"],
            synchronize: false,
            logging: false,
            // Connection pool configuration
            extra: {
                connectionLimit: 20, // Max connections in pool
                acquireTimeout: 30000, // Wait max 30s for available connection
                connectTimeout: 10000, // Fail fast if can't connect in 10s
                timeout: 30000, // Query timeout
                reconnect: true, // Auto-reconnect on connection loss
            },
        });
        await ds.initialize();
        return ds;
    }
    static getConfig(nodeContext) {
        const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
        const get = (key, fallback) => { var _a; return (_a = helper === null || helper === void 0 ? void 0 : helper.getEnvVar(key, fallback)) !== null && _a !== void 0 ? _a : fallback; };
        const getNum = (key, fallback) => { var _a; return (_a = helper === null || helper === void 0 ? void 0 : helper.getNumericEnvVar(key, fallback)) !== null && _a !== void 0 ? _a : fallback; };
        // When nodeContext is provided, use global context (JSON configs loaded by env-loader)
        // When nodeContext is undefined (CLI/AppDataSource), read directly from common.json
        return helper ? {
            host: get('DATABASE_HOST', 'viis-local-mysql'),
            port: getNum('DATABASE_PORT', 3306),
            username: get('DATABASE_USERNAME', 'root'),
            password: get('DATABASE_PASSWORD', 'admin@123'),
            database: get('DATABASE_NAME', 'viis_local'),
        } : readDbConfigFromJson();
    }
}
exports.DataSourceManager = DataSourceManager;
DataSourceManager.instance = null;
DataSourceManager.refCount = 0;
DataSourceManager.initPromise = null;
// Backward compatibility aliases
exports.createDataSource = DataSourceManager.acquire.bind(DataSourceManager);
exports.releaseDataSource = DataSourceManager.release.bind(DataSourceManager);
exports.getDataSourceRefCount = DataSourceManager.getRefCount.bind(DataSourceManager);
// Legacy sync export for TypeORM CLI (migrations)
// CLI commands need a synchronously available DataSource
// For runtime usage, use DataSourceManager.acquire() instead which reads from global context
const cfg = DataSourceManager['getConfig'](undefined);
exports.AppDataSource = new typeorm_1.DataSource({
    type: "mysql",
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    entities: [__dirname + "/entities/**/*.{js,ts}"],
    migrations: [__dirname + "/migrations/**/*.{js,ts}"],
    synchronize: false,
    logging: false,
});
