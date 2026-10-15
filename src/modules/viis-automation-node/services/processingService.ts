import { Node } from "node-red";
import { DeviceIntent, DeviceLatestData } from "../../../core/type";
import { DeviceIntentService } from "../../../core/deviceIntents";
import { ServiceOptions, IntentProcessingResult, AutomationPayload } from "../interfaces/types";
import { Logger } from "../utils/logger";
import { ProtectionGateService, resolveProtectionGate } from "../../viis-device-protection/services/protection-gate-service";

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
    private protectionGate: ProtectionGateService | null = null;

    constructor(options: ServiceOptions) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(this.node, "PROCESSING");
    }

    /**
     * Set protection gate service for filtering intent actions
     */
    setProtectionGate(gate: ProtectionGateService): void {
        this.protectionGate = gate;
    }

    /** The explicitly set gate, else the live shared gate of `viis-device-protection` (if deployed). */
    private resolveGate(): ProtectionGateService | null {
        if (this.protectionGate) return this.protectionGate;
        try {
            return resolveProtectionGate(this.globalContext?.get?.('protectionGateService'));
        } catch {
            return null;
        }
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

            // Filter device actions through protection gate. Blocked actions are kept apart (not written)
            // so the scenario trigger event can report them.
            let filteredResults = results;
            const gate = this.resolveGate();
            if (gate) {
                filteredResults = results.map(result => {
                    const blockedActions: { device_id: string; key: string; value: any; reason: string }[] = [];
                    const allowedActions = result.device_actions.filter((action: any) => {
                        // Coil (on/off) actions only, as the RPC and schedule sources gate fc=5 writes only.
                        if (typeof action.value !== "boolean") return true;
                        const check = gate.checkGate(action.key, action.value, 'intent');
                        if (!check.allowed) {
                            blockedActions.push({ device_id: action.device_id, key: action.key, value: action.value, reason: check.reason });
                            this.logger.warn(`Intent action blocked: ${action.key}=${action.value} - ${check.reason}`);
                        }
                        return check.allowed;
                    });

                    if (blockedActions.length > 0) {
                        this.logger.log(`Protection blocked ${blockedActions.length}/${result.device_actions.length} intent actions`);
                    }

                    return {
                        ...result,
                        device_actions: allowedActions,
                        blocked_actions: blockedActions,
                    };
                });
            }

            this.node.status({
                fill: "green",
                shape: "dot",
                text: "Processing complete"
            });

            this.logger.log(`Processing complete. Generated ${filteredResults.length} results`);

            return filteredResults;
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
