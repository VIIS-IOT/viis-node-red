"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSource = void 0;
require("reflect-metadata");
// Xác định đường dẫn đến file .env bằng cách sử dụng __dirname và path.resolve
// Chú ý đây là path trong docker container.
// Cụ thể thì env lưu ở /usr/src/node-red, còn source viis-node-red lưu ở /usr/src/node-red/viis-node-red
// File dataSource thì nằm ở /usr/src/node-red/viis-node-red/src/orm/dataSource.ts
// dotenv.config({ path: path.resolve(__dirname, '../../../', '.env') });
const typeorm_1 = require("typeorm");
exports.AppDataSource = new typeorm_1.DataSource({
    type: "mysql", // hoặc loại DB bạn đang sử dụng
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3308'),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    // Sử dụng glob pattern để load tất cả các file .ts hoặc .js trong thư mục entities và các thư mục con
    entities: [__dirname + "/entities/**/*.{js,ts}"],
    // Tương tự cho migrations
    migrations: [__dirname + "/migrations/**/*.{js,ts}"],
    synchronize: false, // Sử dụng false trong production, dùng migration thay cho synchronize
    logging: false,
});
