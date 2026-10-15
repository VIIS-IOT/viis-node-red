import { Node } from "node-red";
import { DeviceIntent, DeviceLatestData } from "../../../core/type";
import { IntentService } from "../services/intentService";
import { ProcessingService } from "../services/processingService";
import { MqttAutomationService } from "../services/mqttService";
import {
    ServiceOptions,
    InputMessage,
    IntentProcessingResult
} from "../interfaces/types";
import { Logger } from "../utils/logger";
import { ScenarioTriggerReporter } from "../services/scenarioTriggerTracker";
import { SCENARIO_TRIGGER_BATCH_PROP } from "../services/scenarioTriggerEvents";

/**
 * Main handler for automation node logic
 * Coordinates between services and manages node behavior
 */
export class AutomationHandler {
    private node: Node;
    private flowContext: any;
    private globalContext: any;
    private logger: Logger;
    private intentService: IntentService;
    private processingService: ProcessingService;
    private mqttService: MqttAutomationService;
    private scenarioTriggers: ScenarioTriggerReporter | null;

    constructor(
        options: ServiceOptions,
        intentService: IntentService,
        processingService: ProcessingService,
        mqttService: MqttAutomationService,
        scenarioTriggers: ScenarioTriggerReporter | null = null
    ) {
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(this.node, "HANDLER");
        this.intentService = intentService;
        this.processingService = processingService;
        this.mqttService = mqttService;
        this.scenarioTriggers = scenarioTriggers;
    }

    /**
     * Handle MQTT connection status change
     */
    async handleMqttStatus(status: string, error?: string): Promise<void> {
        try {
            switch (status) {
                case "connected":
                    this.logger.log("MQTT connected - syncing intents");
                    this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                    await this.syncIntents();
                    break;

                case "disconnected":
                    this.logger.warn("MQTT disconnected");
                    this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                    break;

                case "error":
                    this.logger.error(`MQTT error: ${error}`);
                    this.node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Error: ${error}`
                    });
                    break;

                default:
                    this.logger.warn(`Unknown MQTT status: ${status}`);
            }
        } catch (error) {
            this.logger.error(`Error handling MQTT status: ${(error as Error).message}`);
        }
    }

    /**
     * Handle MQTT message received
     */
    async handleMqttMessage(message: any): Promise<void> {
        try {
            this.logger.log(`Received MQTT message: ${JSON.stringify(message)}`);

            if (message.method === "update_intents") {
                this.logger.log("Received update_intents command");
                await this.syncIntents();
            } else if (["set", "control", "set_state", "set_state_batch"].includes(String(message.method || "").toLowerCase())) {
                // Shared rpc/+ subscription — device writes belong to viis-rpc-control.
                return;
            } else {
                this.logger.warn(`Unknown message method: ${message.method}`);
            }
        } catch (error) {
            this.logger.error(`Error handling MQTT message: ${(error as Error).message}`);
        }
    }

    /**
     * Handle input message for automation processing
     */
    async handleInput(msg: InputMessage): Promise<void> {
        try {
            // Get intents from context or message
            let intents = this.intentService.getIntentsFromContext();
            const manualIntents: DeviceIntent[] = msg.payload?.intents || [];

            if (manualIntents.length > 0) {
                this.logger.log(`Using ${manualIntents.length} manual intents from input`);
                intents = manualIntents;
            }

            // Get device data from message
            const devicesData: DeviceLatestData[] = msg.payload?.devices_data || [];

            if (devicesData.length === 0) {
                this.logger.warn("No device data provided in input message");
                return;
            }

            // Process intents
            await this.processAutomation(intents, devicesData);

        } catch (error) {
            this.logger.error(`Error handling input: ${(error as Error).message}`);
            this.node.status({
                fill: "red",
                shape: "ring",
                text: `Input error: ${(error as Error).message}`
            });
        }
    }

    /**
     * Sync intents from server and send to output
     */
    async syncIntents(): Promise<void> {
        try {
            const intents = await this.intentService.syncIntents();
            if (intents === null) {
                // Output 2 is read as the server's authoritative list; on a failed fetch send nothing.
                this.logger.warn("Intent sync failed; local intents kept");
                return;
            }

            // Send intents to output 2
            this.node.send([
                null,
                {
                    payload: intents
                }
            ]);

            this.logger.log(`Synced and sent ${intents.length} intents to output 2`);
        } catch (error) {
            this.logger.error(`Sync intents failed: ${(error as Error).message}`);
        }
    }

    /**
     * Process automation with intents and device data
     */
    async processAutomation(
        intents: DeviceIntent[],
        devicesData: DeviceLatestData[]
    ): Promise<void> {
        try {
            // Process intents
            const results: IntentProcessingResult[] = await this.processingService.processIntents(
                intents,
                devicesData
            );

            // Build output payload
            const payload = this.processingService.buildSuccessPayload(
                intents,
                devicesData,
                results
            );

            // Scenario trigger events (ADR-035): register this evaluation's triggers before the writes start.
            // onEvaluation never throws; the event itself is sent asynchronously.
            const outMsg: Record<string, any> = { payload };
            const batchId = this.scenarioTriggers
                ? this.scenarioTriggers.onEvaluation(intents, devicesData, results)
                : null;
            if (batchId) {
                // The flow's "Intent actions -> Modbus commands" copies this onto every write command.
                outMsg[SCENARIO_TRIGGER_BATCH_PROP] = batchId;
            }

            // Send to output 1
            this.node.send([
                outMsg,
                null
            ]);

            this.logger.log(`Processed automation with ${results.length} results`);
        } catch (error) {
            this.logger.error(`Process automation failed: ${(error as Error).message}`);

            // Send error to output 1
            const errorPayload = this.processingService.buildErrorPayload(error as Error);
            this.node.send([
                { payload: errorPayload },
                null
            ]);
        }
    }

    /**
     * Cleanup handler resources
     */
    cleanup(): void {
        try {
            this.intentService.clearIntents();
            this.mqttService.cleanup();
            this.logger.log("Automation handler cleanup complete");
        } catch (error) {
            this.logger.error(`Cleanup error: ${(error as Error).message}`);
        }
    }
}
