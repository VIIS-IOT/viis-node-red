import "reflect-metadata";
import * as dotenv from 'dotenv';
import * as path from 'path';

// Xác định đường dẫn đến file .env bằng cách sử dụng __dirname và path.resolve
// Chú ý đây là path trong docker container.
// Cụ thể thì env lưu ở /usr/src/node-red, còn source viis-node-red lưu ở /usr/src/node-red/viis-node-red
// File dataSource thì nằm ở /usr/src/node-red/viis-node-red/src/orm/dataSource.ts
dotenv.config({ path: path.resolve(__dirname, '../../../../../', '.env') });
// dotenv.config({ path: path.resolve(__dirname, '../../../', '.env') });

import { DataSource } from "typeorm";

export const AppDataSource = new DataSource({
    type: "mysql", // hoặc loại DB bạn đang sử dụng
    host: process.env.DATABASE_HOST || '192.168.27.1401',
    port: parseInt(process.env.DATABASE_PORT || '3308'),
    username: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || 'admin@123',
    database: process.env.DATABASE_NAME || 'viis_local',
    // Sử dụng glob pattern để load tất cả các file .ts hoặc .js trong thư mục entities và các thư mục con
    entities: [__dirname + "/entities/**/*.{js,ts}"],
    // Tương tự cho migrations
    migrations: [__dirname + "/migrations/**/*.{js,ts}"],
    synchronize: false, // Sử dụng false trong production, dùng migration thay cho synchronize
    logging: true,
});