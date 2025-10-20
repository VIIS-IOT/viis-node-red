/**
 * @fileoverview Marine IoT WebSocket Service
 * 
 * Real-time telemetry streaming for Marine IoT systems via WebSocket
 * Provides efficient push-based updates instead of polling
 */

import { Service } from 'typedi';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { Node } from 'node-red';
import { MarineTelemetryService } from './marine-telemetry.service';
import { AuthService } from './auth.service';
import { logger } from '../utils/logger';
import { IService } from '../types/common.types';

/**
 * WebSocket event names
 */
export enum MarineWebSocketEvents {
    // Client -> Server
    SUBSCRIBE_DEVICE = 'marine:subscribe',
    UNSUBSCRIBE_DEVICE = 'marine:unsubscribe',
    GET_LATEST = 'marine:get_latest',
    
    // Server -> Client
    TELEMETRY_UPDATE = 'marine:telemetry',
    ERROR = 'marine:error',
    CONNECTED = 'marine:connected',
    SUBSCRIBED = 'marine:subscribed',
    UNSUBSCRIBED = 'marine:unsubscribed'
}

/**
 * Client subscription info
 */
interface ClientSubscription {
    socketId: string;
    deviceId: string;
    userId: string;
    keys?: string[];
}

/**
 * WebSocket authentication data
 */
interface SocketAuthData {
    user_id: string;
    email: string;
    token: string;
}

/**
 * Marine WebSocket Service
 * Handles real-time telemetry streaming via Socket.IO
 */
@Service()
export class MarineWebSocketService implements IService {
    private io: SocketIOServer | null = null;
    private subscriptions: Map<string, ClientSubscription> = new Map();
    private deviceSubscribers: Map<string, Set<string>> = new Map(); // deviceId -> Set<socketId>
    private updateInterval: NodeJS.Timeout | null = null;
    private initialized = false;

    constructor(
        private marineTelemetryService: MarineTelemetryService,
        private authService: AuthService,
        private node: Node
    ) {}

    /**
     * Initialize WebSocket server
     * Note: This overrides IService.initialize() which takes no parameters
     * Call this separately after constructing the service
     */
    async initializeWithServer(httpServer: HttpServer): Promise<void> {
        if (this.initialized) {
            logger.warn(this.node, '[MARINE-WS] WebSocket already initialized');
            return;
        }

        try {
            // Create Socket.IO server with CORS configuration
            this.io = new SocketIOServer(httpServer, {
                cors: {
                    origin: '*', // Configure appropriately for production
                    methods: ['GET', 'POST'],
                    credentials: true
                },
                path: '/socket.io',
                transports: ['websocket', 'polling']
            });

            // Setup authentication middleware
            this.io.use(async (socket, next) => {
                try {
                    const token = socket.handshake.auth.token || socket.handshake.query.token;
                    
                    if (!token) {
                        return next(new Error('Authentication token required'));
                    }

                    // Verify JWT token
                    const decoded = await this.authService.verifyToken(token as string);
                    
                    // Attach user info to socket
                    (socket.data as SocketAuthData) = {
                        user_id: decoded.user_id,
                        email: decoded.email,
                        token: token as string
                    };

                    next();
                } catch (error) {
                    logger.error(this.node, `[MARINE-WS] Authentication failed: ${(error as Error).message}`);
                    next(new Error('Authentication failed'));
                }
            });

            // Setup connection handling
            this.io.on('connection', (socket) => {
                this.handleConnection(socket);
            });

            // Start periodic update broadcaster
            this.startPeriodicUpdates();

            this.initialized = true;
            logger.info(this.node, '[MARINE-WS] ✅ WebSocket service initialized successfully');

        } catch (error) {
            const errorMessage = `Failed to initialize WebSocket service: ${(error as Error).message}`;
            logger.error(this.node, `[MARINE-WS] ${errorMessage}`);
            throw new Error(errorMessage);
        }
    }

