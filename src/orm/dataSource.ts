import "reflect-metadata";
import * as dotenv from 'dotenv';
import * as path from 'path';

// Xác định đường dẫn đến file .env bằng cách sử dụng __dirname và path.resolve
dotenv.config({ path: path.resolve(__dirname, '../../../../..', '.env') });

import { DataSource } from "typeorm";

export const AppDataSource = new DataSource({
    type: "mysql", // hoặc loại DB bạn đang sử dụng
    host: process.env.DATABASE_HOST,
    port: 3308,
    username: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: 'viis_local',
    // Sử dụng glob pattern để load tất cả các file .ts hoặc .js trong thư mục entities và các thư mục con
    entities: [__dirname + "/entities/**/*.{js,ts}"],
    // Tương tự cho migrations
    migrations: [__dirname + "/migrations/**/*.{js,ts}"],
    synchronize: false, // Sử dụng false trong production, dùng migration thay cho synchronize
    logging: false,
});
