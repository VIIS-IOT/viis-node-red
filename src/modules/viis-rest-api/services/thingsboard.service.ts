/**
 * @fileoverview ThingsBoard RPC Service
 * Handles ThingsBoard RPC message processing and MQTT integration
 */

import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { BaseService, ServiceContext } from './base.service';
import { ApiError, ErrorType } from '../types/common.types';
import { MqttClientCore, MqttConfig } from '../../../core/mqtt-client';
import ClientRegistry from '../../../core/client-registry';
import { DatabaseService } from './database.service';
import { ApiConfigManager } from '../config/api.config';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';
import { ENV_KEYS, MQTT_CONFIG, DEFAULTS } from '../constants';
import { SERVICE_CONTEXT_TOKEN } from '../container/container.setup';
import {
    ThingsBoardRpcRequest,
    ThingsBoardRpcResponse,
    ProcessedTelemetryRecord,
    TelemetryTransformationResult,
    RpcExecutionResult,
    RpcProcessingContext,
    TypeDetectionResult,
    THINGSBOARD_TOPICS,
    DEFAULT_RPC_OPTIONS,
    DEFAULT_RETRY_CONFIG,
    ThingsBoardConfig,
    RpcValidationResult
} from '../types/thingsboard.types';
import { ThingsBoardRpcRequestDto, RpcExecutionResultDto } from '../dto/thingsboard.dto';
import { ScheduleActivationService, UserContext } from './schedule-activation.service';

/**
 * ThingsBoard RPC service class
 * Handles RPC message processing, telemetry transformation, and MQTT publishing
 */