    /**
     * Handle new client connection
     */
    private handleConnection(socket: Socket): void {
        const authData = socket.data as SocketAuthData;
        
        logger.info(this.node, `[MARINE-WS] Client connected`, {
            socketId: socket.id,
            userId: authData.user_id,
            email: authData.email
        });

        // Send connection confirmation
        socket.emit(MarineWebSocketEvents.CONNECTED, {
            socketId: socket.id,
            message: 'Connected to Marine IoT WebSocket',
            timestamp: Date.now()
        });

        // Subscribe to device telemetry
        socket.on(MarineWebSocketEvents.SUBSCRIBE_DEVICE, async (data: { deviceId: string; keys?: string[] }) => {
            await this.handleSubscribe(socket, data);
        });

        // Unsubscribe from device telemetry
        socket.on(MarineWebSocketEvents.UNSUBSCRIBE_DEVICE, (data: { deviceId: string }) => {
            this.handleUnsubscribe(socket, data.deviceId);
        });

        // Get latest telemetry on demand
        socket.on(MarineWebSocketEvents.GET_LATEST, async (data: { deviceId: string; keys?: string[] }) => {
            await this.handleGetLatest(socket, data);
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            this.handleDisconnect(socket);
        });

        // Handle errors
        socket.on('error', (error) => {
            logger.error(this.node, `[MARINE-WS] Socket error for ${socket.id}`, { error });
        });
    }

