"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigEnvLoader = void 0;
const modbus_client_1 = require("../core/modbus-client");
const mysql_client_1 = require("../core/mysql-client");
class ConfigEnvLoader {
    constructor(node) {
        this.node = node;
        this.initializeClients();
    }
    initializeClients() {
        // Cấu hình MySQL từ .env
        const mysqlConfig = {
            host: process.env.DB_HOST || "viis-local-mysql",
            port: parseInt(process.env.DB_PORT || "3306", 10),
            user: process.env.DB_USERNAME || "root",
            password: process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || "admin@123",
            database: process.env.DB_DATABASE || "viis_local",
            connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
            queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || "0", 10),
            connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "10000", 10),
            waitForConnections: process.env.DB_WAIT_FOR_CONNECTIONS !== "false",
        };
        // Cấu hình Modbus từ .env
        const modbusConfig = {
            type: process.env.MODBUS_TYPE || "TCP",
            host: process.env.MODBUS_HOST || "192.168.27.135",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: process.env.MODBUS_PARITY || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        // Khởi tạo MySQL client
        if (process.env.DB_HOST ||
            process.env.DB_PORT ||
            process.env.DB_USERNAME ||
            process.env.DB_PASSWORD ||
            process.env.DB_DATABASE ||
            process.env.MYSQL_ROOT_PASSWORD) {
            try {
                this.mysqlClient = new mysql_client_1.MySqlClientCore(mysqlConfig, this.node);
                this.node.log(`MySQL client initialized with config: ${JSON.stringify(mysqlConfig)}`);
                this.mysqlClient.on("mysql-status", (data) => {
                    this.node.log(`MySQL Status: ${data.status}${data.error ? ` - ${data.error}` : ""}`);
                    this.node.status({
                        fill: data.status === "connected" ? "green" : data.status === "error" ? "yellow" : "red",
                        shape: data.status === "connected" ? "dot" : "ring",
                        text: data.status === "connected" ? "Connected" : `Error: ${data.error || "Disconnected"}`,
                    });
                });
            }
            catch (error) {
                const err = error;
                this.node.error(`Failed to initialize MySQL client: ${err.message}`);
                this.node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
            }
        }
        else {
            this.node.log("No MySQL configuration found in .env, skipping MySQL client initialization");
        }
        // Khởi tạo Modbus client
        if (process.env.MODBUS_TYPE ||
            process.env.MODBUS_HOST ||
            process.env.MODBUS_TCP_PORT ||
            process.env.MODBUS_SERIAL_PORT ||
            process.env.MODBUS_HOLDING_REGISTERS) {
            try {
                this.modbusClient = new modbus_client_1.ModbusClientCore(modbusConfig, this.node);
                this.node.log(`Modbus client initialized with config: ${JSON.stringify(modbusConfig)}`);
                this.modbusClient.on("modbus-status", (data) => {
                    this.node.log(`Modbus Status: ${data.status}${data.error ? ` - ${data.error}` : ""}`);
                    this.node.status({
                        fill: data.status === "connected" ? "green" : data.status === "error" ? "yellow" : "red",
                        shape: data.status === "connected" ? "dot" : "ring",
                        text: data.status === "connected" ? "Connected" : `Error: ${data.error || "Disconnected"}`,
                    });
                });
            }
            catch (error) {
                const err = error;
                this.node.error(`Failed to initialize Modbus client: ${err.message}`);
                this.node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
            }
        }
        else {
            this.node.log("No Modbus configuration found in .env, skipping Modbus client initialization");
        }
    }
    // Phương thức để đóng các client
    disconnect() {
        if (this.mysqlClient) {
            this.mysqlClient
                .disconnect()
                .then(() => this.node.log("MySQL client disconnected"))
                .catch((err) => this.node.error(`Error disconnecting MySQL: ${err}`));
        }
        if (this.modbusClient) {
            this.modbusClient.disconnect();
            this.node.log("Modbus client disconnected");
        }
    }
}
exports.ConfigEnvLoader = ConfigEnvLoader;
