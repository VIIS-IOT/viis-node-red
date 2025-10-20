"use strict";
/**
 * @fileoverview Marine IoT WebSocket Service
 *
 * Real-time telemetry streaming for Marine IoT systems via WebSocket
 * Provides efficient push-based updates instead of polling
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarineWebSocketService = exports.MarineWebSocketEvents = void 0;
const typedi_1 = require("typedi");
const socket_io_1 = require("socket.io");
const marine_telemetry_service_1 = require("./marine-telemetry.service");
const auth_service_1 = require("./auth.service");
const logger_1 = require("../utils/logger");
/**
 * WebSocket event names
 */
var MarineWebSocketEvents;
(function (MarineWebSocketEvents) {
    // Client -> Server
    MarineWebSocketEvents["SUBSCRIBE_DEVICE"] = "marine:subscribe";
    MarineWebSocketEvents["UNSUBSCRIBE_DEVICE"] = "marine:unsubscribe";
    MarineWebSocketEvents["GET_LATEST"] = "marine:get_latest";
    // Server -> Client
    MarineWebSocketEvents["TELEMETRY_UPDATE"] = "marine:telemetry";
    MarineWebSocketEvents["ERROR"] = "marine:error";
    MarineWebSocketEvents["CONNECTED"] = "marine:connected";
    MarineWebSocketEvents["SUBSCRIBED"] = "marine:subscribed";
    MarineWebSocketEvents["UNSUBSCRIBED"] = "marine:unsubscribed";
})(MarineWebSocketEvents || (exports.MarineWebSocketEvents = MarineWebSocketEvents = {}));
/**
 * Marine WebSocket Service
 * Handles real-time telemetry streaming via Socket.IO
 */
