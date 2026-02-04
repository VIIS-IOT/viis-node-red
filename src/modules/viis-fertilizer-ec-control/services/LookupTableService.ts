import { Node, NodeContext } from 'node-red';
import { Repository, DataSource } from 'typeorm';
import { TabiotFertilizerLookupPoint } from '../../../orm/entities/fertilizer/TabiotFertilizerLookupPoint';
import { DataSourceManager } from '../../../orm/dataSource';
import {
    LookupPoint,
    ValveTimes,
    InterpolationResult
} from '../interfaces/types';
import {
    EC_CONTROL_DEFAULTS,
    LOOKUP_DATA_TYPE
} from '../constants';

/**
 * LookupTableService
 *
 * Manages the fertilizer EC → valve time lookup table.
 * Provides:
 * - Linear interpolation between known EC points
 * - CRUD operations for lookup points
 * - Weighted average updates for learning
 * - Sync status tracking
 */
export class LookupTableService {
    private node: Node;
    private deviceId: string;
    private dataSource: DataSource | null = null;
    private repository: Repository<TabiotFertilizerLookupPoint> | null = null;

    constructor(node: Node, deviceId: string) {
        this.node = node;
        this.deviceId = deviceId;
    }

    /**
     * Initialize database connection
     */
    async initialize(nodeContext?: NodeContext): Promise<void> {
        try {
            this.dataSource = await DataSourceManager.acquire(nodeContext);
            this.repository = this.dataSource.getRepository(TabiotFertilizerLookupPoint);
            this.log('LookupTableService initialized');
        } catch (error) {
            this.error(`Failed to initialize LookupTableService: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Release database connection
     */
    async destroy(): Promise<void> {
        await DataSourceManager.release();
        this.dataSource = null;
        this.repository = null;
    }

    /**
     * Get valve times for a target EC using interpolation
     */
    async getValveTimesForEc(targetEc: number): Promise<InterpolationResult> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        // Get all lookup points for this device, sorted by EC
        const points = await this.repository.find({
            where: { device_id: this.deviceId },
            order: { ec_setpoint: 'ASC' },
        });

        if (points.length === 0) {
            this.warn(`No lookup points found for device ${this.deviceId}. Using defaults.`);
            return {
                valveTimes: this.getDefaultValveTimes(),
                interpolated: false,
                confidence: 'default',
            };
        }

        // Find exact match
        const exactMatch = points.find(p => Math.abs(Number(p.ec_setpoint) - targetEc) < 0.001);
        if (exactMatch) {
            return {
                valveTimes: this.extractValveTimes(exactMatch),
                interpolated: false,
                confidence: 'exact',
            };
        }

        // Find surrounding points for interpolation
        const lowerPoints = points.filter(p => Number(p.ec_setpoint) < targetEc);
        const upperPoints = points.filter(p => Number(p.ec_setpoint) > targetEc);

        const lowerPoint = lowerPoints.length > 0 ? lowerPoints[lowerPoints.length - 1] : null;
        const upperPoint = upperPoints.length > 0 ? upperPoints[0] : null;

        // Both bounds available - interpolate
        if (lowerPoint && upperPoint) {
            const valveTimes = this.interpolate(
                targetEc,
                this.toLookupPoint(lowerPoint),
                this.toLookupPoint(upperPoint)
            );
            return {
                valveTimes,
                lowerPoint: this.toLookupPoint(lowerPoint),
                upperPoint: this.toLookupPoint(upperPoint),
                interpolated: true,
                confidence: 'interpolated',
            };
        }

        // Only lower bound - extrapolate up (use lower point values)
        if (lowerPoint && !upperPoint) {
            this.warn(`Target EC ${targetEc} above max known (${lowerPoint.ec_setpoint}). Using highest point.`);
            return {
                valveTimes: this.extractValveTimes(lowerPoint),
                lowerPoint: this.toLookupPoint(lowerPoint),
                interpolated: false,
                confidence: 'extrapolated',
            };
        }

        // Only upper bound - extrapolate down (use upper point values)
        if (!lowerPoint && upperPoint) {
            this.warn(`Target EC ${targetEc} below min known (${upperPoint.ec_setpoint}). Using lowest point.`);
            return {
                valveTimes: this.extractValveTimes(upperPoint),
                upperPoint: this.toLookupPoint(upperPoint),
                interpolated: false,
                confidence: 'extrapolated',
            };
        }

        // Fallback to defaults
        return {
            valveTimes: this.getDefaultValveTimes(),
            interpolated: false,
            confidence: 'default',
        };
    }

    /**
     * Linear interpolation between two points
     */
    private interpolate(
        targetEc: number,
        lower: LookupPoint,
        upper: LookupPoint
    ): ValveTimes {
        const ratio = (targetEc - lower.ec_setpoint) / (upper.ec_setpoint - lower.ec_setpoint);

        return {
            time_on_valve_01: Math.round(lower.time_on_valve_01 + ratio * (upper.time_on_valve_01 - lower.time_on_valve_01)),
            time_on_valve_02: Math.round(lower.time_on_valve_02 + ratio * (upper.time_on_valve_02 - lower.time_on_valve_02)),
            time_on_valve_03: Math.round(lower.time_on_valve_03 + ratio * (upper.time_on_valve_03 - lower.time_on_valve_03)),
            time_on_valve_04: Math.round(lower.time_on_valve_04 + ratio * (upper.time_on_valve_04 - lower.time_on_valve_04)),
            time_on_valve_05: Math.round(lower.time_on_valve_05 + ratio * (upper.time_on_valve_05 - lower.time_on_valve_05)),
        };
    }

    /**
     * Update lookup point with new run data using weighted average
     */
    async updateWithRunData(
        ecSetpoint: number,
        achievedEc: number,
        valveTimes: ValveTimes,
        flowAverages: { [key: string]: number }
    ): Promise<LookupPoint> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        // Find existing point or create new
        let point = await this.repository.findOne({
            where: { device_id: this.deviceId, ec_setpoint: ecSetpoint },
        });

        if (point) {
            // Update existing with weighted average
            const oldCount = point.sample_count;
            const newCount = oldCount + 1;

            // Weighted average for achieved EC
            if (point.actual_ec_avg !== null && point.actual_ec_avg !== undefined) {
                point.actual_ec_avg = Number(((Number(point.actual_ec_avg) * oldCount + achievedEc) / newCount).toFixed(2));
            } else {
                point.actual_ec_avg = achievedEc;
            }

            // Weighted average for flow rates
            for (let i = 1; i <= 5; i++) {
                const flowKey = `actual_flow_0${i}` as keyof TabiotFertilizerLookupPoint;
                const inputKey = `flow_${i}`;
                const oldFlow = point[flowKey] as number | null | undefined;
                const newFlow = flowAverages[inputKey];

                if (newFlow !== undefined) {
                    if (oldFlow !== null && oldFlow !== undefined) {
                        (point as any)[flowKey] = Number(((oldFlow * oldCount + newFlow) / newCount).toFixed(2));
                    } else {
                        (point as any)[flowKey] = newFlow;
                    }
                }
            }

            // Update valve times with adaptive adjustment
            const ecDeviation = achievedEc - ecSetpoint;
            if (Math.abs(ecDeviation) > EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD) {
                // If EC too high, reduce valve times; if too low, increase
                const adjustment = ecDeviation > 0
                    ? -EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP
                    : EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP;

                point.time_on_valve_01 = Math.max(0, point.time_on_valve_01 + adjustment);
                point.time_on_valve_02 = Math.max(0, point.time_on_valve_02 + adjustment);
                point.time_on_valve_03 = Math.max(0, point.time_on_valve_03 + adjustment);
                point.time_on_valve_04 = Math.max(0, point.time_on_valve_04 + adjustment);
                point.time_on_valve_05 = Math.max(0, point.time_on_valve_05 + adjustment);

                this.log(`Adjusted valve times by ${adjustment}ms (EC deviation: ${ecDeviation.toFixed(3)})`);
            }

            point.sample_count = newCount;
            point.data_type = LOOKUP_DATA_TYPE.ACTUAL as 'Actual';
            point.last_updated = new Date();

            await this.repository.save(point);
            this.log(`Updated lookup point for EC ${ecSetpoint}: sample_count=${newCount}`);

        } else {
            // Create new point
            point = this.repository.create({
                device_id: this.deviceId,
                ec_setpoint: ecSetpoint,
                time_on_valve_01: valveTimes.time_on_valve_01,
                time_on_valve_02: valveTimes.time_on_valve_02,
                time_on_valve_03: valveTimes.time_on_valve_03,
                time_on_valve_04: valveTimes.time_on_valve_04,
                time_on_valve_05: valveTimes.time_on_valve_05,
                actual_ec_avg: achievedEc,
                actual_flow_01: flowAverages['flow_1'],
                actual_flow_02: flowAverages['flow_2'],
                actual_flow_03: flowAverages['flow_3'],
                actual_flow_04: flowAverages['flow_4'],
                actual_flow_05: flowAverages['flow_5'],
                sample_count: 1,
                data_type: LOOKUP_DATA_TYPE.ACTUAL as 'Actual',
                last_updated: new Date(),
            });

            await this.repository.save(point);
            this.log(`Created new lookup point for EC ${ecSetpoint}`);
        }

        return this.toLookupPoint(point);
    }

    /**
     * Get all lookup points for the device
     */
    async getAllPoints(): Promise<LookupPoint[]> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        const points = await this.repository.find({
            where: { device_id: this.deviceId },
            order: { ec_setpoint: 'ASC' },
        });

        return points.map(p => this.toLookupPoint(p));
    }

    /**
     * Insert or update a lookup point (for manual setup or server sync)
     */
    async upsertPoint(point: Partial<LookupPoint>): Promise<LookupPoint> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        const existing = await this.repository.findOne({
            where: {
                device_id: this.deviceId,
                ec_setpoint: point.ec_setpoint
            },
        });

        if (existing) {
            // Update existing
            Object.assign(existing, {
                ...point,
                device_id: this.deviceId,
                last_updated: new Date(),
            });
            await this.repository.save(existing);
            return this.toLookupPoint(existing);
        } else {
            // Create new
            const newPoint = this.repository.create({
                ...point,
                device_id: this.deviceId,
                sample_count: point.sample_count ?? 0,
                data_type: point.data_type ?? LOOKUP_DATA_TYPE.ACTUAL as 'Actual',
                last_updated: new Date(),
            });
            await this.repository.save(newPoint);
            return this.toLookupPoint(newPoint);
        }
    }

    /**
     * Import lookup table from server/ThingsBoard
     */
    async importFromServer(points: LookupPoint[]): Promise<number> {
        let importedCount = 0;

        for (const point of points) {
            try {
                await this.upsertPoint({
                    ...point,
                    last_server_sync: new Date(),
                });
                importedCount++;
            } catch (error) {
                this.error(`Failed to import point EC=${point.ec_setpoint}: ${(error as Error).message}`);
            }
        }

        this.log(`Imported ${importedCount}/${points.length} lookup points from server`);
        return importedCount;
    }

    /**
     * Delete a lookup point
     */
    async deletePoint(ecSetpoint: number): Promise<boolean> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        const result = await this.repository.delete({
            device_id: this.deviceId,
            ec_setpoint: ecSetpoint,
        });

        return (result.affected ?? 0) > 0;
    }

    /**
     * Clear all lookup points for the device
     */
    async clearAll(): Promise<number> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        const result = await this.repository.delete({
            device_id: this.deviceId,
        });

        this.log(`Cleared ${result.affected} lookup points`);
        return result.affected ?? 0;
    }

    // ========================================
    // Helper Methods
    // ========================================

    private extractValveTimes(point: TabiotFertilizerLookupPoint): ValveTimes {
        return {
            time_on_valve_01: point.time_on_valve_01,
            time_on_valve_02: point.time_on_valve_02,
            time_on_valve_03: point.time_on_valve_03,
            time_on_valve_04: point.time_on_valve_04,
            time_on_valve_05: point.time_on_valve_05,
        };
    }

    private getDefaultValveTimes(): ValveTimes {
        return {
            time_on_valve_01: 1000,
            time_on_valve_02: 500,
            time_on_valve_03: 0,
            time_on_valve_04: 0,
            time_on_valve_05: 0,
        };
    }

    private toLookupPoint(entity: TabiotFertilizerLookupPoint): LookupPoint {
        return {
            id: entity.id,
            device_id: entity.device_id,
            ec_setpoint: Number(entity.ec_setpoint),
            time_on_valve_01: entity.time_on_valve_01,
            time_on_valve_02: entity.time_on_valve_02,
            time_on_valve_03: entity.time_on_valve_03,
            time_on_valve_04: entity.time_on_valve_04,
            time_on_valve_05: entity.time_on_valve_05,
            actual_ec_avg: entity.actual_ec_avg ? Number(entity.actual_ec_avg) : undefined,
            actual_flow_01: entity.actual_flow_01 ? Number(entity.actual_flow_01) : undefined,
            actual_flow_02: entity.actual_flow_02 ? Number(entity.actual_flow_02) : undefined,
            actual_flow_03: entity.actual_flow_03 ? Number(entity.actual_flow_03) : undefined,
            actual_flow_04: entity.actual_flow_04 ? Number(entity.actual_flow_04) : undefined,
            actual_flow_05: entity.actual_flow_05 ? Number(entity.actual_flow_05) : undefined,
            sample_count: entity.sample_count,
            data_type: entity.data_type,
            last_server_sync: entity.last_server_sync,
            last_updated: entity.last_updated,
        };
    }

    // ========================================
    // Logging Helpers
    // ========================================

    /**
     * Update or create lookup point from backend
     * Backend has aggregated data from multiple devices + learning algorithm applied
     */
    async updateOrCreateFromServer(serverPoint: LookupPoint): Promise<void> {
        if (!this.repository) {
            throw new Error('LookupTableService not initialized');
        }

        const existingPoint = await this.repository.findOne({
            where: {
                device_id: this.deviceId,
                ec_setpoint: serverPoint.ec_setpoint,
            },
        });

        if (existingPoint) {
            // Update existing: merge server data with local (prefer server's learned values)
            existingPoint.time_on_valve_01 = serverPoint.time_on_valve_01;
            existingPoint.time_on_valve_02 = serverPoint.time_on_valve_02;
            existingPoint.time_on_valve_03 = serverPoint.time_on_valve_03;
            existingPoint.time_on_valve_04 = serverPoint.time_on_valve_04;
            existingPoint.time_on_valve_05 = serverPoint.time_on_valve_05;

            // Update achieved values from server
            if (serverPoint.actual_ec_avg !== undefined) {
                existingPoint.actual_ec_avg = serverPoint.actual_ec_avg;
            }
            if (serverPoint.actual_flow_01 !== undefined) {
                existingPoint.actual_flow_01 = serverPoint.actual_flow_01;
            }
            if (serverPoint.actual_flow_02 !== undefined) {
                existingPoint.actual_flow_02 = serverPoint.actual_flow_02;
            }
            if (serverPoint.actual_flow_03 !== undefined) {
                existingPoint.actual_flow_03 = serverPoint.actual_flow_03;
            }
            if (serverPoint.actual_flow_04 !== undefined) {
                existingPoint.actual_flow_04 = serverPoint.actual_flow_04;
            }
            if (serverPoint.actual_flow_05 !== undefined) {
                existingPoint.actual_flow_05 = serverPoint.actual_flow_05;
            }

            // Keep local sample count if higher (indicates local learning)
            if (serverPoint.sample_count !== undefined && serverPoint.sample_count > (existingPoint.sample_count || 0)) {
                existingPoint.sample_count = serverPoint.sample_count;
            }

            existingPoint.data_type = serverPoint.data_type || 'Actual';
            existingPoint.last_server_sync = new Date();
            existingPoint.last_updated = new Date();

            await this.repository.save(existingPoint);
            this.log(`Updated lookup point EC=${serverPoint.ec_setpoint} from server`);
        } else {
            // Create new point from server
            const newPoint = this.repository.create({
                device_id: this.deviceId,
                ec_setpoint: serverPoint.ec_setpoint,
                time_on_valve_01: serverPoint.time_on_valve_01,
                time_on_valve_02: serverPoint.time_on_valve_02,
                time_on_valve_03: serverPoint.time_on_valve_03,
                time_on_valve_04: serverPoint.time_on_valve_04,
                time_on_valve_05: serverPoint.time_on_valve_05,
                actual_ec_avg: serverPoint.actual_ec_avg,
                actual_flow_01: serverPoint.actual_flow_01,
                actual_flow_02: serverPoint.actual_flow_02,
                actual_flow_03: serverPoint.actual_flow_03,
                actual_flow_04: serverPoint.actual_flow_04,
                actual_flow_05: serverPoint.actual_flow_05,
                sample_count: serverPoint.sample_count || 0,
                data_type: serverPoint.data_type || 'Actual',
                last_server_sync: new Date(),
            });

            await this.repository.save(newPoint);
            this.log(`Created new lookup point EC=${serverPoint.ec_setpoint} from server`);
        }
    }

    private log(message: string): void {
        this.node.log(`[LookupTable] ${message}`);
    }

    private warn(message: string): void {
        this.node.warn(`[LookupTable] ${message}`);
    }

    private error(message: string): void {
        this.node.error(`[LookupTable] ${message}`);
    }
}
