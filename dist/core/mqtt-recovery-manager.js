"use strict";
/**
 * Enhanced MQTT Recovery Manager for VIIS System
 * Provides aggressive recovery mechanisms for power outages and network disruptions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttRecoveryManager = void 0;
const events_1 = require("events");
class MqttRecoveryManager extends events_1.EventEmitter {
    constructor(options = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        super();
        this.clients = new Map();
        this.quickRecoveryTimer = null;
        this.normalRecoveryTimer = null;
        this.networkCheckTimer = null;
        this.consecutiveDisconnections = 0;
        this.isPowerOutage = false;
        this.isNetworkDisrupted = false;
        this.lastNetworkCheckTime = Date.now();
        this.networkRecoveryAttempts = 0;
        // State tracking
        this.isInPowerOutageRecovery = false;
        this.lastNetworkState = true;
        // Aggressive recovery settings for production stability
        this.AGGRESSIVE_MODE = (_a = options.aggressiveMode) !== null && _a !== void 0 ? _a : true;
        this.QUICK_RECOVERY_INTERVAL = (_b = options.quickRecoveryInterval) !== null && _b !== void 0 ? _b : 2000; // 2 seconds
        this.NORMAL_RECOVERY_INTERVAL = (_c = options.normalRecoveryInterval) !== null && _c !== void 0 ? _c : 10000; // 10 seconds
        this.MAX_QUICK_RECOVERY_ATTEMPTS = (_d = options.maxQuickRecoveryAttempts) !== null && _d !== void 0 ? _d : 10;
        this.NETWORK_CHECK_INTERVAL = (_e = options.networkCheckInterval) !== null && _e !== void 0 ? _e : 5000; // 5 seconds
        this.POWER_OUTAGE_DETECTION = (_f = options.powerOutageDetection) !== null && _f !== void 0 ? _f : true;
        this.POWER_OUTAGE_THRESHOLD = (_g = options.powerOutageThreshold) !== null && _g !== void 0 ? _g : 2;
    }
    static getInstance(options) {
        if (!this.instance) {
            this.instance = new MqttRecoveryManager(options);
        }
        return this.instance;
    }
    /**
     * Register a client for enhanced recovery management
     */
    registerClient(clientId, client, node) {
        this.clients.set(clientId, {
            client,
            node,
            lastConnected: Date.now(),
            recoveryAttempts: 0,
            inQuickRecovery: false
        });
        // Set up client event listeners
        this.setupClientListeners(clientId, client, node);
        // Start recovery mechanisms if this is the first client
        if (this.clients.size === 1) {
            this.startRecoveryMechanisms();
        }
        node.log(`[RECOVERY-MANAGER] Registered client ${clientId} with aggressive recovery enabled`);
        this.emit('clientRegistered', clientId);
    }
    /**
     * Setup event listeners for client connection events
     */
    setupClientListeners(clientId, client, node) {
        // Listen for disconnection events
        client.on('disconnected', () => {
            const clientInfo = this.clients.get(clientId);
            if (clientInfo) {
                clientInfo.disconnectTime = Date.now();
                clientInfo.inQuickRecovery = true;
                clientInfo.recoveryAttempts = 0;
                // node.warn(`[RECOVERY-MANAGER] Client ${clientId} disconnected - initiating quick recovery`);
                this.handleDisconnection(clientId);
            }
        });
        // Listen for successful connection
        client.on('connected', () => {
            const clientInfo = this.clients.get(clientId);
            if (clientInfo) {
                clientInfo.lastConnected = Date.now();
                clientInfo.disconnectTime = undefined;
                clientInfo.recoveryAttempts = 0;
                clientInfo.inQuickRecovery = false;
                node.log(`[RECOVERY-MANAGER] Client ${clientId} connected successfully`);
                this.emit('clientConnected', clientId);
                // If recovering from power outage, reset the flag
                if (this.isInPowerOutageRecovery) {
                    this.handlePowerRestoration();
                }
            }
        });
    }
    /**
     * Handle client disconnection with immediate recovery attempt
     */
    handleDisconnection(clientId) {
        // Immediate recovery attempt for critical connections
        setTimeout(() => {
            this.attemptQuickRecovery(clientId);
        }, 500); // 500ms immediate response
    }
    /**
     * Start all recovery mechanisms
     */
    startRecoveryMechanisms() {
        // Quick recovery for recent disconnections
        if (!this.quickRecoveryTimer) {
            this.quickRecoveryTimer = setInterval(() => {
                this.performQuickRecoveryCheck();
            }, this.QUICK_RECOVERY_INTERVAL);
        }
        // Normal recovery for persistent issues
        if (!this.normalRecoveryTimer) {
            this.normalRecoveryTimer = setInterval(() => {
                this.performNormalRecoveryCheck();
            }, this.NORMAL_RECOVERY_INTERVAL);
        }
        // Network connectivity monitoring
        if (!this.networkCheckTimer && this.POWER_OUTAGE_DETECTION) {
            this.networkCheckTimer = setInterval(() => {
                this.checkNetworkConnectivity();
            }, this.NETWORK_CHECK_INTERVAL);
        }
        console.log("[RECOVERY-MANAGER] Started all recovery mechanisms");
    }
    /**
     * Quick recovery check for recently disconnected clients
     */
    performQuickRecoveryCheck() {
        const now = Date.now();
        for (const [clientId, clientInfo] of this.clients.entries()) {
            if (!clientInfo.client.isConnected() && clientInfo.inQuickRecovery) {
                if (clientInfo.recoveryAttempts < this.MAX_QUICK_RECOVERY_ATTEMPTS) {
                    this.attemptQuickRecovery(clientId);
                }
                else {
                    // Move to normal recovery mode
                    clientInfo.inQuickRecovery = false;
                    clientInfo.node.warn(`[RECOVERY-MANAGER] Client ${clientId} moved to normal recovery mode`);
                }
            }
        }
    }
    /**
     * Normal recovery check for persistent disconnections
     */
    performNormalRecoveryCheck() {
        for (const [clientId, clientInfo] of this.clients.entries()) {
            if (!clientInfo.client.isConnected() && !clientInfo.inQuickRecovery) {
                this.attemptNormalRecovery(clientId);
            }
        }
    }
    /**
     * Attempt quick recovery with aggressive reconnection
     */
    attemptQuickRecovery(clientId) {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo)
            return;
        clientInfo.recoveryAttempts++;
        clientInfo.node.log(`[RECOVERY-MANAGER] Quick recovery attempt ${clientInfo.recoveryAttempts} for ${clientId}`);
        try {
            // Reset circuit breaker immediately
            if (typeof clientInfo.client.resetCircuitBreaker === 'function') {
                clientInfo.client.resetCircuitBreaker();
            }
            // The reconnection will be triggered automatically after circuit breaker reset
            this.emit('recoveryAttempted', { clientId, type: 'quick', attempt: clientInfo.recoveryAttempts });
        }
        catch (error) {
            clientInfo.node.error(`[RECOVERY-MANAGER] Quick recovery failed for ${clientId}: ${error.message}`);
        }
    }
    /**
     * Attempt normal recovery
     */
    attemptNormalRecovery(clientId) {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo)
            return;
        clientInfo.node.log(`[RECOVERY-MANAGER] Normal recovery attempt for ${clientId}`);
        try {
            // Reset circuit breaker
            if (typeof clientInfo.client.resetCircuitBreaker === 'function') {
                clientInfo.client.resetCircuitBreaker();
            }
            // The reconnection will be triggered automatically after circuit breaker reset
            this.emit('recoveryAttempted', { clientId, type: 'normal' });
        }
        catch (error) {
            clientInfo.node.error(`[RECOVERY-MANAGER] Normal recovery failed for ${clientId}: ${error.message}`);
        }
    }
    /**
     * Check network connectivity and detect power outages or internet disruptions
     */
    checkNetworkConnectivity() {
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastNetworkCheckTime;
        this.lastNetworkCheckTime = now;
        const allDisconnected = Array.from(this.clients.values()).every(client => !client.client.isConnected());
        if (allDisconnected && this.clients.size > 0) {
            this.consecutiveDisconnections++;
            // Check if this might be an internet disruption (longer time between checks)
            if (timeSinceLastCheck > 30000) { // More than 30 seconds since last check
                this.isNetworkDisrupted = true;
                this.emit('networkDisruptionDetected');
                Array.from(this.clients.keys()).forEach(clientId => {
                    const clientInfo = this.clients.get(clientId);
                    if (clientInfo) {
                        clientInfo.node.warn('[RECOVERY-MANAGER] Network disruption detected - possible internet outage');
                    }
                });
            }
            if (this.consecutiveDisconnections >= this.POWER_OUTAGE_THRESHOLD) {
                if (!this.isPowerOutage) {
                    this.isPowerOutage = true;
                    this.emit('powerOutageDetected');
                    Array.from(this.clients.keys()).forEach(clientId => {
                        const clientInfo = this.clients.get(clientId);
                        if (clientInfo) {
                            clientInfo.node.error('[RECOVERY-MANAGER] Power outage detected - entering aggressive recovery mode');
                        }
                    });
                }
            }
        }
        else if ((this.isPowerOutage || this.isNetworkDisrupted) && !allDisconnected) {
            // Power/Network restored
            const wasNetworkDisruption = this.isNetworkDisrupted;
            this.isPowerOutage = false;
            this.isNetworkDisrupted = false;
            this.consecutiveDisconnections = 0;
            this.networkRecoveryAttempts = 0;
            if (wasNetworkDisruption) {
                this.emit('networkRestored');
                Array.from(this.clients.keys()).forEach(clientId => {
                    const clientInfo = this.clients.get(clientId);
                    if (clientInfo) {
                        clientInfo.node.warn('[RECOVERY-MANAGER] Network connectivity restored');
                    }
                });
            }
            else {
                this.emit('powerRestored');
            }
            // Force immediate recovery on all clients
            this.forceImmediateRecovery();
        }
        else {
            this.consecutiveDisconnections = 0;
        }
        // If network is disrupted, attempt more aggressive recovery
        if (this.isNetworkDisrupted) {
            this.networkRecoveryAttempts++;
            if (this.networkRecoveryAttempts % 3 === 0) { // Every 3rd attempt
                this.forceImmediateRecovery();
            }
        }
    }
    /**
     * Handle detected power outage with aggressive recovery
     */
    handlePowerOutage() {
        if (this.isInPowerOutageRecovery)
            return;
        console.warn("[RECOVERY-MANAGER] POWER OUTAGE DETECTED - Initiating aggressive recovery");
        this.isInPowerOutageRecovery = true;
        this.emit('powerOutageDetected');
        // Aggressive recovery for all clients
        for (const [clientId, clientInfo] of this.clients.entries()) {
            clientInfo.inQuickRecovery = true;
            clientInfo.recoveryAttempts = 0;
            // Immediate recovery attempt
            this.attemptQuickRecovery(clientId);
        }
    }
    /**
     * Handle power restoration
     */
    handlePowerRestoration() {
        if (!this.isInPowerOutageRecovery)
            return;
        console.log("[RECOVERY-MANAGER] POWER RESTORED - Recovery successful");
        this.isInPowerOutageRecovery = false;
        this.consecutiveDisconnections = 0;
        this.emit('powerRestored');
    }
    /**
     * Force immediate recovery on all clients
     */
    forceImmediateRecovery() {
        Array.from(this.clients.keys()).forEach(clientId => {
            const clientInfo = this.clients.get(clientId);
            if (clientInfo && !clientInfo.client.isConnected()) {
                const reason = this.isPowerOutage ? 'power outage' :
                    this.isNetworkDisrupted ? 'network disruption' : 'manual trigger';
                clientInfo.node.warn(`[RECOVERY-MANAGER] Forcing immediate recovery for ${clientId} due to ${reason}`);
                // Reset recovery attempts to allow quick recovery
                clientInfo.recoveryAttempts = 0;
                // Reset circuit breaker immediately for network issues
                if (this.isNetworkDisrupted || this.isPowerOutage) {
                    if (typeof clientInfo.client.resetCircuitBreaker === 'function') {
                        clientInfo.client.resetCircuitBreaker();
                    }
                }
                // Trigger immediate recovery
                this.attemptQuickRecovery(clientId);
            }
        });
    }
    /**
     * Get recovery statistics
     */
    getStats() {
        const stats = {
            totalClients: this.clients.size,
            connectedClients: 0,
            disconnectedClients: 0,
            inQuickRecovery: 0,
            inPowerOutageRecovery: this.isInPowerOutageRecovery,
            clientDetails: []
        };
        for (const [clientId, clientInfo] of this.clients.entries()) {
            const isConnected = clientInfo.client.isConnected();
            if (isConnected) {
                stats.connectedClients++;
            }
            else {
                stats.disconnectedClients++;
                if (clientInfo.inQuickRecovery) {
                    stats.inQuickRecovery++;
                }
            }
            stats.clientDetails.push({
                clientId,
                connected: isConnected,
                recoveryAttempts: clientInfo.recoveryAttempts,
                inQuickRecovery: clientInfo.inQuickRecovery,
                lastConnected: new Date(clientInfo.lastConnected).toISOString(),
                disconnectTime: clientInfo.disconnectTime ?
                    new Date(clientInfo.disconnectTime).toISOString() : null
            });
        }
        return stats;
    }
    /**
     * Unregister a client
     */
    unregisterClient(clientId) {
        if (this.clients.has(clientId)) {
            const clientInfo = this.clients.get(clientId);
            clientInfo.node.log(`[RECOVERY-MANAGER] Unregistered client ${clientId}`);
            this.clients.delete(clientId);
            this.emit('clientUnregistered', clientId);
        }
        // Stop recovery mechanisms if no clients remain
        if (this.clients.size === 0) {
            this.stopRecoveryMechanisms();
        }
    }
    /**
     * Stop all recovery mechanisms
     */
    stopRecoveryMechanisms() {
        if (this.quickRecoveryTimer) {
            clearInterval(this.quickRecoveryTimer);
            this.quickRecoveryTimer = null;
        }
        if (this.normalRecoveryTimer) {
            clearInterval(this.normalRecoveryTimer);
            this.normalRecoveryTimer = null;
        }
        if (this.networkCheckTimer) {
            clearInterval(this.networkCheckTimer);
            this.networkCheckTimer = null;
        }
        console.log("[RECOVERY-MANAGER] Stopped all recovery mechanisms");
    }
    /**
     * Cleanup and shutdown
     */
    shutdown() {
        this.stopRecoveryMechanisms();
        this.clients.clear();
        this.removeAllListeners();
        MqttRecoveryManager.instance = null;
    }
}
exports.MqttRecoveryManager = MqttRecoveryManager;
