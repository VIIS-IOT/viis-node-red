import { Repository } from "typeorm";
import { MqttClientCore } from "../../../core/mqtt-client";
import { TabiotDeviceTelemetry } from "../../../orm/entities/device-telemetry/TabiotDeviceTelemetry";
import { TelemetryData, TelemetrySaveParams } from "../interfaces/types";
import { Logger } from "../utils/logger";
import { MQTT_TOPICS, VALUE_TYPES } from "../constants";
import { DatabaseService } from "./databaseService";

/**
 * Service for handling telemetry data publishing and storage
 */
export class TelemetryService {
    private logger: Logger;
    private databaseService: DatabaseService;
    private thingsboardMqttClient: MqttClientCore;
    private emqxMqttClient: MqttClientCore;
    private deviceId: string;
    private telemetryRepository?: Repository<TabiotDeviceTelemetry>;

    constructor(
        logger: Logger,
        databaseService: DatabaseService,
        thingsboardMqttClient: MqttClientCore,
        emqxMqttClient: MqttClientCore,
        deviceId: string
    ) {
        this.logger = logger;
        this.databaseService = databaseService;
        this.thingsboardMqttClient = thingsboardMqttClient;
        this.emqxMqttClient = emqxMqttClient;
        this.deviceId = deviceId;
    }

    /**
     * Initialize the telemetry service
     */
    async initialize(): Promise<void> {
        try {
            // Initialize database service
            await this.databaseService.initialize();

            // Get telemetry repository
            this.telemetryRepository = this.databaseService.getTelemetryRepository();
            this.logger.log("Telemetry service initialized successfully");
        } catch (error) {
            this.logger.errorWithStack("Failed to initialize telemetry service", error as Error);
            throw error;
        }
    }

    /**
     * Publish telemetry data to MQTT brokers
     */
    async publishTelemetry(data: TelemetryData): Promise<void> {
        try {
            const payload = JSON.stringify(data);
            const thingsboardTopic = MQTT_TOPICS.THINGSBOARD;
            const emqxTopic = MQTT_TOPICS.EMQX_PATTERN.replace("{deviceId}", this.deviceId);

            // Publish to Thingsboard
            if (this.thingsboardMqttClient && this.thingsboardMqttClient.isConnected()) {
                await this.thingsboardMqttClient.publish(thingsboardTopic, payload);
                this.logger.debug(`Published to Thingsboard: ${thingsboardTopic}`);
            } else {
                this.logger.warn("Thingsboard MQTT client not connected");
            }

            // Publish to EMQX
            if (this.emqxMqttClient && this.emqxMqttClient.isConnected()) {
                await this.emqxMqttClient.publish(emqxTopic, payload);
                this.logger.debug(`Published to EMQX: ${emqxTopic}`);
            } else {
                this.logger.warn("EMQX MQTT client not connected");
            }

            this.logger.logTelemetry(data, "Published");
        } catch (error) {
            this.logger.errorWithStack("Failed to publish telemetry", error as Error);
            throw error;
        }
    }

    /**
     * Save telemetry data to MySQL database
     */
    async saveTelemetryToDatabase(params: TelemetrySaveParams): Promise<void> {
        try {
            if (!this.telemetryRepository) {
                throw new Error("Telemetry repository not initialized");
            }

            const timestamp = params.timestamp || Date.now();
            const telemetryEntries: TabiotDeviceTelemetry[] = [];

            // Create telemetry entries for each key-value pair
            for (const [keyName, value] of Object.entries(params.data)) {
                const telemetryEntry = new TabiotDeviceTelemetry();
                telemetryEntry.device_id = params.deviceId;
                telemetryEntry.timestamp = timestamp;
                telemetryEntry.key_name = keyName;

                // Determine value type and set appropriate field
                this.setTelemetryValue(telemetryEntry, value);

                telemetryEntries.push(telemetryEntry);
            }

            // Save all entries in a batch
            if (telemetryEntries.length > 0) {
                await this.telemetryRepository.save(telemetryEntries);
                this.logger.debug(`Saved ${telemetryEntries.length} telemetry entries to database`);
                this.logger.logTelemetry(params.data, "Saved to database");
            }
        } catch (error) {
            this.logger.errorWithStack("Failed to save telemetry to database", error as Error);
            throw error;
        }
    }

    /**
     * Set the appropriate value field in telemetry entry based on value type
     */
    private setTelemetryValue(entry: TabiotDeviceTelemetry, value: any): void {
        if (typeof value === 'boolean') {
            entry.value_type = VALUE_TYPES.BOOLEAN;
            entry.boolean_value = value;
        } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                entry.value_type = VALUE_TYPES.INT;
                entry.int_value = value;
            } else {
                entry.value_type = VALUE_TYPES.FLOAT;
                entry.float_value = value;
            }
        } else if (typeof value === 'string') {
            entry.value_type = VALUE_TYPES.STRING;
            entry.string_value = value;
        } else {
            // For objects or other types, store as JSON
            entry.value_type = VALUE_TYPES.JSON;
            entry.json_value = value;
        }
    }

    /**
     * Process and handle telemetry data (publish + save)
     */
    async processTelemetryData(data: TelemetryData, timestamp?: number): Promise<void> {
        try {
            // Publish to MQTT brokers
            await this.publishTelemetry(data);

            // Save to database
            await this.saveTelemetryToDatabase({
                data,
                deviceId: this.deviceId,
                timestamp
            });

            this.logger.debug("Telemetry data processed successfully");
        } catch (error) {
            this.logger.errorWithStack("Failed to process telemetry data", error as Error);
            throw error;
        }
    }

    /**
     * Check if telemetry service is ready
     */
    isReady(): boolean {
        return !!(
            this.telemetryRepository &&
            this.thingsboardMqttClient &&
            this.emqxMqttClient &&
            this.databaseService.isInitialized()
        );
    }

    /**
     * Get connection status
     */
    async getConnectionStatus(): Promise<{ thingsboard: boolean; emqx: boolean; mysql: boolean }> {
        return {
            thingsboard: this.thingsboardMqttClient?.isConnected() || false,
            emqx: this.emqxMqttClient?.isConnected() || false,
            mysql: await this.databaseService.isHealthy()
        };
    }
}
