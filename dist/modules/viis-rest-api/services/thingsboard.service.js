"use strict";
/**
 * @fileoverview ThingsBoard RPC Service
 * Handles ThingsBoard RPC message processing and MQTT integration
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThingsBoardService = void 0;
const typedi_1 = require("typedi");
const base_service_1 = require("./base.service");
const common_types_1 = require("../types/common.types");
const client_registry_1 = __importDefault(require("../../../core/client-registry"));
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const constants_1 = require("../constants");
const container_setup_1 = require("../container/container.setup");
const circuit_breaker_1 = require("../utils/circuit-breaker");
const thingsboard_types_1 = require("../types/thingsboard.types");
const demeter_mqtt_topics_1 = require("../../../core/demeter-mqtt-topics");
const schedule_activation_service_1 = require("./schedule-activation.service");
/**
 * ThingsBoard RPC service class
 * Handles RPC message processing, telemetry transformation, and MQTT publishing
 */
let ThingsBoardService = class ThingsBoardService extends base_service_1.BaseService {
    constructor(context, scheduleActivationService) {
        super(context, 'ThingsBoardService');
        this.mqttClient = null;
        this.mqttAvailable = false;
        this.scheduleActivationService = null;
        this.processingStats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalProcessingTime: 0,
            mqttPublishSuccesses: 0,
            mqttPublishFailures: 0
        };
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(this.node.context());
        this.scheduleActivationService = scheduleActivationService || null;
        // Initialize MQTT Circuit Breaker
        this.mqttCircuitBreaker = (0, circuit_breaker_1.createMqttCircuitBreaker)(this.node, {
            failureThreshold: 5,
            timeout: 60000, // 1 minute
            monitoringPeriod: 300000, // 5 minutes
            halfOpenMaxCalls: 3
        });
    }
    /**
     * Initialize the ThingsBoard service
     */
    async onInitialize() {
        this.logInfo("ThingsBoard RPC service initializing...");
        try {
            // Initialize MQTT client using existing core infrastructure
            await this.initializeMqttClient();
            this.mqttAvailable = true;
            this.logInfo("ThingsBoard RPC service initialized successfully with MQTT connectivity");
        }
        catch (error) {
            this.logError("Failed to initialize ThingsBoard service MQTT client", error);
            this.mqttAvailable = false;
            // Don't throw error to prevent Node-RED crash
            // Service will operate in degraded mode without MQTT
            this.logWarn("ThingsBoard service will operate in degraded mode without MQTT connectivity");
        }
    }
    /**
     * Cleanup resources
     */
    async onCleanup() {
        this.logInfo("ThingsBoard RPC service cleanup starting...");
        try {
            if (this.mqttClient) {
                client_registry_1.default.releaseClient('local', this.node);
                this.mqttClient = null;
            }
            this.logInfo("ThingsBoard RPC service cleanup completed");
        }
        catch (error) {
            this.logError("Error during ThingsBoard service cleanup", error);
        }
    }
    /**
     * Process ThingsBoard RPC request
     */
    async processRpcRequest(deviceId, rpcRequest, context) {
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
                    throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, `Invalid RPC request: ${validationResult.errors.join(', ')}`, 400, { errors: validationResult.errors });
                }
                // Transform telemetry data
                const transformationResult = await this.transformTelemetryData(rpcRequest.params || {}, context);
                // Publish to MQTT
                const mqttTopic = this.buildMqttTopic(deviceId, rpcRequest.method);
                const mqttPublished = await this.publishToMqtt(mqttTopic, transformationResult.records, context, rpcRequest);
                const processingTime = Date.now() - startTime;
                this.processingStats.totalProcessingTime += processingTime;
                this.processingStats.successfulRequests++;
                const result = {
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
            }
            catch (error) {
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
    validateRpcRequest(request) {
        const errors = [];
        const warnings = [];
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
    async transformTelemetryData(rawData, context) {
        const startTime = Date.now();
        const records = [];
        const errors = [];
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
                const record = {
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
            }
            catch (error) {
                const errorMsg = `Failed to process telemetry key '${key}': ${error.message}`;
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
    detectValueType(value) {
        let type;
        let processedValue;
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
        }
        else if (typeof value === 'string') {
            const lowerValue = value.toLowerCase().trim();
            if (lowerValue === 'true' || lowerValue === 'false') {
                type = 'boolean';
                processedValue = lowerValue === 'true';
                confidence = 0.9;
            }
            else {
                // Number detection for strings
                const numValue = Number(value);
                if (!isNaN(numValue) && isFinite(numValue) && value.trim() !== '') {
                    type = 'number';
                    processedValue = numValue;
                    confidence = 0.8;
                }
                else {
                    type = 'string';
                    processedValue = value;
                }
            }
        }
        else if (typeof value === 'number') {
            if (isNaN(value) || !isFinite(value)) {
                type = 'string';
                processedValue = String(value);
                confidence = 0.5;
            }
            else {
                type = 'number';
                processedValue = value;
            }
        }
        else if (typeof value === 'object') {
            type = 'object';
            processedValue = value;
        }
        else {
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
    buildMqttTopic(deviceId, method) {
        // Use ThingsBoard RPC request topic pattern
        return (0, demeter_mqtt_topics_1.buildDeviceRpcTopic)(deviceId);
    }
    /**
     * Publish telemetry data to MQTT broker with Circuit Breaker protection
     */
    async publishToMqtt(topic, records, context, rpcRequest) {
        try {
            if (!this.mqttAvailable || !this.mqttClient) {
                this.logWarn('MQTT client not available, skipping MQTT publish', {
                    topic,
                    deviceId: context.deviceId,
                    mqttAvailable: this.mqttAvailable
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
            const payloadString = JSON.stringify(payload);
            this.logDebug(`Publishing to MQTT`, {
                topic,
                recordsCount: records.length,
                payloadSize: payloadString.length
            });
            // Use Circuit Breaker to protect MQTT operations
            await this.mqttCircuitBreaker.execute(async () => {
                await this.publishWithRetry(topic, payloadString);
            }, `MQTT-Publish-${topic}`);
            this.processingStats.mqttPublishSuccesses++;
            this.logInfo(`Successfully published to MQTT`, {
                topic,
                recordsCount: records.length,
                deviceId: context.deviceId
            });
            return true;
        }
        catch (error) {
            this.processingStats.mqttPublishFailures++;
            if (error instanceof circuit_breaker_1.CircuitBreakerError) {
                this.logWarn(`MQTT publish blocked by circuit breaker`, {
                    topic,
                    recordsCount: records.length,
                    deviceId: context.deviceId,
                    circuitState: error.state
                });
                // Don't throw error for circuit breaker - return false to indicate failure
                return false;
            }
            this.logError(`Failed to publish to MQTT`, error, {
                topic,
                recordsCount: records.length,
                deviceId: context.deviceId
            });
            throw new common_types_1.ApiError(common_types_1.ErrorType.INTERNAL_ERROR, `MQTT publish failed: ${error.message}`, 500, { topic, deviceId: context.deviceId });
        }
    }
    /**
     * Build MQTT payload in original RPC request format
     * Preserves the original request structure instead of transforming to telemetry format
     */
    buildMqttPayload(records, context, rpcRequest) {
        const params = {};
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
    async publishWithRetry(topic, payload) {
        let lastError = null;
        for (let attempt = 0; attempt <= thingsboard_types_1.DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
            try {
                await this.mqttClient.publish(topic, payload, {
                    qos: thingsboard_types_1.DEFAULT_RPC_OPTIONS.qos,
                    retain: thingsboard_types_1.DEFAULT_RPC_OPTIONS.retain
                });
                return; // Success
            }
            catch (error) {
                lastError = error;
                if (attempt < thingsboard_types_1.DEFAULT_RETRY_CONFIG.maxRetries) {
                    const delay = Math.min(thingsboard_types_1.DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(thingsboard_types_1.DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt), thingsboard_types_1.DEFAULT_RETRY_CONFIG.maxRetryDelay);
                    this.logWarn(`MQTT publish attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
                        topic,
                        error: error.message
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                else {
                    this.logError(`All MQTT publish attempts failed`, error, { topic });
                }
            }
        }
        throw lastError || new Error('MQTT publish failed after all retries');
    }
    /**
     * Initialize MQTT client using local EMQX broker
     * Note: This method will not throw errors to allow service to continue in degraded mode
     */
    async initializeMqttClient() {
        try {
            const config = this.createLocalMqttConfig();
            // Use Circuit Breaker for MQTT client initialization
            this.mqttClient = await this.mqttCircuitBreaker.execute(async () => {
                return await client_registry_1.default.getLocalMqttClient(config, this.node);
            }, 'MQTT-Client-Init');
            this.logInfo(`MQTT client initialized successfully`, {
                broker: config.broker,
                clientId: config.clientId
            });
        }
        catch (error) {
            this.logError("Failed to initialize MQTT client", error);
            this.mqttClient = null;
            if (error instanceof circuit_breaker_1.CircuitBreakerError) {
                this.logWarn(`MQTT client initialization blocked by circuit breaker`, {
                    circuitState: error.state
                });
            }
            // Don't throw error - let service continue without MQTT in degraded mode
            // This allows the service to start even if MQTT broker is unavailable
            this.logWarn("Service will continue in degraded mode without MQTT connectivity");
        }
    }
    /**
     * Create local EMQX MQTT configuration
     */
    createLocalMqttConfig() {
        // Use local EMQX broker configuration
        const host = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_HOST, constants_1.MQTT_CONFIG.LOCAL.DEFAULT_HOST);
        const port = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PORT, constants_1.MQTT_CONFIG.LOCAL.DEFAULT_PORT);
        const username = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_USERNAME, '');
        const password = this.globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PASSWORD, '');
        return {
            broker: `mqtt://${host}:${port}`,
            clientId: `viis-thingsboard-service-${Math.random().toString(16).substring(2, 10)}`,
            username,
            password,
            qos: constants_1.MQTT_CONFIG.LOCAL.QOS,
            keepalive: constants_1.MQTT_CONFIG.LOCAL.KEEPALIVE,
            connectTimeout: constants_1.MQTT_CONFIG.LOCAL.CONNECT_TIMEOUT,
            reconnectPeriod: constants_1.MQTT_CONFIG.LOCAL.RECONNECT_PERIOD
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
        return Object.assign(Object.assign({}, this.processingStats), { averageProcessingTime: Math.round(avgProcessingTime), mqttPublishSuccessRate: Math.round(mqttSuccessRate * 100) / 100, lastProcessedAt: Date.now() });
    }
    /**
     * Process one-way RPC request from DTO with schedule activation
     */
    async processOneWayRpcFromDto(deviceId, rpcData, user) {
        const requestId = this.generateRequestId();
        console.log('user mother fucker', user);
        const userId = (user === null || user === void 0 ? void 0 : user.user_id) || (user === null || user === void 0 ? void 0 : user.name);
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
                const context = {
                    deviceId,
                    method: rpcData.method,
                    requestId,
                    startTime: Date.now()
                };
                // Convert DTO to internal request format
                const rpcRequest = {
                    method: rpcData.method,
                    params: rpcData.params || {},
                    timeout: rpcData.timeout || 30000,
                    persistent: rpcData.persistent || false,
                    retries: rpcData.retries || 3
                };
                // Process RPC request
                const executionResult = await this.processRpcRequest(deviceId, rpcRequest, context);
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
                const responseDto = {
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
            }
            catch (error) {
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
     * Get service health information including Circuit Breaker status
     */
    async getServiceHealthInfo() {
        return this.executeOperation('getServiceHealthInfo', async () => {
            this.logDebug('ThingsBoard service health check requested');
            try {
                const healthInfo = await this.healthCheck();
                const processingStats = this.getProcessingStats();
                const circuitBreakerStatus = this.mqttCircuitBreaker.getHealthStatus();
                this.logDebug('ThingsBoard service health check completed', {
                    status: healthInfo.status,
                    mqttAvailable: this.mqttAvailable,
                    circuitBreakerState: circuitBreakerStatus.state
                });
                return {
                    service: 'ThingsBoard RPC',
                    status: healthInfo.status,
                    timestamp: new Date().toISOString(),
                    details: Object.assign(Object.assign({}, healthInfo), { processingStats, mqtt: {
                            available: this.mqttAvailable,
                            clientConnected: !!this.mqttClient,
                            circuitBreaker: circuitBreakerStatus
                        } })
                };
            }
            catch (error) {
                this.logError('ThingsBoard service health check failed', error);
                throw error;
            }
        });
    }
    /**
     * Validate device ID format and constraints
     */
    validateDeviceId(deviceId) {
        if (!deviceId || typeof deviceId !== 'string') {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID is required and must be a string', 400);
        }
        if (deviceId.trim().length === 0) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID cannot be empty', 400);
        }
        if (deviceId.length > 100) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID cannot exceed 100 characters', 400);
        }
        // Validate device ID format (alphanumeric, hyphens, underscores)
        if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID must contain only letters, numbers, hyphens, and underscores', 400);
        }
    }
    /**
     * Process schedule activation logic if conditions are met
     */
    async processScheduleActivationIfNeeded(deviceId, rpcParams, user, requestId) {
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
            const userContext = {
                user_id: (user === null || user === void 0 ? void 0 : user.user_id) || (user === null || user === void 0 ? void 0 : user.name),
                customer_id: user === null || user === void 0 ? void 0 : user.customer_id,
                first_name: user === null || user === void 0 ? void 0 : user.first_name,
                last_name: user === null || user === void 0 ? void 0 : user.last_name,
                email: user === null || user === void 0 ? void 0 : user.email
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
            const activationParams = this.scheduleActivationService.extractScheduleActivationParams(deviceId, rpcParams, userContext);
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
        }
        catch (error) {
            // Log error but don't throw - schedule activation is additional functionality
            this.logError('Schedule activation processing failed', error, {
                deviceId,
                requestId,
                stack: error.stack
            });
        }
    }
    /**
     * Generate unique request ID for tracking
     */
    generateRequestId() {
        return `rpc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    /**
     * Health check for ThingsBoard service
     */
    async onHealthCheck() {
        var _a;
        const mqttConnected = ((_a = this.mqttClient) === null || _a === void 0 ? void 0 : _a.isConnected()) || false;
        const stats = this.getProcessingStats();
        return {
            mqttConnected,
            processingStats: stats,
            status: mqttConnected ? 'healthy' : 'degraded'
        };
    }
};
exports.ThingsBoardService = ThingsBoardService;
exports.ThingsBoardService = ThingsBoardService = __decorate([
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)(container_setup_1.SERVICE_CONTEXT_TOKEN)),
    __param(1, (0, typedi_1.Inject)()),
    __metadata("design:paramtypes", [Object, schedule_activation_service_1.ScheduleActivationService])
], ThingsBoardService);
