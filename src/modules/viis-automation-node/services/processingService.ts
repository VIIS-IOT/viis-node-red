import { Node } from "node-red";
import { DeviceIntent, DeviceLatestData } from "../../../core/type";
import { DeviceIntentService } from "../../../core/deviceIntents";
import { ServiceOptions, IntentProcessingResult, AutomationPayload } from "../interfaces/types";
import { Logger } from "../utils/logger";

/**
 * Service for processing automation intents
 * - Evaluates intent conditions
 * - Generates device actions
 * - Manages processing state
 */
export class ProcessingService {
    private node: Node;
    private flowContext: any;
    private globalContext: any;
    private logger: Logger;

    constructor(options: ServiceOptions) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(this.node, "PROCESSING");
    }

    /**
     * Process automation intents with device data
     */
    async processIntents(
        intents: DeviceIntent[],
        devicesData: DeviceLatestData[]
    ): Promise<IntentProcessingResult[]> {
        try {
            this.logger.log(`Processing ${intents.length} intents with ${devicesData.length} devices`);

            this.node.status({
                fill: "blue",
                shape: "dot",
                text: "Processing intents..."
            });

            // Use existing DeviceIntentService for logic
            const intentService = new DeviceIntentService(intents, devicesData);
            const results = await intentService.processDeviceIntents() as IntentProcessingResult[];

            this.node.status({
                fill: "green",
                shape: "dot",
                text: "Processing complete"
            });

            this.logger.log(`Processing complete. Generated ${results.length} results`);

            return results;
        } catch (error) {
            this.logger.error(`Intent processing failed: ${(error as Error).message}`);

            this.node.status({
                fill: "yellow",
                shape: "ring",
                text: `Processing error: ${(error as Error).message}`
            });

            throw error;
        }
    }

    /**
     * Build output payload for successful processing
     */
    buildSuccessPayload(
        intents: DeviceIntent[],
        devicesData: DeviceLatestData[],
        results: IntentProcessingResult[]
    ): AutomationPayload {
        return {
            intents,
            devices_data: devicesData,
            results
        };
    }

    /**
     * Build output payload for error
     */
    buildErrorPayload(error: Error): any {
        return {
            error: true,
            message: error.message,
            timestamp: Date.now()
        };
    }
}
