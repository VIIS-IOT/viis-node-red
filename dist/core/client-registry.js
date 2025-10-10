"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("./modbus-client");
const mqtt_client_1 = require("./mqtt-client");
const mysql_client_1 = require("./mysql-client");
const mqtt_recovery_manager_1 = require("./mqtt-recovery-manager");
class ClientRegistry {
    // Start automatic recovery mechanism
    static startRecoveryMechanism() {
        if (this.recoveryTimer)
            return; // Already running
        this.recoveryTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.RECOVERY_INTERVAL);
    }
    // Stop recovery mechanism
    static stopRecoveryMechanism() {
        if (this.recoveryTimer) {
            clearInterval(this.recoveryTimer);
            this.recoveryTimer = null;
        }
    }
    // Perform health check and recovery
    static performHealthCheck() {
        // Check ThingsBoard MQTT connection
        if (this.thingsboardMqttInstance && this.referenceCount.thingsboard > 0) {
            if (!this.thingsboardMqttInstance.isConnected()) {
                console.warn("[RECOVERY] ThingsBoard MQTT client disconnected, attempting recovery");
                try {
                    this.thingsboardMqttInstance.resetCircuitBreaker();
                    // Trigger immediate recovery through manager if available
                    if (this.recoveryManager) {
                        this.recoveryManager.forceImmediateRecovery();
                    }
                }
                catch (error) {
                    console.error("[RECOVERY] Failed to reset ThingsBoard circuit breaker:", error);
                }
            }
        }
        // Check Local MQTT connection
        if (this.localMqttInstance && this.referenceCount.local > 0) {
            if (!this.localMqttInstance.isConnected()) {
                console.warn("[RECOVERY] Local MQTT client disconnected, attempting recovery");
                try {
                    this.localMqttInstance.resetCircuitBreaker();
                    // Trigger immediate recovery through manager if available
                    if (this.recoveryManager) {
                        this.recoveryManager.forceImmediateRecovery();
                    }
                }
                catch (error) {
                    console.error("[RECOVERY] Failed to reset Local circuit breaker:", error);
                }
            }
        }
    }
    static async getThingsboardMqttClient(config, node) {
        const maxWaitTime = 30000; // 30 seconds max wait
        const startTime = Date.now();
        // Wait if another node is already initializing, but with timeout
        while (this.initializingFlags.thingsboard) {
            if (Date.now() - startTime > maxWaitTime) {
                node.error("[THINGSBOARD-INIT] Timeout waiting for other node initialization, forcing reset");
                this.initializingFlags.thingsboard = false;
                this.thingsboardMqttInstance = null;
                break;
            }
            // node.warn("[THINGSBOARD-INIT] Another node is initializing ThingsBoard client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!this.thingsboardMqttInstance) {
            this.initializingFlags.thingsboard = true;
            // node.warn(`[THINGSBOARD-INIT] Node ${node.id} starting ThingsBoard MQTT client initialization`);
            try {
                this.thingsboardMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                // node.warn("Created new Thingsboard MqttClientCore instance");
                await this.thingsboardMqttInstance.waitForConnection();
                this.activeConnections.thingsboardMqtt++;
                // node.warn("Thingsboard MQTT client connected successfully");
                this.logActiveConnections(node);
            }
            catch (error) {
                this.thingsboardMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Thingsboard MQTT client: ${error.message}`);
                // Add recovery mechanism - try to reset circuit breaker if it exists
                if (this.thingsboardMqttInstance && typeof this.thingsboardMqttInstance.resetCircuitBreaker === 'function') {
                    // node.warn("Attempting to reset circuit breaker for recovery");
                    this.thingsboardMqttInstance.resetCircuitBreaker();
                }
                throw error;
            }
            finally {
                this.initializingFlags.thingsboard = false;
            }
        }
        // Verify the instance is actually connected before returning
        if (!this.thingsboardMqttInstance.isConnected()) {
            // node.warn("ThingsBoard MQTT instance exists but not connected, attempting recovery");
            try {
                await this.thingsboardMqttInstance.waitForConnection(10000); // 10 second timeout
            }
            catch (error) {
                // node.warn(`Recovery attempt failed: ${(error as Error).message}`);
                // Don't throw here, let the node try to use the instance and handle errors
            }
        }
        this.referenceCount.thingsboard++;
        this.clientUsers.thingsboard.add(node.id);
        // node.warn(`[THINGSBOARD-INIT] Node ${node.id} got ThingsBoard client, ref count: ${this.referenceCount.thingsboard}`);
        // node.warn(`[THINGSBOARD-INIT] Active users: ${Array.from(this.clientUsers.thingsboard).join(', ')}`);
        // Start recovery mechanism if this is the first client
        if (this.referenceCount.thingsboard === 1) {
            this.startRecoveryMechanism();
        }
        return this.thingsboardMqttInstance;
    }
    static async getLocalMqttClient(config, node) {
        // Wait if another node is already initializing
        while (this.initializingFlags.local) {
            // node.warn("[LOCAL-INIT] Another node is initializing Local MQTT client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!this.localMqttInstance) {
            this.initializingFlags.local = true;
            // node.warn(`[LOCAL-INIT] Node ${node.id} starting Local MQTT client initialization`);
            try {
                this.localMqttInstance = new mqtt_client_1.MqttClientCore(config, node);
                // node.warn("Created new Local MqttClientCore instance");
                // Initialize recovery manager if not exists
                if (!this.recoveryManager) {
                    this.recoveryManager = mqtt_recovery_manager_1.MqttRecoveryManager.getInstance({
                        aggressiveMode: true,
                        quickRecoveryInterval: 2000,
                        normalRecoveryInterval: 10000,
                        maxQuickRecoveryAttempts: 10,
                        networkCheckInterval: 5000,
                        powerOutageDetection: true
                    });
                }
                // Register with recovery manager for enhanced recovery
                this.recoveryManager.registerClient('local-mqtt', this.localMqttInstance, node);
                await this.localMqttInstance.waitForConnection();
                this.activeConnections.localMqtt++;
                // node.warn("Local MQTT client connected successfully");
                this.logActiveConnections(node);
            }
            catch (error) {
                this.localMqttInstance = null; // Reset on failure
                node.error(`Failed to connect Local MQTT client: ${error.message}`);
                throw error;
            }
            finally {
                this.initializingFlags.local = false;
            }
        }
        this.referenceCount.local++;
        this.clientUsers.local.add(node.id);
        // node.warn(`[LOCAL-INIT] Node ${node.id} got Local MQTT client, ref count: ${this.referenceCount.local}`);
        // node.warn(`[LOCAL-INIT] Active users: ${Array.from(this.clientUsers.local).join(', ')}`);
        return this.localMqttInstance;
    }
    /**
     * Validate if the provided config matches the existing shared config
     * This ensures only ONE modbus connection is used across all nodes
     */
    static validateModbusConfig(config, node) {
        if (!this.modbusConfig) {
            return true; // No existing config, any config is valid
        }
        const configMatches = (this.modbusConfig.type === config.type &&
            this.modbusConfig.host === config.host &&
            this.modbusConfig.tcpPort === config.tcpPort &&
            this.modbusConfig.serialPort === config.serialPort &&
            this.modbusConfig.baudRate === config.baudRate &&
            this.modbusConfig.parity === config.parity &&
            this.modbusConfig.unitId === config.unitId);
        if (!configMatches) {
            // node.warn(`[MODBUS-SINGLE-CONNECTION-ENFORCED] Node ${node.id} config differs from shared config:`);
            // node.warn(`  Existing shared config: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            // node.warn(`  Requested config: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
            // node.warn(`  ENFORCING SINGLE CONNECTION: Using existing shared connection to prevent multiple modbus connections.`);
            // node.warn(`  All VIIS nodes MUST use the same modbus connection for proper resource management.`);
        }
        return configMatches;
    }
    static getModbusClient(config, node) {
        // Wait if another node is already initializing
        while (this.initializingFlags.modbus) {
            // node.warn("[MODBUS-SINGLE-CONNECTION] Another node is initializing Modbus client, waiting...");
            // Use synchronous wait to avoid async issues in this method
            const start = Date.now();
            while (Date.now() - start < 100) { /* busy wait */ }
        }
        // Validate config compatibility - ENFORCES SINGLE CONNECTION
        this.validateModbusConfig(config, node);
        if (!this.modbusInstance || !this.modbusInstance.isConnectedCheck()) {
            this.initializingFlags.modbus = true;
            // node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} creating THE ONLY modbus connection for all VIIS nodes`);
            try {
                if (this.modbusInstance) {
                    this.modbusInstance.disconnect();
                    this.activeConnections.modbus--;
                    node.log("Previous Modbus instance disconnected due to invalid state");
                }
                // Store the config from the first node that creates the connection
                if (!this.modbusConfig) {
                    this.modbusConfig = Object.assign({}, config);
                    // node.warn(`[MODBUS-SINGLE-CONNECTION] Storing shared config for ALL nodes: ${config.type} ${config.host}:${config.tcpPort} unit=${config.unitId}`);
                }
                // Always use the stored config to ensure consistency - SINGLE CONNECTION ENFORCED
                this.modbusInstance = new modbus_client_1.ModbusClientCore(this.modbusConfig, node);
                this.activeConnections.modbus++;
                // node.warn(`[MODBUS-SINGLE-CONNECTION] Created THE ONLY ModbusClientCore instance - all nodes will share this connection`);
                this.logActiveConnections(node);
            }
            finally {
                this.initializingFlags.modbus = false;
            }
        }
        this.referenceCount.modbus++;
        this.clientUsers.modbus.add(node.id);
        // node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} got shared Modbus client, ref count: ${this.referenceCount.modbus}`);
        // node.warn(`[MODBUS-SINGLE-CONNECTION] Active users sharing THE SAME connection: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        // node.warn(`[MODBUS-SINGLE-CONNECTION] Shared connection config: ${this.modbusConfig?.type} ${this.modbusConfig?.host}:${this.modbusConfig?.tcpPort}`);
        return this.modbusInstance;
    }
    /**
     * Initialize multi-board configuration
     */
    static initializeMultiBoardConfig(config, node) {
        if (!config.boards || config.boards.length === 0) {
            node.error("[MODBUS-MULTI] No boards configured in multi-board mode");
            return;
        }
        this.modbusMode = config.mode || 'multi';
        this.defaultBoardId = config.defaultBoard || config.boards[0].id;
        // Store board configurations
        for (const board of config.boards) {
            this.modbusBoardConfigs.set(board.id, board);
            node.warn(`[MODBUS-MULTI] Registered board: ${board.id} - ${board.name || 'Unnamed'} (${board.host}:${board.tcpPort})`);
        }
        node.warn(`[MODBUS-MULTI] Initialized ${config.boards.length} boards, default: ${this.defaultBoardId}`);
    }
    /**
     * Get Modbus client with multi-board support
     * @param config - ModbusConfig for single mode, board ID string for multi mode, or object with boardId
     * @param node - Node-RED node instance
     * @returns ModbusClientCore instance
     */
    static getModbusClientV2(config, node) {
        // Handle different input types
        if (typeof config === 'string') {
            // Board ID provided - multi-board mode
            return this.getModbusBoardClient(config, node);
        }
        else if (typeof config === 'object' && 'boardId' in config && config.boardId) {
            // Object with boardId - multi-board mode
            return this.getModbusBoardClient(config.boardId, node);
        }
        else if (typeof config === 'object' && 'config' in config && config.config) {
            // Object with config - single mode
            return this.getModbusClient(config.config, node);
        }
        else {
            // Direct ModbusConfig - single mode (backward compatible)
            return this.getModbusClient(config, node);
        }
    }
    /**
     * Get client for specific board in multi-board mode
     */
    static getModbusBoardClient(boardId, node) {
        var _a;
        // Use default board if not specified
        const targetBoardId = boardId || this.defaultBoardId;
        if (!targetBoardId) {
            throw new Error("[MODBUS-MULTI] No board ID specified and no default board configured");
        }
        // Initialize board users tracking if needed
        if (!this.clientUsers.modbusBoards.has(targetBoardId)) {
            this.clientUsers.modbusBoards.set(targetBoardId, new Set());
        }
        // Check if board exists in pool
        if (!this.modbusBoardPool.has(targetBoardId)) {
            const boardConfig = this.modbusBoardConfigs.get(targetBoardId);
            if (!boardConfig) {
                throw new Error(`[MODBUS-MULTI] Board config not found for ID: ${targetBoardId}`);
            }
            try {
                // Create new connection for this board
                const client = new modbus_client_1.ModbusClientCore(boardConfig, node);
                this.modbusBoardPool.set(targetBoardId, client);
                // Track connections
                if (!this.activeConnections.modbusBoards.has(targetBoardId)) {
                    this.activeConnections.modbusBoards.set(targetBoardId, 0);
                }
                this.activeConnections.modbusBoards.set(targetBoardId, (this.activeConnections.modbusBoards.get(targetBoardId) || 0) + 1);
                node.warn(`[MODBUS-MULTI] Created connection for board: ${targetBoardId} (${boardConfig.host}:${boardConfig.tcpPort})`);
            }
            catch (error) {
                node.error(`[MODBUS-MULTI] Failed to create connection for board ${targetBoardId}: ${error.message}`);
                throw error;
            }
        }
        // Update reference counting
        if (!this.boardReferenceCount.has(targetBoardId)) {
            this.boardReferenceCount.set(targetBoardId, 0);
        }
        this.boardReferenceCount.set(targetBoardId, (this.boardReferenceCount.get(targetBoardId) || 0) + 1);
        // Track node usage
        (_a = this.clientUsers.modbusBoards.get(targetBoardId)) === null || _a === void 0 ? void 0 : _a.add(node.id);
        const refCount = this.boardReferenceCount.get(targetBoardId) || 0;
        const users = Array.from(this.clientUsers.modbusBoards.get(targetBoardId) || []);
        node.warn(`[MODBUS-MULTI] Node ${node.id} got board ${targetBoardId} client, ref count: ${refCount}, users: ${users.join(', ')}`);
        return this.modbusBoardPool.get(targetBoardId);
    }
    /**
     * Get multi-board status for monitoring
     */
    static getMultiBoardStatus() {
        const boards = Array.from(this.modbusBoardConfigs.entries()).map(([id, config]) => {
            const client = this.modbusBoardPool.get(id);
            return {
                id,
                name: config.name,
                host: config.host || 'unknown',
                port: config.tcpPort || 502,
                connected: client ? client.isConnectedCheck() : false,
                referenceCount: this.boardReferenceCount.get(id) || 0,
                users: Array.from(this.clientUsers.modbusBoards.get(id) || [])
            };
        });
        return {
            mode: this.modbusMode,
            defaultBoard: this.defaultBoardId,
            boards
        };
    }
    /**
     * Auto-detect and initialize mode from environment config
     */
    static autoDetectModbusMode(config, node) {
        // Check if multi-board config exists
        if (config.modbusBoards && Array.isArray(config.modbusBoards) && config.modbusBoards.length > 0) {
            node.warn("[MODBUS-AUTO] Detected multi-board configuration");
            const multiConfig = {
                mode: 'multi',
                defaultBoard: config.modbusDefaultBoard || config.modbusBoards[0].id,
                boards: config.modbusBoards
            };
            this.initializeMultiBoardConfig(multiConfig, node);
        }
        else if (config.modbusHost && config.modbusPort) {
            node.warn("[MODBUS-AUTO] Detected single-board configuration");
            this.modbusMode = 'single';
            // Single mode will use existing getModbusClient method
        }
        else {
            node.warn("[MODBUS-AUTO] No Modbus configuration detected");
        }
    }
    /**
     * Validate if the provided config matches the existing shared MySQL config
     * This ensures only ONE MySQL connection is used across all nodes
     */
    static validateMySqlConfig(config, node) {
        if (!this.mysqlConfig) {
            return true; // No existing config, any config is valid
        }
        const configMatches = (this.mysqlConfig.host === config.host &&
            this.mysqlConfig.port === config.port &&
            this.mysqlConfig.user === config.user &&
            this.mysqlConfig.password === config.password &&
            this.mysqlConfig.database === config.database);
        if (!configMatches) {
            // node.warn(`[MYSQL-SINGLE-CONNECTION-ENFORCED] Node ${node.id} config differs from shared config:`);
            // node.warn(`  Existing shared config: ${this.mysqlConfig.host}:${this.mysqlConfig.port}/${this.mysqlConfig.database} user=${this.mysqlConfig.user}`);
            // node.warn(`  Requested config: ${config.host}:${config.port}/${config.database} user=${config.user}`);
            // node.warn(`  ENFORCING SINGLE CONNECTION: Using existing shared connection to prevent multiple MySQL connections.`);
            // node.warn(`  All VIIS nodes MUST use the same MySQL connection for proper resource management.`);
        }
        return configMatches;
    }
    static async getMySqlClient(config, node) {
        // Wait if another node is already initializing
        while (this.initializingFlags.mysql) {
            // node.warn("[MYSQL-INIT] Another node is initializing MySQL client, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // Validate config compatibility - ENFORCES SINGLE CONNECTION
        this.validateMySqlConfig(config, node);
        if (!this.mysqlInstance || !this.mysqlInstance.isConnectedCheck()) {
            this.initializingFlags.mysql = true;
            // node.warn(`[MYSQL-INIT] Node ${node.id} starting MySQL client initialization`);
            try {
                if (this.mysqlInstance) {
                    this.mysqlInstance.disconnect();
                    this.activeConnections.mysql--;
                    node.log("Previous MySQL instance disconnected due to invalid state");
                }
                // Store the config from the first node that creates the connection
                if (!this.mysqlConfig) {
                    this.mysqlConfig = Object.assign({}, config);
                    // node.warn(`[MYSQL-INIT] Storing shared config for ALL nodes: ${config.host}:${config.port}/${config.database} user=${config.user}`);
                }
                // Always use the stored config to ensure consistency - SINGLE CONNECTION ENFORCED
                this.mysqlInstance = new mysql_client_1.MySqlClientCore(this.mysqlConfig, node);
                this.activeConnections.mysql++;
                // node.warn(`[MYSQL-INIT] Created new MySQL client instance - all nodes will share this connection`);
                this.logActiveConnections(node);
            }
            catch (error) {
                this.mysqlInstance = null; // Reset on failure
                node.error(`Failed to connect MySQL client: ${error.message}`);
                throw error;
            }
            finally {
                this.initializingFlags.mysql = false;
            }
        }
        this.referenceCount.mysql++;
        this.clientUsers.mysql.add(node.id);
        // node.warn(`[MYSQL-INIT] Node ${node.id} got MySQL client, ref count: ${this.referenceCount.mysql}`);
        // node.warn(`[MYSQL-INIT] Active users: ${Array.from(this.clientUsers.mysql).join(', ')}`);
        return this.mysqlInstance;
    }
    static releaseClient(type, node) {
        if (type === "modbus" && this.modbusInstance) {
            this.referenceCount.modbus--;
            this.clientUsers.modbus.delete(node.id);
            // node.warn(`[MODBUS-SINGLE-CONNECTION] Node ${node.id} released shared Modbus client, ref count: ${this.referenceCount.modbus}`);
            // node.warn(`[MODBUS-SINGLE-CONNECTION] Remaining users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
            if (this.referenceCount.modbus <= 0) {
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
                this.modbusConfig = null; // Reset config when no nodes are using the client
                this.clientUsers.modbus.clear();
                // node.warn("[MODBUS-SINGLE-CONNECTION] THE ONLY modbus connection has been disconnected - no more users");
                this.logActiveConnections(node);
            }
        }
        else if (type === "thingsboard" && this.thingsboardMqttInstance) {
            this.referenceCount.thingsboard--;
            this.clientUsers.thingsboard.delete(node.id);
            // node.warn(`[THINGSBOARD-RELEASE] Node ${node.id} released ThingsBoard client, ref count: ${this.referenceCount.thingsboard}`);
            if (this.referenceCount.thingsboard <= 0) {
                this.thingsboardMqttInstance.disconnect();
                this.activeConnections.thingsboardMqtt--;
                this.thingsboardMqttInstance = null;
                this.clientUsers.thingsboard.clear();
                node.log("Disconnected and cleared Thingsboard MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "local" && this.localMqttInstance) {
            this.referenceCount.local--;
            this.clientUsers.local.delete(node.id);
            // node.warn(`[LOCAL-RELEASE] Node ${node.id} released Local MQTT client, ref count: ${this.referenceCount.local}`);
            if (this.referenceCount.local <= 0) {
                // Unregister from recovery manager
                if (this.recoveryManager) {
                    this.recoveryManager.unregisterClient('local-mqtt');
                }
                this.localMqttInstance.disconnect();
                this.activeConnections.localMqtt--;
                this.localMqttInstance = null;
                this.clientUsers.local.clear();
                node.log("Disconnected and cleared Local MqttClientCore instance");
                this.logActiveConnections(node);
            }
        }
        else if (type === "mysql" && this.mysqlInstance) {
            this.referenceCount.mysql--;
            this.clientUsers.mysql.delete(node.id);
            // node.warn(`[MYSQL-RELEASE] Node ${node.id} released MySQL client, ref count: ${this.referenceCount.mysql}`);
            // node.warn(`[MYSQL-RELEASE] Remaining users: ${Array.from(this.clientUsers.mysql).join(', ')}`);
            if (this.referenceCount.mysql <= 0) {
                this.mysqlInstance.disconnect();
                this.activeConnections.mysql--;
                this.mysqlInstance = null;
                this.mysqlConfig = null; // Reset config when no nodes are using the client
                this.clientUsers.mysql.clear();
                // node.warn("[MYSQL-RELEASE] MySQL connection has been disconnected - no more users");
                this.logActiveConnections(node);
            }
        }
    }
    /**
     * Release client for multi-board support
     */
    static releaseClientV2(type, node, boardId) {
        var _a;
        if (type === "modbus-board" && boardId) {
            const refCount = this.boardReferenceCount.get(boardId) || 0;
            if (refCount > 0) {
                this.boardReferenceCount.set(boardId, refCount - 1);
                (_a = this.clientUsers.modbusBoards.get(boardId)) === null || _a === void 0 ? void 0 : _a.delete(node.id);
                node.warn(`[MODBUS-MULTI] Node ${node.id} released board ${boardId} client, ref count: ${refCount - 1}`);
                if (refCount - 1 <= 0) {
                    // Disconnect and remove board connection
                    const client = this.modbusBoardPool.get(boardId);
                    if (client) {
                        client.disconnect();
                        this.modbusBoardPool.delete(boardId);
                        this.activeConnections.modbusBoards.delete(boardId);
                        this.boardReferenceCount.delete(boardId);
                        this.clientUsers.modbusBoards.delete(boardId);
                        node.warn(`[MODBUS-MULTI] Board ${boardId} connection closed - no more users`);
                    }
                }
            }
        }
        else {
            // Use existing releaseClient for backward compatibility
            this.releaseClient(type, node);
        }
    }
    static logActiveConnections(node) {
        // node.warn(`[CONNECTION-STATUS] Active server connections - Modbus: ${this.activeConnections.modbus}, ThingsBoard MQTT: ${this.activeConnections.thingsboardMqtt}, Local MQTT: ${this.activeConnections.localMqtt}, MySQL: ${this.activeConnections.mysql}`);
        // Enforce single connection validation for Modbus
        if (this.activeConnections.modbus > 1) {
            node.error(`[CRITICAL-ERROR] MULTIPLE MODBUS CONNECTIONS DETECTED! Count: ${this.activeConnections.modbus}. This should NEVER happen!`);
        }
        else if (this.activeConnections.modbus === 1) {
            // node.warn(`[MODBUS-SINGLE-CONNECTION] ✓ Correctly using SINGLE modbus connection as designed`);
        }
        // Enforce single connection validation for MySQL
        if (this.activeConnections.mysql > 1) {
            node.error(`[CRITICAL-ERROR] MULTIPLE MYSQL CONNECTIONS DETECTED! Count: ${this.activeConnections.mysql}. This should NEVER happen!`);
        }
        else if (this.activeConnections.mysql === 1) {
            // node.warn(`[MYSQL-SINGLE-CONNECTION] ✓ Correctly using SINGLE MySQL connection as designed`);
        }
    }
    static logConnectionCounts(node) {
        // node.warn(`[CONNECTION-COUNTS] Reference counts - Modbus: ${this.referenceCount.modbus}, ThingsBoard: ${this.referenceCount.thingsboard}, Local MQTT: ${this.referenceCount.local}, MySQL: ${this.referenceCount.mysql}`);
        this.logActiveConnections(node);
        // Log shared modbus config if exists
        if (this.modbusConfig && this.referenceCount.modbus > 0) {
            // node.warn(`[MODBUS-SINGLE-CONNECTION] Shared config used by ALL nodes: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort} unit=${this.modbusConfig.unitId}`);
            // node.warn(`[MODBUS-SINGLE-CONNECTION] All nodes sharing THE SAME connection: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        }
        // Log shared mysql config if exists
        if (this.mysqlConfig && this.referenceCount.mysql > 0) {
            // node.warn(`[MYSQL-SINGLE-CONNECTION] Shared config used by ALL nodes: ${this.mysqlConfig.host}:${this.mysqlConfig.port}/${this.mysqlConfig.database} user=${this.mysqlConfig.user}`);
            // node.warn(`[MYSQL-SINGLE-CONNECTION] All nodes sharing THE SAME connection: ${Array.from(this.clientUsers.mysql).join(', ')}`);
        }
    }
    /**
     * Validate that only one modbus connection exists
     * This method should be called periodically to ensure system integrity
     */
    static validateSingleModbusConnection(node) {
        const isValid = this.activeConnections.modbus <= 1;
        if (!isValid) {
            node.error(`[CRITICAL-VIOLATION] MULTIPLE MODBUS CONNECTIONS DETECTED! Active: ${this.activeConnections.modbus}`);
            node.error(`[CRITICAL-VIOLATION] This violates the single connection requirement!`);
            node.error(`[CRITICAL-VIOLATION] Users: ${Array.from(this.clientUsers.modbus).join(', ')}`);
        }
        else if (this.activeConnections.modbus === 1) {
            node.log(`[MODBUS-VALIDATION] ✓ Single connection requirement satisfied`);
        }
        return isValid;
    }
    /**
     * Get current modbus connection status for monitoring
     */
    static getModbusConnectionStatus() {
        return {
            hasConnection: this.modbusInstance !== null,
            activeConnections: this.activeConnections.modbus,
            referenceCount: this.referenceCount.modbus,
            users: Array.from(this.clientUsers.modbus),
            config: this.modbusConfig
        };
    }
    /**
     * Force reload Modbus config and reconnect all clients
     * This is used for hot-reload when environment config changes
     */
    static async reloadModbusConfig(newConfig, node) {
        try {
            node.warn("[MODBUS-RELOAD] Starting Modbus config reload...");
            node.warn(`[MODBUS-RELOAD] Current config: ${JSON.stringify(this.modbusConfig)}`);
            node.warn(`[MODBUS-RELOAD] New config: ${JSON.stringify(newConfig)}`);
            // Check if config actually changed
            if (this.modbusConfig &&
                this.modbusConfig.type === newConfig.type &&
                this.modbusConfig.host === newConfig.host &&
                this.modbusConfig.tcpPort === newConfig.tcpPort &&
                this.modbusConfig.serialPort === newConfig.serialPort &&
                this.modbusConfig.baudRate === newConfig.baudRate &&
                this.modbusConfig.parity === newConfig.parity &&
                this.modbusConfig.unitId === newConfig.unitId) {
                node.warn("[MODBUS-RELOAD] Config unchanged, skipping reload");
                return false;
            }
            // Store active users before reload
            const activeUsers = Array.from(this.clientUsers.modbus);
            const refCount = this.referenceCount.modbus;
            node.warn(`[MODBUS-RELOAD] Active users before reload: ${activeUsers.join(', ')}`);
            node.warn(`[MODBUS-RELOAD] Reference count before reload: ${refCount}`);
            // Disconnect old client
            if (this.modbusInstance) {
                node.warn("[MODBUS-RELOAD] Disconnecting old Modbus client...");
                this.modbusInstance.disconnect();
                this.activeConnections.modbus--;
                this.modbusInstance = null;
            }
            // Update config
            this.modbusConfig = Object.assign({}, newConfig);
            node.warn("[MODBUS-RELOAD] Config updated");
            // Create new client with new config
            node.warn("[MODBUS-RELOAD] Creating new Modbus client with updated config...");
            this.modbusInstance = new modbus_client_1.ModbusClientCore(this.modbusConfig, node);
            this.activeConnections.modbus++;
            // Wait for connection to establish
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (this.modbusInstance.isConnectedCheck()) {
                node.warn("[MODBUS-RELOAD] New Modbus client connected successfully");
                node.warn(`[MODBUS-RELOAD] Updated config: ${this.modbusConfig.type} ${this.modbusConfig.host}:${this.modbusConfig.tcpPort}`);
                node.warn(`[MODBUS-RELOAD] All ${activeUsers.length} nodes will use new config on next operation`);
                return true;
            }
            else {
                throw new Error("Failed to establish Modbus connection with new config");
            }
        }
        catch (error) {
            node.error(`[MODBUS-RELOAD] Failed to reload Modbus config: ${error.message}`);
            return false;
        }
    }
    /**
     * Validate that only one MySQL connection exists
     * This method should be called periodically to ensure system integrity
     */
    static validateSingleMySqlConnection(node) {
        const isValid = this.activeConnections.mysql <= 1;
        if (!isValid) {
            node.error(`[CRITICAL-VIOLATION] MULTIPLE MYSQL CONNECTIONS DETECTED! Active: ${this.activeConnections.mysql}`);
            node.error(`[CRITICAL-VIOLATION] This violates the single connection requirement!`);
            node.error(`[CRITICAL-VIOLATION] Users: ${Array.from(this.clientUsers.mysql).join(', ')}`);
        }
        else if (this.activeConnections.mysql === 1) {
            node.log(`[MYSQL-VALIDATION] ✓ Single connection requirement satisfied`);
        }
        return isValid;
    }
    /**
     * Get current MySQL connection status for monitoring
     */
    static getMySqlConnectionStatus() {
        return {
            hasConnection: this.mysqlInstance !== null,
            activeConnections: this.activeConnections.mysql,
            referenceCount: this.referenceCount.mysql,
            users: Array.from(this.clientUsers.mysql),
            config: this.mysqlConfig
        };
    }
}
// Single connection for backward compatibility
ClientRegistry.modbusInstance = null;
// Multi-board connection pool
ClientRegistry.modbusBoardPool = new Map();
ClientRegistry.modbusBoardConfigs = new Map();
ClientRegistry.modbusMode = 'single';
ClientRegistry.defaultBoardId = null;
// Other client instances
ClientRegistry.thingsboardMqttInstance = null;
ClientRegistry.localMqttInstance = null;
ClientRegistry.mysqlInstance = null;
// Reference counting with board support
ClientRegistry.referenceCount = { modbus: 0, thingsboard: 0, local: 0, mysql: 0 };
ClientRegistry.boardReferenceCount = new Map();
ClientRegistry.activeConnections = {
    modbus: 0,
    thingsboardMqtt: 0,
    localMqtt: 0,
    mysql: 0,
    modbusBoards: new Map()
};
// Store the config used for the shared modbus client
ClientRegistry.modbusConfig = null;
// Store the config used for the shared mysql client
ClientRegistry.mysqlConfig = null;
// Mutex-like flags to prevent race conditions
ClientRegistry.initializingFlags = {
    thingsboard: false,
    local: false,
    modbus: false,
    mysql: false
};
// Track which nodes are using which clients for debugging
ClientRegistry.clientUsers = {
    modbus: new Set(),
    thingsboard: new Set(),
    local: new Set(),
    mysql: new Set(),
    modbusBoards: new Map() // board -> Set of node IDs
};
// Recovery mechanism - periodic health check
ClientRegistry.recoveryTimer = null;
ClientRegistry.RECOVERY_INTERVAL = 15000; // 15 seconds - more aggressive
ClientRegistry.recoveryManager = null;
exports.default = ClientRegistry;
