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
require("reflect-metadata");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
// Xác định đường dẫn đến file .env bằng cách sử dụng __dirname và path.resolve
// Chú ý đây là path trong docker container.
// Cụ thể thì env lưu ở /usr/src/node-red, còn source viis-node-red lưu ở /usr/src/node-red/viis-node-red
// File dataSource thì nằm ở /usr/src/node-red/viis-node-red/src/orm/dataSource.ts
dotenv.config({ path: path.resolve(__dirname, '../../../', '.env') });
// dotenv.config({ path: path.resolve(__dirname, '.env') });
const typeorm_1 = require("typeorm");
exports.AppDataSource = new typeorm_1.DataSource({
    type: "mysql", // hoặc loại DB bạn đang sử dụng
    host: process.env.DATABASE_HOST || '192.168.1.15',
    port: parseInt(process.env.DATABASE_PORT || '3308'),
    username: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || 'admin@123',
    database: process.env.DATABASE_NAME || 'viis_local',
    // Sử dụng glob pattern để load tất cả các file .ts hoặc .js trong thư mục entities và các thư mục con
    entities: [__dirname + "/entities/**/*.{js,ts}"],
    // Tương tự cho migrations
    migrations: [__dirname + "/migrations/**/*.{js,ts}"],
    synchronize: false, // Sử dụng false trong production, dùng migration thay cho synchronize
    logging: false,
});
