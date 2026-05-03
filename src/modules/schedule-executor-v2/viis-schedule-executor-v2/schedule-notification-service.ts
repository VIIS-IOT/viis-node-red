/**
 * Schedule Notification Service V2
 * Responsibility: Publish MQTT telemetry, audit logs, and config updates
 *
 * Extracted from V1's ScheduleService notification methods
 */

import { Node } from "node-red";
import { MqttClientCore } from "../../../core/mqtt-client";
import { ModbusCmd, TabiotSchedule, ConfigParameter } from "../common/types";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import { v4 as uuidv4 } from "uuid";

export class ScheduleNotificationService {
    private node: Node;
    private globalHelper: GlobalContextHelper;
    private debugEnable: boolean;
    private readonly PUBLISHED_VALUE_CACHE_KEY = "scheduleExecutorV2PublishedValueCache";

    constructor(node: Node, debugEnable: boolean = false) {
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new GlobalContextHelper(node.context());
    }

    private debugLog(message: string): void {
        if (this.debugEnable && this.node) {
            this.node.warn(message);
        }
    }

    // ==================== VALUE CACHE (dedup) ====================

    private getPublishedValueCache(): Record<string, string> {
        return this.node?.context().global.get(this.PUBLISHED_VALUE_CACHE_KEY) as Record<string, string> || {};
    }

    private setPublishedValueCache(cache: Record<string, string>): void {
        this.node?.context().global.set(this.PUBLISHED_VALUE_CACHE_KEY, cache);
    }

