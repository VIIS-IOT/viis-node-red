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
const dotenv_1 = require("dotenv");
const typeorm_1 = require("typeorm");
const global_context_helper_1 = require("../ultils/global-context-helper");
const path = __importStar(require("path"));
(0, dotenv_1.config)({ path: path.resolve(__dirname, "../../../../../env/common.env") });
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
        });
        await ds.initialize();
        return ds;
    }
    static getConfig(nodeContext) {
        const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
        const get = (key, fallback) => { var _a, _b; return (_b = (_a = helper === null || helper === void 0 ? void 0 : helper.getEnvVar(key, fallback)) !== null && _a !== void 0 ? _a : process.env[key]) !== null && _b !== void 0 ? _b : fallback; };
        const getNum = (key, fallback) => { var _a, _b; return (_a = helper === null || helper === void 0 ? void 0 : helper.getNumericEnvVar(key, fallback)) !== null && _a !== void 0 ? _a : parseInt((_b = process.env[key]) !== null && _b !== void 0 ? _b : String(fallback)); };
        // Container uses DATABASE_*, host/migrations use DB_*
        return helper ? {
            host: get('DATABASE_HOST', 'viis-local-mysql'),
            port: getNum('DATABASE_PORT', 3306),
            username: get('DATABASE_USERNAME', 'root'),
            password: get('DATABASE_PASSWORD', 'admin@123'),
            database: get('DATABASE_NAME', 'viis_local'),
        } : {
            host: get('DB_HOST', 'localhost'),
            port: getNum('DB_PORT', 3308),
            username: get('DB_USERNAME', 'root'),
            password: get('DB_PASSWORD', 'admin@123'),
            database: get('DB_DATABASE', 'viis_local'),
        };
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
