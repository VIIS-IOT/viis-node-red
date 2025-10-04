"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
exports.createDataSource = createDataSource;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const global_context_helper_1 = require("../ultils/global-context-helper");
/**
 * Factory function to create DataSource with proper configuration
 * Can use NodeContext for global context access or fallback to process.env
 *
 * @param nodeContext - Optional Node-RED context for accessing global variables
 * @returns DataSource instance
 */
function createDataSource(nodeContext) {
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
    return new typeorm_1.DataSource({
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
}
// Default instance for backward compatibility (uses process.env)
exports.AppDataSource = createDataSource();
