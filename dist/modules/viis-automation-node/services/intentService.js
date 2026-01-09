"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentService = void 0;
const device_1 = require("../../../core/device");
const logger_1 = require("../utils/logger");
/**
 * Service for managing device intents
 * - Fetches intents from server
 * - Manages intent cache in node context
 * - Handles intent updates
 */
class IntentService {
    constructor(options, credentials) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(this.node, "INTENT");
        this.credentials = credentials;
    }
    /**
     * Fetch intents from server using device access token
     */
    async fetchIntentsFromServer() {
        try {
            this.logger.log(`Fetching intents for device: ${this.credentials.id}`);
            const intents = await (0, device_1.getDeviceIntentsByToken)(this.credentials.accessToken, this.node.context());
            this.logger.log(`Fetched ${intents ? intents.length : 0} intents from server`);
            return intents || [];
        }
        catch (error) {
            this.logger.error(`Failed to fetch intents: ${error.message}`);
            throw error;
        }
    }
    /**
     * Save intents to node context
     */
    saveIntentsToContext(intents) {
        try {
            this.node.context().set("intents", intents);
            this.logger.log(`Saved ${intents.length} intents to context`);
        }
        catch (error) {
            this.logger.error(`Failed to save intents to context: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get intents from node context
     */
    getIntentsFromContext() {
        try {
            const intents = this.node.context().get("intents");
            return intents || [];
        }
        catch (error) {
            this.logger.error(`Failed to get intents from context: ${error.message}`);
            return [];
        }
    }
    /**
     * Sync intents from server and update context
     * Returns the fetched intents
     */
    async syncIntents() {
        try {
            this.node.status({
                fill: "blue",
                shape: "dot",
                text: "Syncing intents..."
            });
            const intents = await this.fetchIntentsFromServer();
            this.saveIntentsToContext(intents);
            this.node.status({
                fill: "green",
                shape: "dot",
                text: `Loaded ${intents.length} intents`
            });
            return intents;
        }
        catch (error) {
            this.logger.error(`Intent sync failed: ${error.message}`);
            this.node.status({
                fill: "yellow",
                shape: "ring",
                text: `Sync error: ${error.message}`
            });
            // Return cached intents on error
            return this.getIntentsFromContext();
        }
    }
    /**
     * Clear intents from context
     */
    clearIntents() {
        try {
            this.node.context().set("intents", []);
            this.logger.log("Cleared intents from context");
        }
        catch (error) {
            this.logger.error(`Failed to clear intents: ${error.message}`);
        }
    }
}
exports.IntentService = IntentService;