    /**
     * Handle device subscription
     */
    private async handleSubscribe(socket: Socket, data: { deviceId: string; keys?: string[] }): Promise<void> {
        const authData = socket.data as SocketAuthData;
        const { deviceId, keys } = data;

        try {
            // Create subscription
            const subscription: ClientSubscription = {
                socketId: socket.id,
                deviceId,
                userId: authData.user_id,
                keys
            };

            this.subscriptions.set(socket.id, subscription);

            // Add to device subscribers map
            if (!this.deviceSubscribers.has(deviceId)) {
                this.deviceSubscribers.set(deviceId, new Set());
            }
            this.deviceSubscribers.get(deviceId)!.add(socket.id);

            logger.info(this.node, `[MARINE-WS] Client subscribed to device`, {
                socketId: socket.id,
                deviceId,
                keys: keys || 'all',
                totalSubscribers: this.deviceSubscribers.get(deviceId)!.size
            });

            // Send confirmation
            socket.emit(MarineWebSocketEvents.SUBSCRIBED, {
                deviceId,
                keys: keys || 'all',
                timestamp: Date.now()
            });

            // Send initial data immediately
            await this.sendTelemetryUpdate(socket.id);

        } catch (error) {
            logger.error(this.node, `[MARINE-WS] Subscribe error`, {
                socketId: socket.id,
                deviceId,
                error: (error as Error).message
            });

            socket.emit(MarineWebSocketEvents.ERROR, {
                message: `Failed to subscribe: ${(error as Error).message}`,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle device unsubscription
     */
    private handleUnsubscribe(socket: Socket, deviceId: string): void {
        try {
            const subscription = this.subscriptions.get(socket.id);
            
            if (subscription && subscription.deviceId === deviceId) {
                this.subscriptions.delete(socket.id);
                
                const subscribers = this.deviceSubscribers.get(deviceId);
                if (subscribers) {
                    subscribers.delete(socket.id);
                    if (subscribers.size === 0) {
                        this.deviceSubscribers.delete(deviceId);
                    }
                }

                logger.info(this.node, `[MARINE-WS] Client unsubscribed from device`, {
                    socketId: socket.id,
                    deviceId
                });

                socket.emit(MarineWebSocketEvents.UNSUBSCRIBED, {
                    deviceId,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            logger.error(this.node, `[MARINE-WS] Unsubscribe error`, {
                socketId: socket.id,
                deviceId,
                error: (error as Error).message
            });
        }
    }

    /**
     * Handle get latest telemetry request
     */
    private async handleGetLatest(socket: Socket, data: { deviceId: string; keys?: string[] | string }): Promise<void> {
        try {
            const { deviceId, keys } = data;
            const keyArray = keys && typeof keys === 'string' ? keys.split(',').map(k => k.trim()) : (Array.isArray(keys) ? keys : undefined);

            const telemetry = await this.marineTelemetryService.getLatestTelemetry(deviceId, keyArray);

            socket.emit(MarineWebSocketEvents.TELEMETRY_UPDATE, {
                deviceId,
                data: telemetry,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(this.node, `[MARINE-WS] Get latest error`, {
                socketId: socket.id,
                error: (error as Error).message
            });

            socket.emit(MarineWebSocketEvents.ERROR, {
                message: `Failed to get latest telemetry: ${(error as Error).message}`,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle client disconnection
     */
    private handleDisconnect(socket: Socket): void {
        const subscription = this.subscriptions.get(socket.id);
        
        if (subscription) {
            const { deviceId } = subscription;
            
            // Remove from subscriptions
            this.subscriptions.delete(socket.id);
            
            // Remove from device subscribers
            const subscribers = this.deviceSubscribers.get(deviceId);
            if (subscribers) {
                subscribers.delete(socket.id);
                if (subscribers.size === 0) {
                    this.deviceSubscribers.delete(deviceId);
                }
            }

            logger.info(this.node, `[MARINE-WS] Client disconnected`, {
                socketId: socket.id,
                deviceId,
                remainingSubscribers: subscribers?.size || 0
            });
        }
    }

    /**
     * Start periodic telemetry updates
     * Sends updates to all subscribed clients every 2 seconds
     */
    private startPeriodicUpdates(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        // Update every 2 seconds for real-time feel
        this.updateInterval = setInterval(async () => {
            await this.broadcastTelemetryUpdates();
        }, 2000);

        logger.info(this.node, '[MARINE-WS] Periodic updates started (2s interval)');
    }

    /**
     * Broadcast telemetry updates to all subscribed clients
     */
    private async broadcastTelemetryUpdates(): Promise<void> {
        if (this.subscriptions.size === 0) {
            return; // No active subscriptions
        }

        // Group subscriptions by device to minimize queries
        const deviceQueries = new Map<string, Set<string>>();
        
        for (const subscription of this.subscriptions.values()) {
            if (!deviceQueries.has(subscription.deviceId)) {
                deviceQueries.set(subscription.deviceId, new Set());
            }
        }

        // Fetch and broadcast for each device
        for (const deviceId of deviceQueries.keys()) {
            const subscribers = this.deviceSubscribers.get(deviceId);
            if (subscribers && subscribers.size > 0) {
                for (const socketId of subscribers) {
                    await this.sendTelemetryUpdate(socketId);
                }
            }
        }
    }

    /**
     * Send telemetry update to a specific socket
     */
    private async sendTelemetryUpdate(socketId: string): Promise<void> {
        try {
            const subscription = this.subscriptions.get(socketId);
            if (!subscription || !this.io) {
                return;
            }

            const { deviceId, keys } = subscription;
            const telemetry = await this.marineTelemetryService.getLatestTelemetry(deviceId, keys);

            this.io.to(socketId).emit(MarineWebSocketEvents.TELEMETRY_UPDATE, {
                deviceId,
                data: telemetry,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(this.node, `[MARINE-WS] Failed to send telemetry update`, {
                socketId,
                error: (error as Error).message
            });
        }
    }

    /**
     * Manually trigger update for a specific device
     * Can be called when new telemetry data is received
     */
    async notifyDeviceUpdate(deviceId: string): Promise<void> {
        const subscribers = this.deviceSubscribers.get(deviceId);
        if (!subscribers || subscribers.size === 0) {
            return;
        }

        logger.debug(this.node, `[MARINE-WS] Notifying ${subscribers.size} subscribers for device ${deviceId}`);

        for (const socketId of subscribers) {
            await this.sendTelemetryUpdate(socketId);
        }
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            activeConnections: this.subscriptions.size,
            devicesMonitored: this.deviceSubscribers.size,
            deviceSubscriptions: Array.from(this.deviceSubscribers.entries()).map(([deviceId, subscribers]) => ({
                deviceId,
                subscriberCount: subscribers.size
            }))
        };
    }

    /**
     * Check if service is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        try {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            if (this.io) {
                // Disconnect all clients
                this.io.disconnectSockets();
                // Close server
                this.io.close();
                this.io = null;
            }

            this.subscriptions.clear();
            this.deviceSubscribers.clear();
            this.initialized = false;

            logger.info(this.node, '[MARINE-WS] WebSocket service cleaned up');
        } catch (error) {
            logger.error(this.node, `Error during database cleanup: ${(error as Error).message}`);
        }
    }

    /**
     * Empty initialize for IService interface compatibility
     * Actual initialization happens in initializeWithServer()
     */
    async initialize(): Promise<void> {
        // This is intentionally empty - use initializeWithServer() instead
        logger.debug(this.node, '[MARINE-WS] Base initialize() called - use initializeWithServer() for actual initialization');
    }
}