    private valueHash(value: any): string {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private hasPublishedValueChanged(cacheKey: string, value: any): boolean {
        const cache = this.getPublishedValueCache();
        return cache[cacheKey] !== this.valueHash(value);
    }

    private updatePublishedValueCache(entries: Record<string, any>): void {
        const cache = this.getPublishedValueCache();
        for (const [key, value] of Object.entries(entries)) {
            cache[key] = this.valueHash(value);
        }
        this.setPublishedValueCache(cache);
    }

    // ==================== MQTT HELPER ====================

    private getDeviceId(): string {
        return this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
    }

    private getThingsboardTopic(): string {
        return "v1/devices/me/telemetry";
    }

    private getEmqxTopic(): string {
        return `viis/things/v2/${this.getDeviceId()}/telemetry`;
    }

    /**
     * Publish payload to both ThingsBoard and EMQX
     * Returns true if at least one broker succeeded
     */
    private async publishToBoth(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        payload: Record<string, any>,
        label: string
    ): Promise<boolean> {
        const payloadString = JSON.stringify(payload);
        let anySuccess = false;

        // Publish to ThingsBoard
        try {
            await thingsboardClient.publish(this.getThingsboardTopic(), payloadString);
            this.debugLog(`Published ${label} to ThingsBoard`);
            anySuccess = true;
        } catch (error) {
            this.debugLog(`Failed to publish ${label} to ThingsBoard: ${(error as Error).message}`);
        }

        // Publish to EMQX
        try {
            await emqxClient.publish(this.getEmqxTopic(), payloadString);
            this.debugLog(`Published ${label} to EMQX`);
            anySuccess = true;
        } catch (error) {
            this.debugLog(`Failed to publish ${label} to EMQX: ${(error as Error).message}`);
        }

        return anySuccess;
    }

    // ==================== SCHEDULE TELEMETRY ====================

    /**
     * Publish schedule telemetry to MQTT (ThingsBoard + EMQX)
     * Publishes all written Modbus keys in one object
     */
    async publishScheduleTelemetry(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] },
        configKeyValues?: Record<string, any>
    ): Promise<void> {
        try {
            const changedValues: Record<string, any> = {};

            // Check Modbus commands for changes
            for (const cmd of [...commands.holdingCommands, ...commands.coilCommands]) {
                const cacheKey = `telemetry:${cmd.key}`;
                if (this.hasPublishedValueChanged(cacheKey, cmd.value)) {
                    changedValues[cmd.key] = cmd.value;
                }
            }

            // Check config values for changes
            if (configKeyValues && Object.keys(configKeyValues).length > 0) {
                for (const [key, value] of Object.entries(configKeyValues)) {
                    const cacheKey = `telemetry:${key}`;
                    if (this.hasPublishedValueChanged(cacheKey, value)) {
                        changedValues[key] = value;
                    }
                }
            }

            if (Object.keys(changedValues).length === 0) {
                this.debugLog(`Skipping unchanged telemetry for ${schedule.name} (${action})`);
                return;
            }

            // Build telemetry payload
            const telemetryData: Record<string, any> = {
                ts: Date.now(),
                _schedule_action: action,
                _schedule_id: schedule.name,
                _schedule_label: schedule.label,
                ...changedValues
            };

            // Deduplication: skip if same data published within 5 seconds
            const lastPublishedKey = `telemetryLastPublishedV2_${schedule.name}_${action}`;
            const lastPublished = this.node?.context().global.get(lastPublishedKey) as { hash: string; timestamp: number } | null;

            const hashData = { ...telemetryData };
            delete hashData.ts;
            const currentHash = JSON.stringify(hashData);

            const now = Date.now();
            if (lastPublished && lastPublished.hash === currentHash && (now - lastPublished.timestamp) < 5000) {
                this.debugLog(`Skipping duplicate telemetry for ${schedule.name} (${action})`);
                return;
            }

            await this.publishToBoth(thingsboardClient, emqxClient, telemetryData, `telemetry ${schedule.name}`);

            // Update tracking
            this.node?.context().global.set(lastPublishedKey, { hash: currentHash, timestamp: now });
            this.updatePublishedValueCache(
                Object.fromEntries(
                    Object.entries(changedValues).map(([key, value]) => [`telemetry:${key}`, value])
                )
            );

            const modbusKeyCount = commands.holdingCommands.length + commands.coilCommands.length;
            if (this.node) {
                this.node.warn(`📊 TELEMETRY: ${schedule.name} | ${action} | ${modbusKeyCount} Modbus + ${Object.keys(configKeyValues || {}).length} Config keys`);
            }
        } catch (error) {
            if (this.node) {
                this.node.warn(`❌ TELEMETRY ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
        }
    }

    // ==================== AUDIT LOG ====================

    /**
     * Publish audit log for schedule execution
     */
    async publishAuditLog(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] },
        success: boolean = true,
        errorMessage?: string
    ): Promise<void> {
        try {
            const requestId = uuidv4();
            const allCommands = [...commands.holdingCommands, ...commands.coilCommands];

            const actionText = action === 'start' ? 'bắt đầu' : 'kết thúc';
            const statusText = success ? 'thành công' : 'thất bại';
            const changedKeys = allCommands.map(cmd => `${cmd.key}=${cmd.value}`).join(', ');

            let message: string;
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText}: ${changedKeys || 'không có thay đổi'}`;
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText} ${statusText}: ${errorMessage || 'Lỗi không xác định'}`;
            }

            const logs = {
                from: "DEVICE_EXE_SCHEDULE",
                requestId: requestId,
                message: message,
                metadata: {
                    status: success ? "SUCCESS" : "FAIL",
                    schedule_id: schedule.name,
                    schedule_label: schedule.label,
                    action: action,
                    changed_keys: allCommands.map(cmd => ({
                        key: cmd.key,
                        value: cmd.value,
                        address: cmd.address,
                        fc: cmd.fc
                    })),
                    timestamp: Date.now(),
                    error: errorMessage || null
                }
            };

            await this.publishToBoth(thingsboardClient, emqxClient, { logs }, `audit log ${schedule.name}`);

            if (this.node) {
                this.node.warn(`📝 AUDIT LOG: ${schedule.name} | ${action} | ${allCommands.length} keys | ${success ? 'SUCCESS' : 'FAIL'}`);
            }
        } catch (error) {
            if (this.node) {
                this.node.warn(`❌ AUDIT LOG ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
        }
    }

    // ==================== CONFIG UPDATE ====================

    /**
     * Publish config parameter update via MQTT
     */
    async publishConfigUpdate(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        configParam: ConfigParameter
    ): Promise<void> {
        try {
            const cacheKey = `config:${configParam.key}`;
            if (!this.hasPublishedValueChanged(cacheKey, configParam.value)) {
                this.debugLog(`Skipping unchanged config: ${configParam.key}=${configParam.value}`);
                return;
            }

            const payload = {
                ts: configParam.timestamp,
                [configParam.key]: configParam.value,
                note: `Config parameter updated (no Modbus mapping) for schedule ${configParam.scheduleId}`,
                type: configParam.type,
                source: "schedule-executor-v2"
            };

            await this.publishToBoth(thingsboardClient, emqxClient, payload, `config ${configParam.key}`);
            this.updatePublishedValueCache({ [cacheKey]: configParam.value });
        } catch (error) {
            this.debugLog(`Failed to publish config ${configParam.key}: ${(error as Error).message}`);
        }
    }
}
