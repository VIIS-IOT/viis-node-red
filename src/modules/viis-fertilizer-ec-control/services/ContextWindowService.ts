import { Node } from 'node-red';
import {
    ValveTimes,
    SensorReadings
} from '../interfaces/types';
import { EC_CONTROL_DEFAULTS } from '../constants';

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
export class ContextWindowService {
    private node: Node;

    // Configuration
    private readonly windowSize: number;
    private readonly adjustmentThreshold: number;
    private readonly adjustmentStep: number;
    private readonly maxValveTime: number;
    private readonly minValveTime: number;

    // Buffers
    private ecBuffer: number[] = [];
    private flowBuffers: {
        flow_1: number[];
        flow_2: number[];
        flow_3: number[];
        flow_4: number[];
        flow_5: number[];
    } = {
        flow_1: [],
        flow_2: [],
        flow_3: [],
        flow_4: [],
        flow_5: [],
    };

    // State
    private sampleCount: number = 0;
    private rampUpComplete: boolean = false;
    private rampUpEndTime: number = 0;

    constructor(
        node: Node,
        options?: {
            windowSize?: number;
            adjustmentThreshold?: number;
            adjustmentStep?: number;
            maxValveTime?: number;
            minValveTime?: number;
        }
    ) {
        this.node = node;
        this.windowSize = options?.windowSize ?? EC_CONTROL_DEFAULTS.CONTEXT_WINDOW_SIZE;
        this.adjustmentThreshold = options?.adjustmentThreshold ?? EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD;
        this.adjustmentStep = options?.adjustmentStep ?? EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP;
        this.maxValveTime = options?.maxValveTime ?? EC_CONTROL_DEFAULTS.MAX_VALVE_TIME;
        this.minValveTime = options?.minValveTime ?? EC_CONTROL_DEFAULTS.MIN_VALVE_TIME;
    }

    /**
     * Start a new irrigation run - resets all buffers
     */
    startRun(rampUpSeconds: number = EC_CONTROL_DEFAULTS.RAMP_UP_SECONDS): void {
        this.reset();
        this.rampUpEndTime = Date.now() + (rampUpSeconds * 1000);
        this.rampUpComplete = false;
        this.log(`Started context window. Ramp-up ends at ${new Date(this.rampUpEndTime).toISOString()}`);
    }

    /**
     * Add a sensor reading sample
     * Returns true if sample was added (after ramp-up), false if still in ramp-up
     */
    addSample(readings: SensorReadings): boolean {
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
    getAverageEc(): number {
        if (this.ecBuffer.length === 0) {
            return 0;
        }
        const sum = this.ecBuffer.reduce((a, b) => a + b, 0);
        return sum / this.ecBuffer.length;
    }

    /**
     * Get all flow averages
     */
    getFlowAverages(): { [key: string]: number } {
        return {
            flow_1: this.getFlowAverage('flow_1'),
            flow_2: this.getFlowAverage('flow_2'),
            flow_3: this.getFlowAverage('flow_3'),
            flow_4: this.getFlowAverage('flow_4'),
            flow_5: this.getFlowAverage('flow_5'),
        };
    }

    /**
     * Calculate EC deviation from target (for telemetry/monitoring only)
     * Does NOT adjust valve times - system uses feedforward + open-loop control
     */
    getEcDeviation(
        targetEc: number
    ): { deviation: number; avgEc: number } {
        const avgEc = this.getAverageEc();

        if (avgEc === 0 || this.ecBuffer.length < 5) {
            // Not enough samples yet
            return {
                deviation: 0,
                avgEc: 0,
            };
        }

        const deviation = avgEc - targetEc;

        return {
            deviation,
            avgEc,
        };
    }

    /**
     * Get statistics for the current run
     */
    getStats(): {
        sampleCount: number;
        ecBufferSize: number;
        avgEc: number;
        minEc: number;
        maxEc: number;
        stdDevEc: number;
        flowAverages: { [key: string]: number };
        rampUpComplete: boolean;
    } {
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
    isRampUpComplete(): boolean {
        if (this.rampUpComplete) return true;

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
    getRampUpRemaining(): number {
        if (this.rampUpComplete) return 0;
        const remaining = (this.rampUpEndTime - Date.now()) / 1000;
        return Math.max(0, remaining);
    }

    /**
     * Reset all buffers and state
     */
    reset(): void {
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

    private addFlowSample(key: keyof typeof this.flowBuffers, value: number): void {
        if (value === undefined || value === null) return;

        this.flowBuffers[key].push(value);
        if (this.flowBuffers[key].length > this.windowSize) {
            this.flowBuffers[key].shift();
        }
    }

    private getFlowAverage(key: keyof typeof this.flowBuffers): number {
        const buffer = this.flowBuffers[key];
        if (buffer.length === 0) return 0;
        return buffer.reduce((a, b) => a + b, 0) / buffer.length;
    }

    private clampValveTime(currentTime: number, adjustment: number): number {
        // Only adjust non-zero valve times
        if (currentTime === 0) return 0;

        const newTime = currentTime + adjustment;
        return Math.max(this.minValveTime, Math.min(this.maxValveTime, newTime));
    }

    private log(message: string): void {
        this.node.log(`[ContextWindow] ${message}`);
    }
}