let MarineWebSocketService = class MarineWebSocketService {
    constructor(marineTelemetryService, authService, node) {
        this.marineTelemetryService = marineTelemetryService;
        this.authService = authService;
        this.node = node;
        this.io = null;
        this.subscriptions = new Map();
        this.deviceSubscribers = new Map(); // deviceId -> Set<socketId>
        this.updateInterval = null;
        this.initialized = false;
    }
    /**
     * Initialize WebSocket server
     * Note: This overrides IService.initialize() which takes no parameters
     * Call this separately after constructing the service
     */
    async initializeWithServer(httpServer) {
        if (this.initialized) {
            logger_1.logger.warn(this.node, '[MARINE-WS] WebSocket already initialized');
            return;
        }
        try {
            // Create Socket.IO server with CORS configuration
            this.io = new socket_io_1.Server(httpServer, {
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
                    const decoded = await this.authService.verifyToken(token);
                    // Attach user info to socket
                    socket.data = {
                        user_id: decoded.user_id,
                        email: decoded.email,
                        token: token
                    };
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `[MARINE-WS] Authentication failed: ${error.message}`);
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
            logger_1.logger.info(this.node, '[MARINE-WS] ✅ WebSocket service initialized successfully');
        }
        catch (error) {
            const errorMessage = `Failed to initialize WebSocket service: ${error.message}`;
            logger_1.logger.error(this.node, `[MARINE-WS] ${errorMessage}`);
            throw new Error(errorMessage);
        }
    }
    /**
     * Handle new client connection
     */
    handleConnection(socket) {
        const authData = socket.data;
        logger_1.logger.info(this.node, `[MARINE-WS] Client connected`, {
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
        socket.on(MarineWebSocketEvents.SUBSCRIBE_DEVICE, async (data) => {
            await this.handleSubscribe(socket, data);
        });
        // Unsubscribe from device telemetry
        socket.on(MarineWebSocketEvents.UNSUBSCRIBE_DEVICE, (data) => {
            this.handleUnsubscribe(socket, data.deviceId);
        });
        // Get latest telemetry on demand
        socket.on(MarineWebSocketEvents.GET_LATEST, async (data) => {
            await this.handleGetLatest(socket, data);
        });
        // Handle disconnection
        socket.on('disconnect', () => {
            this.handleDisconnect(socket);
        });
        // Handle errors
        socket.on('error', (error) => {
            logger_1.logger.error(this.node, `[MARINE-WS] Socket error for ${socket.id}`, { error });
        });
    }
    /**
     * Handle device subscription
     */
    async handleSubscribe(socket, data) {
        const authData = socket.data;
        const { deviceId, keys } = data;
        try {
            // Create subscription
            const subscription = {
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
            this.deviceSubscribers.get(deviceId).add(socket.id);
            logger_1.logger.info(this.node, `[MARINE-WS] Client subscribed to device`, {
                socketId: socket.id,
                deviceId,
                keys: keys || 'all',
                totalSubscribers: this.deviceSubscribers.get(deviceId).size
            });
            // Send confirmation
            socket.emit(MarineWebSocketEvents.SUBSCRIBED, {
                deviceId,
                keys: keys || 'all',
                timestamp: Date.now()
            });
            // Send initial data immediately
            await this.sendTelemetryUpdate(socket.id);
        }
        catch (error) {
            logger_1.logger.error(this.node, `[MARINE-WS] Subscribe error`, {
                socketId: socket.id,
                deviceId,
                error: error.message
            });
            socket.emit(MarineWebSocketEvents.ERROR, {
                message: `Failed to subscribe: ${error.message}`,
                timestamp: Date.now()
            });
        }
    }
    /**
     * Handle device unsubscription
     */
    handleUnsubscribe(socket, deviceId) {
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
                logger_1.logger.info(this.node, `[MARINE-WS] Client unsubscribed from device`, {
                    socketId: socket.id,
                    deviceId
                });
                socket.emit(MarineWebSocketEvents.UNSUBSCRIBED, {
                    deviceId,
                    timestamp: Date.now()
                });
            }
        }
        catch (error) {
            logger_1.logger.error(this.node, `[MARINE-WS] Unsubscribe error`, {
                socketId: socket.id,
                deviceId,
                error: error.message
            });
        }
    }
    /**
     * Handle get latest telemetry request
     */
    async handleGetLatest(socket, data) {
        try {
            const { deviceId, keys } = data;
            const keyArray = keys && typeof keys === 'string' ? keys.split(',').map(k => k.trim()) : (Array.isArray(keys) ? keys : undefined);
            const telemetry = await this.marineTelemetryService.getLatestTelemetry(deviceId, keyArray);
            socket.emit(MarineWebSocketEvents.TELEMETRY_UPDATE, {
                deviceId,
                data: telemetry,
                timestamp: Date.now()
            });
        }
        catch (error) {
            logger_1.logger.error(this.node, `[MARINE-WS] Get latest error`, {
                socketId: socket.id,
                error: error.message
            });
            socket.emit(MarineWebSocketEvents.ERROR, {
                message: `Failed to get latest telemetry: ${error.message}`,
                timestamp: Date.now()
            });
        }
    }
    /**
     * Handle client disconnection
     */
    handleDisconnect(socket) {
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
            logger_1.logger.info(this.node, `[MARINE-WS] Client disconnected`, {
                socketId: socket.id,
                deviceId,
                remainingSubscribers: (subscribers === null || subscribers === void 0 ? void 0 : subscribers.size) || 0
            });
        }
    }
    /**
     * Start periodic telemetry updates
     * Sends updates to all subscribed clients every 2 seconds
     */
    startPeriodicUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        // Update every 2 seconds for real-time feel
        this.updateInterval = setInterval(async () => {
            await this.broadcastTelemetryUpdates();
        }, 2000);
        logger_1.logger.info(this.node, '[MARINE-WS] Periodic updates started (2s interval)');
    }
    /**
     * Broadcast telemetry updates to all subscribed clients
     */
    async broadcastTelemetryUpdates() {
        if (this.subscriptions.size === 0) {
            return; // No active subscriptions
        }
        // Group subscriptions by device to minimize queries
        const deviceQueries = new Map();
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
    async sendTelemetryUpdate(socketId) {
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
        }
        catch (error) {
            logger_1.logger.error(this.node, `[MARINE-WS] Failed to send telemetry update`, {
                socketId,
                error: error.message
            });
        }
    }
    /**
     * Manually trigger update for a specific device
     * Can be called when new telemetry data is received
     */
    async notifyDeviceUpdate(deviceId) {
        const subscribers = this.deviceSubscribers.get(deviceId);
        if (!subscribers || subscribers.size === 0) {
            return;
        }
        logger_1.logger.debug(this.node, `[MARINE-WS] Notifying ${subscribers.size} subscribers for device ${deviceId}`);
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
    isInitialized() {
        return this.initialized;
    }
    /**
     * Cleanup resources
     */
    async cleanup() {
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
            logger_1.logger.info(this.node, '[MARINE-WS] WebSocket service cleaned up');
        }
        catch (error) {
            logger_1.logger.error(this.node, `Error during database cleanup: ${error.message}`);
        }
    }
    /**
     * Empty initialize for IService interface compatibility
     * Actual initialization happens in initializeWithServer()
     */
    async initialize() {
        // This is intentionally empty - use initializeWithServer() instead
        logger_1.logger.debug(this.node, '[MARINE-WS] Base initialize() called - use initializeWithServer() for actual initialization');
    }
};
exports.MarineWebSocketService = MarineWebSocketService;
exports.MarineWebSocketService = MarineWebSocketService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [marine_telemetry_service_1.MarineTelemetryService,
        auth_service_1.AuthService, Object])
], MarineWebSocketService);
