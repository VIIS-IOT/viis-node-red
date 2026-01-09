import { Node } from "node-red";
import { DeviceIntent } from "../../../core/type";
import { getDeviceIntentsByToken } from "../../../core/device";
import { ServiceOptions, DeviceCredentials } from "../interfaces/types";
import { Logger } from "../utils/logger";

/**
 * Service for managing device intents
 * - Fetches intents from server
 * - Manages intent cache in node context
 * - Handles intent updates
 */
export class IntentService {
    private node: Node;
    private flowContext: any;
    private globalContext: any;
    private logger: Logger;
    private credentials: DeviceCredentials;

    constructor(
        options: ServiceOptions,
        credentials: DeviceCredentials
    ) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(this.node, "INTENT");
        this.credentials = credentials;
    }

    /**
     * Fetch intents from server using device access token
     */
    async fetchIntentsFromServer(): Promise<DeviceIntent[]> {
        try {
            this.logger.log(`Fetching intents for device: ${this.credentials.id}`);

            const intents = await getDeviceIntentsByToken(this.credentials.accessToken);

            this.logger.log(`Fetched ${intents ? intents.length : 0} intents from server`);

            return intents || [];
        } catch (error) {
            this.logger.error(`Failed to fetch intents: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Save intents to node context
     */
    saveIntentsToContext(intents: DeviceIntent[]): void {
        try {
            this.node.context().set("intents", intents);
            this.logger.log(`Saved ${intents.length} intents to context`);
        } catch (error) {
            this.logger.error(`Failed to save intents to context: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Get intents from node context
     */
    getIntentsFromContext(): DeviceIntent[] {
        try {
            const intents = this.node.context().get("intents") as DeviceIntent[];
            return intents || [];
        } catch (error) {
            this.logger.error(`Failed to get intents from context: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Sync intents from server and update context
     * Returns the fetched intents
     */
    async syncIntents(): Promise<DeviceIntent[]> {
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
        } catch (error) {
            this.logger.error(`Intent sync failed: ${(error as Error).message}`);

            this.node.status({
                fill: "yellow",
                shape: "ring",
                text: `Sync error: ${(error as Error).message}`
            });

            // Return cached intents on error
            return this.getIntentsFromContext();
        }
    }

    /**
     * Clear intents from context
     */
    clearIntents(): void {
        try {
            this.node.context().set("intents", []);
            this.logger.log("Cleared intents from context");
        } catch (error) {
            this.logger.error(`Failed to clear intents: ${(error as Error).message}`);
        }
    }
}
