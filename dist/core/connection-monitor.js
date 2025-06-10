"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionMonitor = void 0;
/**
 * Connection Monitor for VIIS MQTT clients
 * Provides automatic recovery and health monitoring
 */
class ConnectionMonitor {
    constructor() {
        this.monitorTimer = null;
        this.MONITOR_INTERVAL = 30000; // 30 seconds
        this.MAX_FAILED_CHECKS = 3;
        this.clients = new Map();
    }
    static getInstance() {
        if (!this.instance) {
            this.instance = new ConnectionMonitor();
        }
        return this.instance;
    }
    /**
     * Register a client for monitoring
     */
    registerClient(clientId, client, node) {
        this.clients.set(clientId, {
            client,
            node,
            failedChecks: 0,
            lastSeen: Date.now()
        });
        // Start monitoring if this is the first client
        if (this.clients.size === 1) {
            this.startMonitoring();
        }
        node.log(`[CONNECTION-MONITOR] Registered client ${clientId} for monitoring`);
    }
    /**
     * Unregister a client from monitoring
     */
    unregisterClient(clientId) {
        if (this.clients.has(clientId)) {
            const clientInfo = this.clients.get(clientId);
            clientInfo.node.log(`[CONNECTION-MONITOR] Unregistered client ${clientId}`);
            this.clients.delete(clientId);
        }
        // Stop monitoring if no clients remain
        if (this.clients.size === 0) {
            this.stopMonitoring();
        }
    }
    /**
     * Start the monitoring process
     */
    startMonitoring() {
        if (this.monitorTimer)
            return;
        console.log("[CONNECTION-MONITOR] Starting connection monitoring");
        this.monitorTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.MONITOR_INTERVAL);
    }
    /**
     * Stop the monitoring process
     */
    stopMonitoring() {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
            console.log("[CONNECTION-MONITOR] Stopped connection monitoring");
        }
    }
    /**
     * Perform health check on all registered clients
     */
    performHealthCheck() {
        const now = Date.now();
        for (const [clientId, clientInfo] of this.clients.entries()) {
            const { client, node } = clientInfo;
            try {
                if (client.isConnected()) {
                    // Client is healthy, reset failed checks
                    clientInfo.failedChecks = 0;
                    clientInfo.lastSeen = now;
                }
                else {
                    // Client is disconnected
                    clientInfo.failedChecks++;
                    node.warn(`[CONNECTION-MONITOR] Client ${clientId} disconnected (failed checks: ${clientInfo.failedChecks})`);
                    // Attempt recovery if failed checks exceed threshold
                    if (clientInfo.failedChecks >= this.MAX_FAILED_CHECKS) {
                        this.attemptRecovery(clientId, clientInfo);
                    }
                }
            }
            catch (error) {
                node.error(`[CONNECTION-MONITOR] Health check error for ${clientId}: ${error.message}`);
                clientInfo.failedChecks++;
            }
        }
    }
    /**
     * Attempt to recover a failed connection
     */
    attemptRecovery(clientId, clientInfo) {
        const { client, node } = clientInfo;
        node.warn(`[CONNECTION-MONITOR] Attempting recovery for client ${clientId}`);
        try {
            // Reset circuit breaker if available
            if (typeof client.resetCircuitBreaker === 'function') {
                client.resetCircuitBreaker();
                node.log(`[CONNECTION-MONITOR] Reset circuit breaker for ${clientId}`);
            }
            // Reset failed checks to give recovery a chance
            clientInfo.failedChecks = 0;
        }
        catch (error) {
            node.error(`[CONNECTION-MONITOR] Recovery failed for ${clientId}: ${error.message}`);
        }
    }
    /**
     * Get monitoring statistics
     */
    getStats() {
        const stats = {
            totalClients: this.clients.size,
            connectedClients: 0,
            disconnectedClients: 0,
            clientDetails: []
        };
        for (const [clientId, clientInfo] of this.clients.entries()) {
            const isConnected = clientInfo.client.isConnected();
            if (isConnected) {
                stats.connectedClients++;
            }
            else {
                stats.disconnectedClients++;
            }
            stats.clientDetails.push({
                clientId,
                connected: isConnected,
                failedChecks: clientInfo.failedChecks,
                lastSeen: new Date(clientInfo.lastSeen).toISOString()
            });
        }
        return stats;
    }
    /**
     * Force recovery for all clients
     */
    forceRecoveryAll() {
        console.log("[CONNECTION-MONITOR] Forcing recovery for all clients");
        for (const [clientId, clientInfo] of this.clients.entries()) {
            if (!clientInfo.client.isConnected()) {
                this.attemptRecovery(clientId, clientInfo);
            }
        }
    }
}
exports.ConnectionMonitor = ConnectionMonitor;
ConnectionMonitor.instance = null;
