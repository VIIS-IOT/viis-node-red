import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import * as path from "path";

// Load common.env from centralized env directory
// Provides DB_* variables for migrations from host (localhost:3308)
config({ path: path.resolve(__dirname, "../../../../../env/common.env") });

// Shared DataSource instance (singleton pattern)
let sharedDataSource: DataSource | null = null;

/**
 * Factory function to create or get shared DataSource with proper configuration
 * Can use NodeContext for global context access or fallback to process.env
 * 
 * @param nodeContext - Optional Node-RED context for accessing global variables
 * @returns DataSource instance (shared singleton)
 */
export function createDataSource(nodeContext?: NodeContext): DataSource {
    // Return existing instance if available
    if (sharedDataSource) {
        return sharedDataSource;
    }
    
    // Create new instance
    // Use GlobalContextHelper if nodeContext is available
    const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;
    
    // Helper function to get config value with fallback
    const getConfigValue = (envKey: string, defaultValue: any): any => {
        if (helper) {
            return helper.getEnvVar(envKey, defaultValue);
        }
        return process.env[envKey] || defaultValue;
    };
    
    const getNumericValue = (envKey: string, defaultValue: number): number => {
        if (helper) {
            return helper.getNumericEnvVar(envKey, defaultValue);
        }
        return parseInt(process.env[envKey] || String(defaultValue));
    };
    
    // Create and cache the shared instance
    sharedDataSource = new DataSource({
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
export const AppDataSource = createDataSource();