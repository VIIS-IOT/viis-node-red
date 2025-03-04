import { NodeAPI, Node } from "node-red";
import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from "mqtt";
import { EventEmitter } from "events";

// Định nghĩa interface cho cấu hình MQTT
export interface MqttConfig {
    broker?: string; // Ví dụ: mqtt://localhost:1883
    clientId?: string;
    username?: string;
    password?: string;
    reconnectPeriod?: number; // Thời gian chờ trước khi reconnect (ms)
    connectTimeout?: number; // Timeout cho kết nối (ms)
    keepalive?: number; // Keepalive interval (s)
    qos: 0 | 1 | 2; // Quality of Service mặc định
}

// Định nghĩa interface cho message nhận được
export interface MqttMessage {
    topic: string;
    message: string | Buffer;
    qos: 0 | 1 | 2;
    retain: boolean;
}

// Core MQTT Client
export class MqttClientCore extends EventEmitter {
    private client: MqttClient | null = null;
    private config: MqttConfig;
    private node: Node;
    private subscribedTopics: Set<string> = new Set();

    constructor(config: MqttConfig, node: Node) {
        super();
        this.config = {
            reconnectPeriod: 5000, // 5 giây reconnect
            connectTimeout: 30000, // 30 giây timeout
            keepalive: 60, // 60 giây keepalive
            ...config, // Ghi đè bởi config từ người dùng
        };
        this.node = node;
        this.initializeClient();
    }

    // Khởi tạo MQTT client
    private initializeClient(): void {
        const options: IClientOptions = {
            clientId: this.config.clientId || `nodered_${Math.random().toString(16).substr(2, 8)}`,
            username: this.config.username,
            password: this.config.password,
            reconnectPeriod: this.config.reconnectPeriod,
            connectTimeout: this.config.connectTimeout,
            keepalive: this.config.keepalive,
        };

        try {
            this.client = mqtt.connect(this.config.broker!, options);

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
                const mqttMessage: MqttMessage = {
                    topic,
                    message: message.toString(), // Chuyển Buffer thành string
                    qos: packet.qos,
                    retain: packet.retain,
                };
                this.emit("mqtt-message", { message: mqttMessage });
            });
        } catch (error) {
            this.node.error(`Failed to initialize MQTT client: ${error}`);
        }
    }

    // Subscribe topic
    public subscribe(topic: string, qos: 0 | 1 | 2 = this.config.qos): void {
        if (!this.client || !this.client.connected) {
            this.subscribedTopics.add(topic); // Lưu topic để resubscribe khi reconnect
            return;
        }
        this.client.subscribe(topic, { qos }, (err) => {
            if (err) {
                this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
            } else {
                this.subscribedTopics.add(topic);
                this.node.log(`Subscribed to topic: ${topic}`);
            }
        });
    }

    // Unsubscribe topic
    public unsubscribe(topic: string): void {
        if (!this.client || !this.client.connected) {
            this.subscribedTopics.delete(topic);
            return;
        }
        this.client.unsubscribe(topic, (err) => {
            if (err) {
                this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
            } else {
                this.subscribedTopics.delete(topic);
                this.node.log(`Unsubscribed from topic: ${topic}`);
            }
        });
    }

    // Publish message
    public publish(topic: string, message: string | Buffer, options?: IClientPublishOptions): void {
        if (!this.client || !this.client.connected) {
            this.node.warn(`Cannot publish to ${topic}: MQTT client not connected`);
            return;
        }
        const publishOptions = { qos: this.config.qos, ...options };
        this.client.publish(topic, message, publishOptions, (err) => {
            if (err) {
                this.node.error(`Failed to publish to ${topic}: ${err.message}`);
            } else {
                this.node.log(`Published to topic: ${topic}`);
            }
        });
    }

    // Resubscribe tất cả các topic khi reconnect
    private resubscribeTopics(): void {
        if (!this.client) return;
        for (const topic of this.subscribedTopics) {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                }
            });
        }
    }

    // Ngắt kết nối thủ công
    public disconnect(): void {
        if (this.client) {
            this.client.end(() => {
                this.node.log("MQTT client disconnected manually");
            });
        }
    }

    // Kiểm tra trạng thái kết nối
    public isConnected(): boolean {
        return this.client?.connected ?? false;
    }
}

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