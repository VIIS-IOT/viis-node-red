import { NodeAPI, Node } from "node-red";
import { createPool, Pool, PoolOptions, PoolConnection, QueryError, RowDataPacket, ResultSetHeader, OkPacket } from "mysql2/promise";
import { EventEmitter } from "events";

// Định nghĩa interface cho cấu hình MySQL
export interface MySqlConfig {
    host: string;
    port?: number; // Mặc định 3306
    user: string;
    password: string;
    database: string;
    connectionLimit?: number; // Số kết nối tối đa trong pool
    queueLimit?: number; // Giới hạn hàng đợi
    connectTimeout?: number; // Timeout cho kết nối (ms)
    waitForConnections?: boolean; // Chờ nếu hết kết nối trong pool
}

// Định nghĩa interface cho kết quả query
export interface QueryResult<T> {
    rows: T;
    fields?: any; // Optional metadata của fields
}

// Core MySQL Client
export class MySqlClientCore extends EventEmitter {
    private pool: Pool | null = null;
    private config: MySqlConfig;
    private node: Node;

    constructor(config: MySqlConfig, node: Node) {
        super();
        this.config = {
            port: 3306,
            connectionLimit: 10, // Mặc định 10 kết nối trong pool
            queueLimit: 0, // Không giới hạn hàng đợi
            connectTimeout: 10000, // 10 giây timeout
            waitForConnections: true, // Chờ kết nối nếu pool đầy
            ...config, // Ghi đè bởi config từ người dùng
        };
        this.node = node;
        this.initializePool();
    }

    // Khởi tạo connection pool
    private async initializePool(): Promise<void> {
        const options: PoolOptions = {
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
            this.pool = await createPool(options);

            // Kiểm tra kết nối ban đầu
            const connection = await this.pool.getConnection();
            connection.release(); // Trả connection về pool
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
            this.emit("mysql-status", { status: "connected" });

            // Xử lý sự kiện khi tạo connection mới trong pool
            this.pool.on("connection", (connection: PoolConnection) => {
                connection.on("error", (err: QueryError) => {
                    this.handleError(err);
                });
            });
        } catch (error) {
            this.handleError(error as QueryError);
        }
    }

    // Xử lý lỗi
    private handleError(error: QueryError): void {
        this.node.error(`MySQL Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("mysql-status", { status: "error", error: error.message });

        if (error.code === "PROTOCOL_CONNECTION_LOST" || error.code === "ECONNREFUSED") {
            this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            this.emit("mysql-status", { status: "disconnected" });
        }
    }

    // Thực thi query với generic type constraint
    public async query<T extends RowDataPacket[] | ResultSetHeader | OkPacket>(
        sql: string,
        params?: any[]
    ): Promise<QueryResult<T>> {
        if (!this.pool) {
            throw new Error("MySQL pool not initialized");
        }

        try {
            const [rows, fields] = await this.pool.execute<T>(sql, params);
            return { rows, fields };
        } catch (error) {
            this.handleError(error as QueryError);
            throw error; // Ném lỗi để custom node xử lý nếu cần
        }
    }

    // Lấy connection từ pool (nếu cần giao dịch - transaction)
    public async getConnection(): Promise<PoolConnection> {
        if (!this.pool) {
            throw new Error("MySQL pool not initialized");
        }
        const connection = await this.pool.getConnection();
        return connection;
    }

    // Đóng pool khi không cần thiết
    public async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.node.log("MySQL pool closed");
            this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
            this.emit("mysql-status", { status: "disconnected" });
        }
    }

    // Kiểm tra trạng thái kết nối
    public async isConnected(): Promise<boolean> {
        try {
            const connection = await this.getConnection();
            connection.release();
            return true;
        } catch (error) {
            return false;
        }
    }
}
