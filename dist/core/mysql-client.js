"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MySqlClientCore = void 0;
const promise_1 = require("mysql2/promise");
const events_1 = require("events");
// Core MySQL Client
class MySqlClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.pool = null;
        this.config = Object.assign({ port: 3306, connectionLimit: 10, queueLimit: 0, connectTimeout: 10000, waitForConnections: true }, config);
        this.node = node;
        this.initializePool();
    }
    // Khởi tạo connection pool
    async initializePool() {
        const options = {
            host: this.config.host,
            port: this.config.port,
            user: this.config.user,
            password: this.config.password,
            database: this.config.database,
            connectionLimit: this.config.connectionLimit,
            queueLimit: this.config.queueLimit,
            connectTimeout: this.config.connectTimeout,
            waitForConnections: this.config.waitForConnections,
        };
        try {
            this.pool = await (0, promise_1.createPool)(options);
            // Kiểm tra kết nối ban đầu
            const connection = await this.pool.getConnection();
            connection.release(); // Trả connection về pool
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
            this.emit("mysql-status", { status: "connected" });
            // Xử lý sự kiện khi tạo connection mới trong pool
            this.pool.on("connection", (connection) => {
                connection.on("error", (err) => {
                    this.handleError(err);
                });
            });
        }
        catch (error) {
            this.handleError(error);
        }
    }
    // Xử lý lỗi
    handleError(error) {
        this.node.error(`MySQL Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("mysql-status", { status: "error", error: error.message });
        if (error.code === "PROTOCOL_CONNECTION_LOST" || error.code === "ECONNREFUSED") {
            this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            this.emit("mysql-status", { status: "disconnected" });
        }
    }
    // Thực thi query với generic type constraint
    async query(sql, params) {
        if (!this.pool) {
            throw new Error("MySQL pool not initialized");
        }
        try {
            const [rows, fields] = await this.pool.execute(sql, params);
            return { rows, fields };
        }
        catch (error) {
            this.handleError(error);
            throw error; // Ném lỗi để custom node xử lý nếu cần
        }
    }
    // Lấy connection từ pool (nếu cần giao dịch - transaction)
    async getConnection() {
        if (!this.pool) {
            throw new Error("MySQL pool not initialized");
        }
        const connection = await this.pool.getConnection();
        return connection;
    }
    // Đóng pool khi không cần thiết
    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.node.log("MySQL pool closed");
            this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
            this.emit("mysql-status", { status: "disconnected" });
        }
    }
    // Kiểm tra trạng thái kết nối
    async isConnected() {
        try {
            const connection = await this.getConnection();
            connection.release();
            return true;
        }
        catch (error) {
            return false;
        }
    }
}
exports.MySqlClientCore = MySqlClientCore;