@Service()
export class ThingsBoardService extends BaseService {
    private mqttClient: MqttClientCore | null = null;
    private globalHelper: GlobalContextHelper;
    private scheduleActivationService: ScheduleActivationService | null = null;
    private processingStats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalProcessingTime: 0,
        mqttPublishSuccesses: 0,
        mqttPublishFailures: 0
    };

    constructor(
        @Inject(SERVICE_CONTEXT_TOKEN) context: ServiceContext,
        @Inject() scheduleActivationService?: ScheduleActivationService
    ) {
        super(context, 'ThingsBoardService');
        this.globalHelper = new GlobalContextHelper(this.node.context());
        this.scheduleActivationService = scheduleActivationService || null;
    }

    /**
     * Initialize the ThingsBoard service
     */
    protected async onInitialize(): Promise<void> {
        this.logInfo("ThingsBoard RPC service initializing...");

        try {
            // Initialize MQTT client using existing core infrastructure
            await this.initializeMqttClient();
            this.logInfo("ThingsBoard RPC service initialized successfully");
        } catch (error) {
            this.logError("Failed to initialize ThingsBoard service", error);
            // Don't throw error to prevent Node-RED crash
            // Service will operate in degraded mode without MQTT
            this.logWarn("ThingsBoard service will operate in degraded mode without MQTT connectivity");
        }
    }

    /**
     * Cleanup resources
     */
    protected async onCleanup(): Promise<void> {
        this.logInfo("ThingsBoard RPC service cleanup starting...");

        try {
            if (this.mqttClient) {
                ClientRegistry.releaseClient('local', this.node);
                this.mqttClient = null;
            }
            this.logInfo("ThingsBoard RPC service cleanup completed");
        } catch (error) {
            this.logError("Error during ThingsBoard service cleanup", error);
        }
    }

    /**
     * Process ThingsBoard RPC request
     */
    async processRpcRequest(
        deviceId: string,
        rpcRequest: ThingsBoardRpcRequest,
        context: RpcProcessingContext
    ): Promise<RpcExecutionResult> {
        return this.executeOperation('processRpcRequest', async () => {
            const startTime = Date.now();
            this.processingStats.totalRequests++;

            this.logInfo(`Processing RPC request for device ${deviceId}`, {
                method: rpcRequest.method,
                requestId: context.requestId,
                deviceId
            });

            try {
                // Validate RPC request
                const validationResult = this.validateRpcRequest(rpcRequest);
                if (!validationResult.isValid) {
                    throw new ApiError(
                        ErrorType.VALIDATION_ERROR,
                        `Invalid RPC request: ${validationResult.errors.join(', ')}`,
                        400,
                        { errors: validationResult.errors }
                    );
                }

                // Transform telemetry data
                const transformationResult = await this.transformTelemetryData(
                    rpcRequest.params || {},
                    context
                );

                // Publish to MQTT
                const mqttTopic = this.buildMqttTopic(deviceId, rpcRequest.method);
                const mqttPublished = await this.publishToMqtt(
                    mqttTopic,
                    transformationResult.records,
                    context,
                    rpcRequest
                );

                const processingTime = Date.now() - startTime;
                this.processingStats.totalProcessingTime += processingTime;
                this.processingStats.successfulRequests++;

                const result: RpcExecutionResult = {
                    success: true,
                    deviceId,
                    method: rpcRequest.method,
                    telemetryRecords: transformationResult.records,
                    mqttPublished,
                    mqttTopic,
                    processingTime,
                    errors: transformationResult.errors,
                    warnings: []
                };

                this.logInfo(`RPC request processed successfully`, {
                    deviceId,
                    method: rpcRequest.method,
                    processingTime,
                    recordsCount: transformationResult.records.length
                });

                return result;

            } catch (error) {
                this.processingStats.failedRequests++;
                this.logError(`RPC request processing failed`, error, {
                    deviceId,
                    method: rpcRequest.method,
                    requestId: context.requestId
                });
                throw error;
            }
        }, { deviceId, method: rpcRequest.method });
    }

    /**
     * Validate RPC request structure and content
     */
    private validateRpcRequest(request: ThingsBoardRpcRequest): RpcValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate method
        if (!request.method || typeof request.method !== 'string') {
            errors.push('Method is required and must be a string');
        }

        // Validate method name format
        if (request.method && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(request.method)) {
            errors.push('Method name must start with a letter and contain only letters, numbers, and underscores');
        }

        // Validate timeout
        if (request.timeout !== undefined) {
            if (typeof request.timeout !== 'number' || request.timeout < 1000 || request.timeout > 300000) {
                errors.push('Timeout must be a number between 1000 and 300000 milliseconds');
            }
        }

        // Validate retries
        if (request.retries !== undefined) {
            if (typeof request.retries !== 'number' || request.retries < 0 || request.retries > 10) {
                errors.push('Retries must be a number between 0 and 10');
            }
        }

        // Validate params if present
        if (request.params !== undefined && typeof request.params !== 'object') {
            errors.push('Params must be an object');
        }

        // Check for empty params
        if (request.params && Object.keys(request.params).length === 0) {
            warnings.push('Params object is empty');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            sanitizedPayload: errors.length === 0 ? request : undefined
        };
    }

    /**
     * Transform raw telemetry data with type detection
     */
    private async transformTelemetryData(
        rawData: Record<string, any>,
        context: RpcProcessingContext
    ): Promise<TelemetryTransformationResult> {
        const startTime = Date.now();
        const records: ProcessedTelemetryRecord[] = [];
        const errors: string[] = [];

        this.logDebug(`Transforming telemetry data`, {
            keysCount: Object.keys(rawData).length,
            deviceId: context.deviceId
        });

        for (const [key, value] of Object.entries(rawData)) {
            try {
                // Validate key format
                if (!key || typeof key !== 'string' || key.trim().length === 0) {
                    errors.push(`Invalid telemetry key: ${key}`);
                    continue;
                }

                // Detect and process value type
                const typeDetection = this.detectValueType(value);

                const record: ProcessedTelemetryRecord = {
                    key: key.trim(),
                    value: typeDetection.processedValue,
                    type: typeDetection.type,
                    timestamp: Date.now()
                };

                records.push(record);

                this.logDebug(`Processed telemetry record`, {
                    key: record.key,
                    type: record.type,
                    originalValue: value,
                    processedValue: record.value
                });

            } catch (error) {
                const errorMsg = `Failed to process telemetry key '${key}': ${(error as Error).message}`;
                errors.push(errorMsg);
                this.logWarn(errorMsg, { key, value, deviceId: context.deviceId });
            }
        }

        const transformationTime = Date.now() - startTime;

        return {
            records,
            totalRecords: records.length,
            transformationTime,
            errors
        };
    }

    /**
     * Detect and convert value type
     */
    private detectValueType(value: any): TypeDetectionResult {
        let type: 'string' | 'number' | 'boolean' | 'object';
        let processedValue: any;
        let confidence = 1.0;

        if (value === null || value === undefined) {
            return {
                type: 'string',
                confidence: 0.5,
                originalValue: value,
                processedValue: String(value)
            };
        }

        // Boolean detection
        if (typeof value === 'boolean') {
            type = 'boolean';
            processedValue = value;
        } else if (typeof value === 'string') {
            const lowerValue = value.toLowerCase().trim();
            if (lowerValue === 'true' || lowerValue === 'false') {
                type = 'boolean';
                processedValue = lowerValue === 'true';
                confidence = 0.9;
            } else {
                // Number detection for strings
                const numValue = Number(value);
                if (!isNaN(numValue) && isFinite(numValue) && value.trim() !== '') {
                    type = 'number';
                    processedValue = numValue;
                    confidence = 0.8;
                } else {
                    type = 'string';
                    processedValue = value;
                }
            }
        } else if (typeof value === 'number') {
            if (isNaN(value) || !isFinite(value)) {
                type = 'string';
                processedValue = String(value);
                confidence = 0.5;
            } else {
                type = 'number';
                processedValue = value;
            }
        } else if (typeof value === 'object') {
            type = 'object';
            processedValue = value;
        } else {
            type = 'string';
            processedValue = String(value);
            confidence = 0.7;
        }

        return {
            type,
            confidence,
            originalValue: value,
            processedValue
        };
    }

    /**
     * Build MQTT topic for device and method
     */
    private buildMqttTopic(deviceId: string, method: string): string {
        // Use ThingsBoard RPC request topic pattern
        return `${THINGSBOARD_TOPICS.RPC_REQUEST}/${deviceId}`;
    }

    /**
     * Publish telemetry data to MQTT broker
     */
    private async publishToMqtt(
        topic: string,
        records: ProcessedTelemetryRecord[],
        context: RpcProcessingContext,
        rpcRequest: ThingsBoardRpcRequest
    ): Promise<boolean> {
        try {
            if (!this.mqttClient) {
                this.logWarn('MQTT client not available, skipping MQTT publish', {
                    topic,
                    deviceId: context.deviceId
                });
                return false;
            }

            if (!this.mqttClient.isConnected()) {
                this.logWarn('MQTT client not connected, skipping MQTT publish', {
                    topic,
                    deviceId: context.deviceId
                });
                return false;
            }

            // Prepare payload in original RPC request format
            const payload = this.buildMqttPayload(records, context, rpcRequest);

            this.logDebug(`Publishing to MQTT`, {
                topic,
                recordsCount: records.length,
                payloadSize: JSON.stringify(payload).length
            });

            // Publish with retry logic
            await this.publishWithRetry(topic, JSON.stringify(payload));

            this.processingStats.mqttPublishSuccesses++;
            this.logInfo(`Successfully published to MQTT`, {
                topic,
                recordsCount: records.length,
                deviceId: context.deviceId
            });

            return true;

        } catch (error) {
            this.processingStats.mqttPublishFailures++;
            this.logError(`Failed to publish to MQTT`, error, {
                topic,
                recordsCount: records.length,
                deviceId: context.deviceId
            });

            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                `MQTT publish failed: ${(error as Error).message}`,
                500,
                { topic, deviceId: context.deviceId }
            );
        }
    }

    /**
     * Build MQTT payload in original RPC request format
     * Preserves the original request structure instead of transforming to telemetry format
     */
    private buildMqttPayload(
        records: ProcessedTelemetryRecord[],
        context: RpcProcessingContext,
        rpcRequest: ThingsBoardRpcRequest
    ): any {
        const params: Record<string, any> = {};

        records.forEach(record => {
            params[record.key] = record.value;
        });

        return {
            method: context.method,
            params: params,
            timeout: rpcRequest.timeout || 5000
        };
    }

    /**
     * Publish with retry logic
     */
    private async publishWithRetry(topic: string, payload: string): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
            try {
                await this.mqttClient!.publish(topic, payload, {
                    qos: DEFAULT_RPC_OPTIONS.qos,
                    retain: DEFAULT_RPC_OPTIONS.retain
                });
                return; // Success
            } catch (error) {
                lastError = error as Error;

                if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
                    const delay = Math.min(
                        DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt),
                        DEFAULT_RETRY_CONFIG.maxRetryDelay
                    );

                    this.logWarn(`MQTT publish attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
                        topic,
                        error: error.message
                    });

                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    this.logError(`All MQTT publish attempts failed`, error, { topic });
                }
            }
        }

        throw lastError || new Error('MQTT publish failed after all retries');
    }

    /**
     * Initialize MQTT client using local EMQX broker
     */
    private async initializeMqttClient(): Promise<void> {
        try {
            const config = this.createLocalMqttConfig();
            this.mqttClient = await ClientRegistry.getLocalMqttClient(config, this.node);

            this.logInfo(`MQTT client initialized successfully ${JSON.stringify(config)}`);
        } catch (error) {
            this.logError("Failed to initialize MQTT client", error);
            this.mqttClient = null;
            // Don't throw error - let service continue without MQTT
            throw error;
        }
    }

    /**
     * Create local EMQX MQTT configuration
     */
    private createLocalMqttConfig(): MqttConfig {
        // Use local EMQX broker configuration
        const host = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_HOST, MQTT_CONFIG.LOCAL.DEFAULT_HOST);
        const port = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_PORT, MQTT_CONFIG.LOCAL.DEFAULT_PORT);
        const username = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_USERNAME, '');
        const password = this.globalHelper.getEnvVar(ENV_KEYS.EMQX_PASSWORD, '');

        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `viis-thingsboard-service-${Math.random().toString(16).substring(2, 10)}`,
            username,
            password,
            qos: MQTT_CONFIG.LOCAL.QOS,
            keepalive: MQTT_CONFIG.LOCAL.KEEPALIVE,
            connectTimeout: MQTT_CONFIG.LOCAL.CONNECT_TIMEOUT,
            reconnectPeriod: MQTT_CONFIG.LOCAL.RECONNECT_PERIOD
        };
    }

    /**
     * Get service processing statistics
     */
    getProcessingStats() {
        const avgProcessingTime = this.processingStats.totalRequests > 0
            ? this.processingStats.totalProcessingTime / this.processingStats.totalRequests
            : 0;

        const mqttSuccessRate = (this.processingStats.mqttPublishSuccesses + this.processingStats.mqttPublishFailures) > 0
            ? this.processingStats.mqttPublishSuccesses / (this.processingStats.mqttPublishSuccesses + this.processingStats.mqttPublishFailures)
            : 0;

        return {
            ...this.processingStats,
            averageProcessingTime: Math.round(avgProcessingTime),
            mqttPublishSuccessRate: Math.round(mqttSuccessRate * 100) / 100,
            lastProcessedAt: Date.now()
        };
    }

    /**
     * Process one-way RPC request from DTO with schedule activation
     */
    async processOneWayRpcFromDto(
        deviceId: string,
        rpcData: ThingsBoardRpcRequestDto,
        user?: any
    ): Promise<RpcExecutionResultDto> {
        const requestId = this.generateRequestId();
        const userId = user?.user_id || user?.name;

        return this.executeOperation('processOneWayRpcFromDto', async () => {

            this.logInfo(`Processing one-way RPC request for device: ${deviceId}`, {
                method: rpcData.method,
                requestId,
                deviceId,
                hasParams: !!rpcData.params,
                userId
            });

            try {
                // Validate device ID
                this.validateDeviceId(deviceId);

                // Create processing context
                const context: RpcProcessingContext = {
                    deviceId,
                    method: rpcData.method,
                    requestId,
                    startTime: Date.now()
                };

                // Convert DTO to internal request format
                const rpcRequest: ThingsBoardRpcRequest = {
                    method: rpcData.method,
                    params: rpcData.params || {},
                    timeout: rpcData.timeout || 30000,
                    persistent: rpcData.persistent || false,
                    retries: rpcData.retries || 3
                };

                // Process RPC request
                const executionResult: RpcExecutionResult = await this.processRpcRequest(
                    deviceId,
                    rpcRequest,
                    context
                );

                // Process schedule activation if conditions are met
                await this.processScheduleActivationIfNeeded(deviceId, rpcData.params || {}, user, requestId);

                this.logInfo(`One-way RPC processed successfully for device: ${deviceId}`, {
                    method: rpcData.method,
                    requestId,
                    processingTime: executionResult.processingTime,
                    recordsCount: executionResult.telemetryRecords.length,
                    mqttPublished: executionResult.mqttPublished,
                    userId
                });

                // Convert to response DTO
                const responseDto: RpcExecutionResultDto = {
                    success: executionResult.success,
                    deviceId: executionResult.deviceId,
                    method: executionResult.method,
                    telemetryRecordsCount: executionResult.telemetryRecords.length,
                    mqttPublished: executionResult.mqttPublished,
                    mqttTopic: executionResult.mqttTopic,
                    processingTime: executionResult.processingTime,
                    errors: executionResult.errors.length > 0 ? executionResult.errors : undefined,
                    warnings: executionResult.warnings.length > 0 ? executionResult.warnings : undefined,
                    requestId
                };

                return responseDto;

            } catch (error) {
                this.logError(`One-way RPC failed for device: ${deviceId}`, error, {
                    method: rpcData.method,
                    requestId,
                    deviceId,
                    userId
                });
                throw error;
            }
        }, { deviceId, method: rpcData.method, userId });
    }

    /**
     * Get service health information
     */
    async getServiceHealthInfo(): Promise<any> {
        return this.executeOperation('getServiceHealthInfo', async () => {
            this.logDebug('ThingsBoard service health check requested');

            try {
                const healthInfo = await this.healthCheck();
                const processingStats = this.getProcessingStats();

                this.logDebug('ThingsBoard service health check completed', {
                    status: healthInfo.status
                });

                return {
                    service: 'ThingsBoard RPC',
                    status: healthInfo.status,
                    timestamp: new Date().toISOString(),
                    details: {
                        ...healthInfo,
                        processingStats
                    }
                };

            } catch (error) {
                this.logError('ThingsBoard service health check failed', error);
                throw error;
            }
        });
    }

    /**
     * Validate device ID format and constraints
     */
    validateDeviceId(deviceId: string): void {
        if (!deviceId || typeof deviceId !== 'string') {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Device ID is required and must be a string',
                400
            );
        }

        if (deviceId.trim().length === 0) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Device ID cannot be empty',
                400
            );
        }

        if (deviceId.length > 100) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Device ID cannot exceed 100 characters',
                400
            );
        }

        // Validate device ID format (alphanumeric, hyphens, underscores)
        if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Device ID must contain only letters, numbers, hyphens, and underscores',
                400
            );
        }
    }

    /**
     * Process schedule activation logic if conditions are met
     */
    private async processScheduleActivationIfNeeded(
        deviceId: string,
        rpcParams: Record<string, any>,
        user: any,
        requestId: string
    ): Promise<void> {
        try {
            if (!this.scheduleActivationService) {
                this.logDebug('Schedule activation service not available, skipping schedule activation');
                return;
            }

            this.logInfo('Checking schedule activation conditions', {
                deviceId,
                requestId,
                hasCoilAutoTron: rpcParams.COIL_AUTO_TRON,
                hasScheduleId: !!rpcParams.schedule_id
            });

            // Check if schedule activation conditions are met
            if (!this.scheduleActivationService.isScheduleActivationTrigger(rpcParams)) {
                this.logInfo('Schedule activation conditions not met', {
                    deviceId,
                    requestId,
                    hasCoilAutoTron: rpcParams.COIL_AUTO_TRON,
                    hasScheduleId: !!rpcParams.schedule_id
                });
                return;
            }

            // Validate user context
            const userContext: UserContext = {
                user_id: user?.user_id || user?.name,
                customer_id: user?.customer_id,
                first_name: user?.first_name,
                last_name: user?.last_name,
                email: user?.email
            };

            if (!this.scheduleActivationService.validateUserContext(userContext)) {
                this.logWarn('Invalid user context for schedule activation', {
                    deviceId,
                    requestId,
                    userId: userContext.user_id
                });
                return;
            }

            // Extract schedule activation parameters
            const activationParams = this.scheduleActivationService.extractScheduleActivationParams(
                deviceId,
                rpcParams,
                userContext
            );

            if (!activationParams) {
                this.logWarn('Failed to extract schedule activation parameters', {
                    deviceId,
                    requestId
                });
                return;
            }

            this.logInfo('Processing schedule activation', {
                deviceId,
                scheduleId: activationParams.scheduleId,
                userId: userContext.user_id,
                requestId
            });

            // Process schedule activation
            const activationResult = await this.scheduleActivationService.processScheduleActivation(activationParams);

            this.logInfo('Schedule activation processing completed', {
                deviceId,
                scheduleId: activationParams.scheduleId,
                scheduleLogCreated: activationResult.scheduleLogCreated,
                notificationCreated: activationResult.notificationCreated,
                mqttPublished: activationResult.mqttPublished,
                errors: activationResult.errors,
                requestId
            });

        } catch (error) {
            // Log error but don't throw - schedule activation is additional functionality
            this.logError('Schedule activation processing failed', error, {
                deviceId,
                requestId,
                stack: (error as Error).stack
            });
        }
    }

    /**
     * Generate unique request ID for tracking
     */
    generateRequestId(): string {
        return `rpc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Health check for ThingsBoard service
     */
    protected async onHealthCheck(): Promise<any> {
        const mqttConnected = this.mqttClient?.isConnected() || false;
        const stats = this.getProcessingStats();

        return {
            mqttConnected,
            processingStats: stats,
            status: mqttConnected ? 'healthy' : 'degraded'
        };
    }
}
