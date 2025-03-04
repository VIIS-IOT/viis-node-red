"use strict";
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
        try {
            this.client = mqtt_1.default.connect(this.config.broker, options);
            // Xử lý sự kiện kết nối
            this.client.on("connect", () => {
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("mqtt-status", { status: "connected" });
                // Tự động resubscribe các topic đã đăng ký trước đó
                this.resubscribeTopics();
            });
            // Xử lý sự kiện ngắt kết nối
            this.client.on("close", () => {
                this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                this.emit("mqtt-status", { status: "disconnected" });
            });
            // Xử lý sự kiện lỗi
            this.client.on("error", (error) => {
                this.node.error(`MQTT Error: ${error.message}`);
                this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
                this.emit("mqtt-status", { status: "error", error: error.message });
            });
            // Xử lý message nhận được
            this.client.on("message", (topic, message, packet) => {
                const mqttMessage = {
                    topic,
                    message: message.toString(), // Chuyển Buffer thành string
                    qos: packet.qos,
                    retain: packet.retain,
                };
                this.emit("mqtt-message", { message: mqttMessage });
            });
        }
        catch (error) {
            this.node.error(`Failed to initialize MQTT client: ${error}`);
        }
    }
    // Subscribe topic
    subscribe(topic, qos = this.config.qos) {
        if (!this.client || !this.client.connected) {
            this.subscribedTopics.add(topic); // Lưu topic để resubscribe khi reconnect
            return;
        }
        this.client.subscribe(topic, { qos }, (err) => {
            if (err) {
                this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
            }
            else {
                this.subscribedTopics.add(topic);
                this.node.log(`Subscribed to topic: ${topic}`);
            }
        });
    }
    // Unsubscribe topic
    unsubscribe(topic) {
        if (!this.client || !this.client.connected) {
            this.subscribedTopics.delete(topic);
            return;
        }
        this.client.unsubscribe(topic, (err) => {
            if (err) {
                this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
            }
            else {
                this.subscribedTopics.delete(topic);
                this.node.log(`Unsubscribed from topic: ${topic}`);
            }
        });
    }
    // Publish message
    publish(topic, message, options) {
        if (!this.client || !this.client.connected) {
            this.node.warn(`Cannot publish to ${topic}: MQTT client not connected`);
            return;
        }
        const publishOptions = Object.assign({ qos: this.config.qos }, options);
        this.client.publish(topic, message, publishOptions, (err) => {
            if (err) {
                this.node.error(`Failed to publish to ${topic}: ${err.message}`);
            }
            else {
                this.node.log(`Published to topic: ${topic}`);
            }
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
