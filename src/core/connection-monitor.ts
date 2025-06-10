import { Node } from "node-red";
import { MqttClientCore } from "./mqtt-client";

/**
 * Connection Monitor for VIIS MQTT clients
 * Provides automatic recovery and health monitoring
 */
export class ConnectionMonitor {
    private static instance: ConnectionMonitor | null = null;
    private monitorTimer: NodeJS.Timeout | null = null;
    private readonly MONITOR_INTERVAL = 30000; // 30 seconds
    private readonly MAX_FAILED_CHECKS = 3;
    
    private clients: Map<string, {
        client: MqttClientCore;
        node: Node;
        failedChecks: number;
        lastSeen: number;
    }> = new Map();

    private constructor() {}

    public static getInstance(): ConnectionMonitor {
        if (!this.instance) {
            this.instance = new ConnectionMonitor();
        }
        return this.instance;
    }

    /**
     * Register a client for monitoring
     */
    public registerClient(clientId: string, client: MqttClientCore, node: Node): void {
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
    public unregisterClient(clientId: string): void {
        if (this.clients.has(clientId)) {
            const clientInfo = this.clients.get(clientId)!;
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
    private startMonitoring(): void {
        if (this.monitorTimer) return;

        console.log("[CONNECTION-MONITOR] Starting connection monitoring");
        this.monitorTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.MONITOR_INTERVAL);
    }

    /**
     * Stop the monitoring process
     */
    private stopMonitoring(): void {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
            console.log("[CONNECTION-MONITOR] Stopped connection monitoring");
        }
    }

    /**
     * Perform health check on all registered clients
     */
    private performHealthCheck(): void {
        const now = Date.now();
        
        for (const [clientId, clientInfo] of this.clients.entries()) {
            const { client, node } = clientInfo;
            
            try {
                if (client.isConnected()) {
                    // Client is healthy, reset failed checks
                    clientInfo.failedChecks = 0;
                    clientInfo.lastSeen = now;
                } else {
                    // Client is disconnected
                    clientInfo.failedChecks++;
                    node.warn(`[CONNECTION-MONITOR] Client ${clientId} disconnected (failed checks: ${clientInfo.failedChecks})`);
                    
                    // Attempt recovery if failed checks exceed threshold
                    if (clientInfo.failedChecks >= this.MAX_FAILED_CHECKS) {
                        this.attemptRecovery(clientId, clientInfo);
                    }
                }
            } catch (error) {
                node.error(`[CONNECTION-MONITOR] Health check error for ${clientId}: ${(error as Error).message}`);
                clientInfo.failedChecks++;
            }
        }
    }

    /**
     * Attempt to recover a failed connection
     */
    private attemptRecovery(clientId: string, clientInfo: any): void {
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
            
        } catch (error) {
            node.error(`[CONNECTION-MONITOR] Recovery failed for ${clientId}: ${(error as Error).message}`);
        }
    }

    /**
     * Get monitoring statistics
     */
    public getStats(): any {
        const stats = {
            totalClients: this.clients.size,
            connectedClients: 0,
            disconnectedClients: 0,
            clientDetails: [] as any[]
        };

        for (const [clientId, clientInfo] of this.clients.entries()) {
            const isConnected = clientInfo.client.isConnected();
            
            if (isConnected) {
                stats.connectedClients++;
            } else {
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
    public forceRecoveryAll(): void {
        console.log("[CONNECTION-MONITOR] Forcing recovery for all clients");
        
        for (const [clientId, clientInfo] of this.clients.entries()) {
            if (!clientInfo.client.isConnected()) {
                this.attemptRecovery(clientId, clientInfo);
            }
        }
    }
}
