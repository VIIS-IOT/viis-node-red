"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttClientCore = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const events_1 = require("events");
// Core MQTT Client
class MqttClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.client = null;
        this.connectionPromise = null;
        this.subscribedTopics = new Set();
        this.config = Object.assign({ reconnectPeriod: 5000, connectTimeout: 30000, keepalive: 60 }, config);
        this.node = node;
        this.initializeClient();
    }
    // Khởi tạo MQTT client
    initializeClient() {
        const options = {
            clientId: this.config.clientId || `nodered_${Math.random().toString(16).substr(2, 8)}`,
            username: this.config.username,
            password: this.config.password,
            reconnectPeriod: this.config.reconnectPeriod,
            connectTimeout: this.config.connectTimeout,
            keepalive: this.config.keepalive,
        };
        this.client = mqtt_1.default.connect(this.config.broker, options);
        // Khai báo rõ ràng this.connectionPromise là Promise<void>
        this.connectionPromise = new Promise((resolve, reject) => {
            this.client.on("connect", () => {
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("mqtt-status", { status: "connected" });
                this.resubscribeTopics();
                resolve(); // Không trả về giá trị, chỉ resolve void
            });
            this.client.on("error", (error) => {
                this.node.error(`MQTT Error: ${error.message}`);
                this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
                reject(error); // Reject với Error
            });
        });
        this.client.on("close", () => {
            this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            this.emit("mqtt-status", { status: "disconnected" });
        });
        this.client.on("message", (topic, message, packet) => {
            const mqttMessage = {
                topic,
                message: message.toString(),
                qos: packet.qos,
                retain: packet.retain,
            };
            this.emit("mqtt-message", { message: mqttMessage });
        });
    }
    // Chờ kết nối trước khi sử dụng
    waitForConnection() {
        return __awaiter(this, arguments, void 0, function* (timeoutMs = 30000) {
            var _a;
            if ((_a = this.client) === null || _a === void 0 ? void 0 : _a.connected)
                return; // Đã kết nối thì return ngay
            if (!this.connectionPromise)
                throw new Error("Client not initialized");
            // Promise.race với kiểu rõ ràng là Promise<void>
            yield Promise.race([
                this.connectionPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)),
            ]);
        });
    }
    // Subscribe topic
    subscribe(topic_1) {
        return __awaiter(this, arguments, void 0, function* (topic, qos = this.config.qos) {
            if (!this.client)
                throw new Error("MQTT client not initialized");
            if (!this.client.connected) {
                yield this.waitForConnection();
            }
            return new Promise((resolve, reject) => {
                this.client.subscribe(topic, { qos }, (err) => {
                    if (err) {
                        this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
                        reject(err);
                    }
                    else {
                        this.subscribedTopics.add(topic);
                        this.node.log(`Subscribed to topic: ${topic}`);
                        resolve();
                    }
                });
            });
        });
    }
    // Unsubscribe topic
    unsubscribe(topic) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client)
                throw new Error("MQTT client not initialized");
            if (!this.client.connected) {
                yield this.waitForConnection();
            }
            return new Promise((resolve, reject) => {
                this.client.unsubscribe(topic, (err) => {
                    if (err) {
                        this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
                        reject(err);
                    }
                    else {
                        this.subscribedTopics.delete(topic);
                        this.node.log(`Unsubscribed from topic: ${topic}`);
                        resolve();
                    }
                });
            });
        });
    }
    // Publish message, chỉ khi đã kết nối
    publish(topic, message, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client)
                throw new Error("MQTT client not initialized");
            if (!this.client.connected) {
                this.node.warn(`MQTT client not connected to ${this.config.broker}, waiting for connection...`);
                yield this.waitForConnection();
            }
            return new Promise((resolve, reject) => {
                this.client.publish(topic, message, Object.assign({ qos: this.config.qos }, options), (err) => {
                    if (err) {
                        this.node.error(`Failed to publish to ${topic}: ${err.message}`);
                        reject(err);
                    }
                    else {
                        this.node.log(`Published to topic: ${topic}`);
                        resolve();
                    }
                });
            });
        });
    }
    // Resubscribe tất cả các topic khi reconnect
    resubscribeTopics() {
        if (!this.client)
            return;
        for (const topic of this.subscribedTopics) {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                }
                else {
                    this.node.log(`Resubscribed to topic: ${topic}`);
                }
            });
        }
    }
    // Ngắt kết nối thủ công
    disconnect() {
        if (this.client) {
            this.client.end(() => {
                this.node.log("MQTT client disconnected manually");
            });
        }
    }
    // Kiểm tra trạng thái kết nối
    isConnected() {
        var _a, _b;
        return (_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : false;
    }
}
exports.MqttClientCore = MqttClientCore;
// // Ví dụ tích hợp vào custom node
// export function registerMqttConfigNode(RED: NodeAPI) {
//     function MqttConfigNode(this: Node, config: MqttConfig) {
//         RED.nodes.createNode(this, config);
//         const mqttClient = new MqttClientCore(config, this);
//         // Đăng ký sự kiện để custom node khác sử dụng
//         this.on("close", () => {
//             mqttClient.disconnect();
//         });
//         // Lưu mqttClient vào node để các node khác truy cập
//         (this as any).mqttClient = mqttClient;
//     }
//     RED.nodes.registerType("mqtt-config", MqttConfigNode);
// }
