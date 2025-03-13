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
    private messageQueue: { topic: string; message: string | Buffer; options?: IClientPublishOptions }[] = [];
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

        this.client = mqtt.connect(this.config.broker!, options);

        this.client.on("connect", () => {
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
            this.emit("mqtt-status", { status: "connected" });
            this.resubscribeTopics();
            this.flushQueue(); // Publish queued messages on connect
        });

        this.client.on("close", () => {
            this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            this.emit("mqtt-status", { status: "disconnected" });
        });

        this.client.on("error", (error) => {
            this.node.error(`MQTT Error: ${error.message}`);
            this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
            this.emit("mqtt-status", { status: "error", error: error.message });
        });

        this.client.on("message", (topic, message, packet) => {
            const mqttMessage: MqttMessage = {
                topic,
                message: message.toString(),
                qos: packet.qos,
                retain: packet.retain,
            };
            this.emit("mqtt-message", { message: mqttMessage });
        });
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
            this.node.warn(`Cannot publish to ${topic}: MQTT client not connected, queuing message`);
            this.messageQueue.push({ topic, message, options });
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

    private flushQueue(): void {
        if (!this.client || !this.client.connected) return;

        while (this.messageQueue.length > 0) {
            const { topic, message, options } = this.messageQueue.shift()!;
            this.client.publish(topic, message, { qos: this.config.qos, ...options }, (err) => {
                if (err) {
                    this.node.error(`Failed to publish queued message to ${topic}: ${err.message}`);
                    this.messageQueue.unshift({ topic, message, options }); // Re-queue on failure
                } else {
                    this.node.log(`Published queued message to topic: ${topic}`);
                }
            });
        }
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