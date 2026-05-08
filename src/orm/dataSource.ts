import "reflect-metadata";
import { DataSource } from "typeorm";
import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import * as fs from "fs";
import * as path from "path";

function resolveCommonJsonPath(): string {
    const containerPath = path.resolve(__dirname, "../../../../app/env/configs/common.json");
    const hostPath = path.resolve(__dirname, "../../../../../env/configs/common.json");
    if (fs.existsSync(containerPath)) return containerPath;
    if (fs.existsSync(hostPath)) return hostPath;
    return containerPath;
}
const COMMON_JSON_PATH = resolveCommonJsonPath();

function isRunningInDocker(): boolean {
    return fs.existsSync("/.dockerenv") || !!process.env.DOCKER_CONTAINER;
}

function readDbConfigFromJson() {
    try {
        const raw = fs.readFileSync(COMMON_JSON_PATH, "utf8");
        const json = JSON.parse(raw);
        const db = json.result?.databaseHost || json.databaseHost || {};
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
    } catch (e) {
        throw new Error(`Failed to read DB config from ${COMMON_JSON_PATH}: ${(e as Error).message}`);
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
export class DataSourceManager {
    private static instance: DataSource | null = null;
    private static refCount = 0;
    private static initPromise: Promise<DataSource> | null = null;

    static async acquire(nodeContext?: NodeContext): Promise<DataSource> {
        this.refCount++;

        if (this.instance?.isInitialized) {
            return this.instance;
        }

        if (!this.initPromise) {
            this.initPromise = this.initialize(nodeContext);
        }

        this.instance = await this.initPromise;
        this.initPromise = null;
        return this.instance;
    }

    static async release(): Promise<void> {
        this.refCount = Math.max(0, this.refCount - 1);

        if (this.refCount === 0 && this.instance?.isInitialized) {
            await this.instance.destroy().catch(() => {});
            this.instance = null;
        }
    }

    static getRefCount(): number {
        return this.refCount;
    }

    private static async initialize(nodeContext?: NodeContext): Promise<DataSource> {
        const cfg = this.getConfig(nodeContext);

        const ds = new DataSource({
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
                connectionLimit: 20,           // Max connections in pool
                acquireTimeout: 30000,         // Wait max 30s for available connection
                connectTimeout: 10000,         // Fail fast if can't connect in 10s
                timeout: 30000,                // Query timeout
                reconnect: true,               // Auto-reconnect on connection loss
            },
        });

        await ds.initialize();
        return ds;
    }

    private static getConfig(nodeContext?: NodeContext) {
        const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;

        const get = (key: string, fallback: string) =>
            helper?.getEnvVar(key, fallback) ?? fallback;

        const getNum = (key: string, fallback: number) =>
            helper?.getNumericEnvVar(key, fallback) ?? fallback;

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

// Backward compatibility aliases
export const createDataSource = DataSourceManager.acquire.bind(DataSourceManager);
export const releaseDataSource = DataSourceManager.release.bind(DataSourceManager);
export const getDataSourceRefCount = DataSourceManager.getRefCount.bind(DataSourceManager);

// Legacy sync export for TypeORM CLI (migrations)
// CLI commands need a synchronously available DataSource
// For runtime usage, use DataSourceManager.acquire() instead which reads from global context
const cfg = DataSourceManager['getConfig'](undefined);

export const AppDataSource = new DataSource({
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