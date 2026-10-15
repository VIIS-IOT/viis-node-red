"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingService = void 0;
const deviceIntents_1 = require("../../../core/deviceIntents");
const logger_1 = require("../utils/logger");
const protection_gate_service_1 = require("../../viis-device-protection/services/protection-gate-service");
/**
 * Service for processing automation intents
 * - Evaluates intent conditions
 * - Generates device actions
 * - Manages processing state
 */
class ProcessingService {
    constructor(options) {
        this.protectionGate = null;
        this.node = options.node;
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(this.node, "PROCESSING");
    }
    /**
     * Set protection gate service for filtering intent actions
     */
    setProtectionGate(gate) {
        this.protectionGate = gate;
    }
    /** The explicitly set gate, else the live shared gate of `viis-device-protection` (if deployed). */
    resolveGate() {
        var _a, _b;
        if (this.protectionGate)
            return this.protectionGate;
        try {
            return (0, protection_gate_service_1.resolveProtectionGate)((_b = (_a = this.globalContext) === null || _a === void 0 ? void 0 : _a.get) === null || _b === void 0 ? void 0 : _b.call(_a, 'protectionGateService'));
        }
        catch (_c) {
            return null;
        }
    }
    /**
     * Process automation intents with device data
     */
    async processIntents(intents, devicesData) {
        try {
            this.logger.log(`Processing ${intents.length} intents with ${devicesData.length} devices`);
            this.node.status({
                fill: "blue",
                shape: "dot",
                text: "Processing intents..."
            });
            // Use existing DeviceIntentService for logic
            const intentService = new deviceIntents_1.DeviceIntentService(intents, devicesData);
            const results = await intentService.processDeviceIntents();
            // Filter device actions through protection gate. Blocked actions are kept apart (not written)
            // so the scenario trigger event can report them.
            let filteredResults = results;
            const gate = this.resolveGate();
            if (gate) {
                filteredResults = results.map(result => {
                    const blockedActions = [];
                    const allowedActions = result.device_actions.filter((action) => {
                        // Coil (on/off) actions only, as the RPC and schedule sources gate fc=5 writes only.
                        if (typeof action.value !== "boolean")
                            return true;
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
                    return Object.assign(Object.assign({}, result), { device_actions: allowedActions, blocked_actions: blockedActions });
                });
            }
            this.node.status({
                fill: "green",
                shape: "dot",
                text: "Processing complete"
            });
            this.logger.log(`Processing complete. Generated ${filteredResults.length} results`);
            return filteredResults;
        }
        catch (error) {
            this.logger.error(`Intent processing failed: ${error.message}`);
            this.node.status({
                fill: "yellow",
                shape: "ring",
                text: `Processing error: ${error.message}`
            });
            throw error;
        }
    }
    /**
     * Build output payload for successful processing
     */
    buildSuccessPayload(intents, devicesData, results) {
        return {
            intents,
            devices_data: devicesData,
            results
        };
    }
    /**
     * Build output payload for error
     */
    buildErrorPayload(error) {
        return {
            error: true,
            message: error.message,
            timestamp: Date.now()
        };
    }
}
exports.ProcessingService = ProcessingService;
