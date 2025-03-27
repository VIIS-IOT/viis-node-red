import { NodeAPI, Node } from "node-red";
import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from "mqtt";
import { EventEmitter } from "events";

export interface MqttConfig {
    broker?: string;
    clientId?: string;
    username?: string;
    password?: string;
    reconnectPeriod?: number;
    connectTimeout?: number;
    keepalive?: number;
    qos: 0 | 1 | 2;
}

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
    private connectionPromise: Promise<void> | null = null;
    private subscribedTopics: Set<string> = new Set();

    constructor(config: MqttConfig, node: Node) {
        super();
        this.config = {
            reconnectPeriod: 5000,
            connectTimeout: 30000,
            keepalive: 60,
            ...config,
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

        // Khai báo rõ ràng this.connectionPromise là Promise<void>
        this.connectionPromise = new Promise<void>((resolve, reject) => {
            this.client!.on("connect", () => {
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("mqtt-status", { status: "connected" });
                this.resubscribeTopics();
                resolve(); // Không trả về giá trị, chỉ resolve void
            });

            this.client!.on("error", (error) => {
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
            const mqttMessage: MqttMessage = {
                topic,
                message: message.toString(),
                qos: packet.qos,
                retain: packet.retain,
            };
            this.emit("mqtt-message", { message: mqttMessage });
        });
    }

    // Chờ kết nối trước khi sử dụng
    public async waitForConnection(timeoutMs: number = 30000): Promise<void> {
        if (this.client?.connected) return; // Đã kết nối thì return ngay
        if (!this.connectionPromise) throw new Error("Client not initialized");

        // Promise.race với kiểu rõ ràng là Promise<void>
        await Promise.race([
            this.connectionPromise,
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)),
        ]);
    }

    // Subscribe topic
    public async subscribe(topic: string, qos: 0 | 1 | 2 = this.config.qos): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.subscribe(topic, { qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    this.subscribedTopics.add(topic);
                    this.node.log(`Subscribed to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }

    // Unsubscribe topic
    public async unsubscribe(topic: string): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.unsubscribe(topic, (err) => {
                if (err) {
                    this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    this.subscribedTopics.delete(topic);
                    this.node.log(`Unsubscribed from topic: ${topic}`);
                    resolve();
                }
            });
        });
    }

    // Publish message, chỉ khi đã kết nối
    public async publish(topic: string, message: string | Buffer, options?: IClientPublishOptions): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            this.node.warn(`MQTT client not connected to ${this.config.broker}, waiting for connection...`);
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.publish(topic, message, { qos: this.config.qos, ...options }, (err) => {
                if (err) {
                    this.node.error(`Failed to publish to ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    this.node.log(`Published to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }



    // Resubscribe tất cả các topic khi reconnect
    private resubscribeTopics(): void {
        if (!this.client) return;
        for (const topic of this.subscribedTopics) {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                } else {
                    this.node.log(`Resubscribed to topic: ${topic}`);
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