"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextWindowService = void 0;
const constants_1 = require("../constants");
/**
 * ContextWindowService
 *
 * Implements the 20-second context window for real-time EC averaging
 * and adaptive valve time adjustment during irrigation runs.
 *
 * Features:
 * - Circular buffer for EC samples (default: 20 samples at 1s intervals)
 * - Flow rate averaging per valve
 * - Adaptive adjustment calculation (±50ms per 0.05 EC deviation)
 * - Ramp-up period skipping (first 20 seconds ignored)
 */
class ContextWindowService {
    constructor(node, options) {
        var _a, _b, _c, _d, _e;
        // Buffers
        this.ecBuffer = [];
        this.flowBuffers = {
            flow_1: [],
            flow_2: [],
            flow_3: [],
            flow_4: [],
            flow_5: [],
        };
        // State
        this.sampleCount = 0;
        this.rampUpComplete = false;
        this.rampUpEndTime = 0;
        this.node = node;
        this.windowSize = (_a = options === null || options === void 0 ? void 0 : options.windowSize) !== null && _a !== void 0 ? _a : constants_1.EC_CONTROL_DEFAULTS.CONTEXT_WINDOW_SIZE;
        this.adjustmentThreshold = (_b = options === null || options === void 0 ? void 0 : options.adjustmentThreshold) !== null && _b !== void 0 ? _b : constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD;
        this.adjustmentStep = (_c = options === null || options === void 0 ? void 0 : options.adjustmentStep) !== null && _c !== void 0 ? _c : constants_1.EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP;
        this.maxValveTime = (_d = options === null || options === void 0 ? void 0 : options.maxValveTime) !== null && _d !== void 0 ? _d : constants_1.EC_CONTROL_DEFAULTS.MAX_VALVE_TIME;
        this.minValveTime = (_e = options === null || options === void 0 ? void 0 : options.minValveTime) !== null && _e !== void 0 ? _e : constants_1.EC_CONTROL_DEFAULTS.MIN_VALVE_TIME;
    }
    /**
     * Start a new irrigation run - resets all buffers
     */
    startRun(rampUpSeconds = constants_1.EC_CONTROL_DEFAULTS.RAMP_UP_SECONDS) {
        this.reset();
        this.rampUpEndTime = Date.now() + (rampUpSeconds * 1000);
        this.rampUpComplete = false;
        this.log(`Started context window. Ramp-up ends at ${new Date(this.rampUpEndTime).toISOString()}`);
    }
    /**
     * Add a sensor reading sample
     * Returns true if sample was added (after ramp-up), false if still in ramp-up
     */
    addSample(readings) {
        const now = Date.now();
        // Check if still in ramp-up period
        if (!this.rampUpComplete) {
            if (now < this.rampUpEndTime) {
                // Still in ramp-up, don't add to buffer
                return false;
            }
            this.rampUpComplete = true;
            this.log('Ramp-up complete. Starting EC/flow collection.');
        }
        // Add EC sample
        this.ecBuffer.push(readings.current_ec);
        if (this.ecBuffer.length > this.windowSize) {
            this.ecBuffer.shift();
        }
        // Add flow samples
        this.addFlowSample('flow_1', readings.current_flow_1);
        this.addFlowSample('flow_2', readings.current_flow_2);
        this.addFlowSample('flow_3', readings.current_flow_3);
        this.addFlowSample('flow_4', readings.current_flow_4);
        this.addFlowSample('flow_5', readings.current_flow_5);
        this.sampleCount++;
        return true;
    }
    /**
     * Get the current average EC from the context window
     */
    getAverageEc() {
        if (this.ecBuffer.length === 0) {
            return 0;
        }
        const sum = this.ecBuffer.reduce((a, b) => a + b, 0);
        return sum / this.ecBuffer.length;
    }
    /**
     * Get all flow averages
     */
    getFlowAverages() {
        return {
            flow_1: this.getFlowAverage('flow_1'),
            flow_2: this.getFlowAverage('flow_2'),
            flow_3: this.getFlowAverage('flow_3'),
            flow_4: this.getFlowAverage('flow_4'),
            flow_5: this.getFlowAverage('flow_5'),
        };
    }
    /**
     * Calculate valve time adjustment based on EC deviation
     * Returns new valve times (or original if no adjustment needed)
     */
    calculateAdjustment(targetEc, currentValveTimes) {
        const avgEc = this.getAverageEc();
        if (avgEc === 0 || this.ecBuffer.length < 5) {
            // Not enough samples yet
            return {
                adjusted: false,
                valveTimes: currentValveTimes,
                deviation: 0,
            };
        }
        const deviation = avgEc - targetEc;
        // Check if deviation exceeds threshold
        if (Math.abs(deviation) <= this.adjustmentThreshold) {
            return {
                adjusted: false,
                valveTimes: currentValveTimes,
                deviation,
            };
        }
        // Calculate adjustment
        // If EC too high (positive deviation), reduce valve times
        // If EC too low (negative deviation), increase valve times
        const adjustment = deviation > 0
            ? -this.adjustmentStep
            : this.adjustmentStep;
        // Apply adjustment to all non-zero valve times
        const newValveTimes = {
            time_on_valve_01: this.clampValveTime(currentValveTimes.time_on_valve_01, adjustment),
            time_on_valve_02: this.clampValveTime(currentValveTimes.time_on_valve_02, adjustment),
            time_on_valve_03: this.clampValveTime(currentValveTimes.time_on_valve_03, adjustment),
            time_on_valve_04: this.clampValveTime(currentValveTimes.time_on_valve_04, adjustment),
            time_on_valve_05: this.clampValveTime(currentValveTimes.time_on_valve_05, adjustment),
        };
        this.log(`EC deviation: ${deviation.toFixed(3)} mS/cm. Adjusting valve times by ${adjustment}ms`);
        return {
            adjusted: true,
            valveTimes: newValveTimes,
            deviation,
        };
    }
    /**
     * Get statistics for the current run
     */
    getStats() {
        const avgEc = this.getAverageEc();
        const minEc = this.ecBuffer.length > 0 ? Math.min(...this.ecBuffer) : 0;
        const maxEc = this.ecBuffer.length > 0 ? Math.max(...this.ecBuffer) : 0;
        // Calculate standard deviation
        let stdDevEc = 0;
        if (this.ecBuffer.length > 1) {
            const variance = this.ecBuffer.reduce((sum, val) => sum + Math.pow(val - avgEc, 2), 0) / this.ecBuffer.length;
            stdDevEc = Math.sqrt(variance);
        }
        return {
            sampleCount: this.sampleCount,
            ecBufferSize: this.ecBuffer.length,
            avgEc,
            minEc,
            maxEc,
            stdDevEc,
            flowAverages: this.getFlowAverages(),
            rampUpComplete: this.rampUpComplete,
        };
    }
    /**
     * Check if ramp-up period is complete
     */
    isRampUpComplete() {
        if (this.rampUpComplete)
            return true;
        const now = Date.now();
        if (now >= this.rampUpEndTime) {
            this.rampUpComplete = true;
            return true;
        }
        return false;
    }
    /**
     * Get remaining ramp-up time in seconds
     */
    getRampUpRemaining() {
        if (this.rampUpComplete)
            return 0;
        const remaining = (this.rampUpEndTime - Date.now()) / 1000;
        return Math.max(0, remaining);
    }
    /**
     * Reset all buffers and state
     */
    reset() {
        this.ecBuffer = [];
        this.flowBuffers = {
            flow_1: [],
            flow_2: [],
            flow_3: [],
            flow_4: [],
            flow_5: [],
        };
        this.sampleCount = 0;
        this.rampUpComplete = false;
        this.rampUpEndTime = 0;
    }
    // ========================================
    // Private Helper Methods
    // ========================================
    addFlowSample(key, value) {
        if (value === undefined || value === null)
            return;
        this.flowBuffers[key].push(value);
        if (this.flowBuffers[key].length > this.windowSize) {
            this.flowBuffers[key].shift();
        }
    }
    getFlowAverage(key) {
        const buffer = this.flowBuffers[key];
        if (buffer.length === 0)
            return 0;
        return buffer.reduce((a, b) => a + b, 0) / buffer.length;
    }
    clampValveTime(currentTime, adjustment) {
        // Only adjust non-zero valve times
        if (currentTime === 0)
            return 0;
        const newTime = currentTime + adjustment;
        return Math.max(this.minValveTime, Math.min(this.maxValveTime, newTime));
    }
    log(message) {
        this.node.log(`[ContextWindow] ${message}`);
    }
}
exports.ContextWindowService = ContextWindowService;
