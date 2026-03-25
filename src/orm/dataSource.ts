import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import * as path from "path";

config({ path: path.resolve(__dirname, "../../../../../env/common.env") });

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

        // When nodeContext is provided, use global context (JSON configs)
        // When nodeContext is undefined (AppDataSource), use process.env (container env vars)
        return helper ? {
            host: get('DATABASE_HOST', 'viis-local-mysql'),
            port: getNum('DATABASE_PORT', 3306),
            username: get('DATABASE_USERNAME', 'root'),
            password: get('DATABASE_PASSWORD', 'admin@123'),
            database: get('DATABASE_NAME', 'viis_local'),
        } : {
            // For AppDataSource (no nodeContext), read from process.env directly
            host: process.env.DB_HOST || 'viis-local-mysql',
            port: parseInt(process.env.DB_PORT || '3306', 10),
            username: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || 'admin@123',
            database: process.env.DB_DATABASE || 'viis_local',
        };
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