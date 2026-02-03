import { Node, NodeContext } from 'node-red';
import { Repository, DataSource } from 'typeorm';
import { TabiotFertilizerIrrigationRun } from '../../../orm/entities/fertilizer/TabiotFertilizerIrrigationRun';
import { DataSourceManager } from '../../../orm/dataSource';
import {
    IrrigationRun,
    ValveTimes
} from '../interfaces/types';
import { RUN_STATUS } from '../constants';

/**
 * IrrigationRunService
 *
 * Manages irrigation run history for the fertilizer module.
 * Provides:
 * - Create/start new irrigation runs
 * - Complete/fail runs with final data
 * - Query run history
 * - Track sync status for offline operation
 */
export class IrrigationRunService {
    private node: Node;
    private deviceId: string;
    private dataSource: DataSource | null = null;
    private repository: Repository<TabiotFertilizerIrrigationRun> | null = null;

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
            this.repository = this.dataSource.getRepository(TabiotFertilizerIrrigationRun);
            this.log('IrrigationRunService initialized');
        } catch (error) {
            this.error(`Failed to initialize IrrigationRunService: ${(error as Error).message}`);
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
     * Start a new irrigation run
     */
    async startRun(params: {
        ecSetpoint: number;
        valveTimes: ValveTimes;
        scheduleName?: string;
    }): Promise<IrrigationRun> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = this.repository.create({
            device_id: this.deviceId,
            schedule_name: params.scheduleName,
            ec_setpoint: params.ecSetpoint,
            time_on_valve_01: params.valveTimes.time_on_valve_01,
            time_on_valve_02: params.valveTimes.time_on_valve_02,
            time_on_valve_03: params.valveTimes.time_on_valve_03,
            time_on_valve_04: params.valveTimes.time_on_valve_04,
            time_on_valve_05: params.valveTimes.time_on_valve_05,
            start_time: new Date(),
            status: RUN_STATUS.RUNNING as 'Running',
            is_synced_to_server: 0,
            sync_attempts: 0,
            created_at: new Date(),
        });

        await this.repository.save(run);
        this.log(`Started irrigation run #${run.id} with EC setpoint ${params.ecSetpoint}`);

        return this.toIrrigationRun(run);
    }

    /**
     * Complete an irrigation run successfully
     */
    async completeRun(params: {
        runId: number;
        ecAchievedAvg: number;
        flowAverages: { [key: string]: number };
    }): Promise<IrrigationRun> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: { id: params.runId },
        });

        if (!run) {
            throw new Error(`Irrigation run #${params.runId} not found`);
        }

        const endTime = new Date();
        const durationSeconds = Math.round((endTime.getTime() - run.start_time.getTime()) / 1000);

        run.end_time = endTime;
        run.duration_seconds = durationSeconds;
        run.status = RUN_STATUS.COMPLETED as 'Completed';
        run.ec_achieved_avg = params.ecAchievedAvg;
        run.flow_achieved_01_avg = params.flowAverages['flow_1'];
        run.flow_achieved_02_avg = params.flowAverages['flow_2'];
        run.flow_achieved_03_avg = params.flowAverages['flow_3'];
        run.flow_achieved_04_avg = params.flowAverages['flow_4'];
        run.flow_achieved_05_avg = params.flowAverages['flow_5'];

        await this.repository.save(run);
        this.log(`Completed irrigation run #${run.id}. Duration: ${durationSeconds}s, EC achieved: ${params.ecAchievedAvg}`);

        return this.toIrrigationRun(run);
    }

    /**
     * Fail an irrigation run
     */
    async failRun(params: {
        runId: number;
        errorCode: string;
        errorMessage?: string;
    }): Promise<IrrigationRun> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: { id: params.runId },
        });

        if (!run) {
            throw new Error(`Irrigation run #${params.runId} not found`);
        }

        const endTime = new Date();
        const durationSeconds = Math.round((endTime.getTime() - run.start_time.getTime()) / 1000);

        run.end_time = endTime;
        run.duration_seconds = durationSeconds;
        run.status = RUN_STATUS.FAILED as 'Failed';
        run.error_code = params.errorCode;
        run.error_message = params.errorMessage;

        await this.repository.save(run);
        this.warn(`Failed irrigation run #${run.id}. Error: ${params.errorCode}`);

        return this.toIrrigationRun(run);
    }

    /**
     * Interrupt an irrigation run (user stop)
     */
    async interruptRun(params: {
        runId: number;
        ecAchievedAvg?: number;
        flowAverages?: { [key: string]: number };
    }): Promise<IrrigationRun> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: { id: params.runId },
        });

        if (!run) {
            throw new Error(`Irrigation run #${params.runId} not found`);
        }

        const endTime = new Date();
        const durationSeconds = Math.round((endTime.getTime() - run.start_time.getTime()) / 1000);

        run.end_time = endTime;
        run.duration_seconds = durationSeconds;
        run.status = RUN_STATUS.INTERRUPTED as 'Interrupted';

        if (params.ecAchievedAvg !== undefined) {
            run.ec_achieved_avg = params.ecAchievedAvg;
        }
        if (params.flowAverages) {
            run.flow_achieved_01_avg = params.flowAverages['flow_1'];
            run.flow_achieved_02_avg = params.flowAverages['flow_2'];
            run.flow_achieved_03_avg = params.flowAverages['flow_3'];
            run.flow_achieved_04_avg = params.flowAverages['flow_4'];
            run.flow_achieved_05_avg = params.flowAverages['flow_5'];
        }

        await this.repository.save(run);
        this.log(`Interrupted irrigation run #${run.id}. Duration: ${durationSeconds}s`);

        return this.toIrrigationRun(run);
    }

    /**
     * Get the current running irrigation (if any)
     */
    async getCurrentRun(): Promise<IrrigationRun | null> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: {
                device_id: this.deviceId,
                status: RUN_STATUS.RUNNING as 'Running'
            },
            order: { start_time: 'DESC' },
        });

        return run ? this.toIrrigationRun(run) : null;
    }

    /**
     * Get run by ID
     */
    async getRunById(runId: number): Promise<IrrigationRun | null> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: { id: runId },
        });

        return run ? this.toIrrigationRun(run) : null;
    }

    /**
     * Get recent runs
     */
    async getRecentRuns(limit: number = 20): Promise<IrrigationRun[]> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const runs = await this.repository.find({
            where: { device_id: this.deviceId },
            order: { start_time: 'DESC' },
            take: limit,
        });

        return runs.map(r => this.toIrrigationRun(r));
    }

    /**
     * Get unsynced completed runs (for backend sync)
     */
    async getUnsyncedRuns(): Promise<IrrigationRun[]> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const runs = await this.repository.find({
            where: {
                device_id: this.deviceId,
                status: RUN_STATUS.COMPLETED as 'Completed',
                is_synced_to_server: 0,
            },
            order: { start_time: 'ASC' },
        });

        return runs.map(r => this.toIrrigationRun(r));
    }

    /**
     * Mark a run as synced to server
     */
    async markAsSynced(runId: number): Promise<void> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        await this.repository.update(
            { id: runId },
            {
                is_synced_to_server: 1,
                synced_at: new Date()
            }
        );

        this.log(`Marked run #${runId} as synced to server`);
    }

    /**
     * Increment sync attempts and record error
     */
    async recordSyncFailure(runId: number, errorMessage: string): Promise<void> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        const run = await this.repository.findOne({
            where: { id: runId },
        });

        if (run) {
            run.sync_attempts = (run.sync_attempts || 0) + 1;
            run.sync_error = errorMessage;
            await this.repository.save(run);
        }
    }

    /**
     * Clean up any stale running runs (from power outage recovery)
     */
    async cleanupStaleRuns(): Promise<number> {
        if (!this.repository) {
            throw new Error('IrrigationRunService not initialized');
        }

        // Find runs that are still "Running" but started more than 24 hours ago
        const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const staleRuns = await this.repository
            .createQueryBuilder()
            .update()
            .set({
                status: RUN_STATUS.INTERRUPTED as 'Interrupted',
                error_code: 'POWER_OUTAGE',
                error_message: 'Run interrupted due to power outage or system restart',
                end_time: new Date(),
            })
            .where('device_id = :deviceId', { deviceId: this.deviceId })
            .andWhere('status = :status', { status: RUN_STATUS.RUNNING })
            .andWhere('start_time < :threshold', { threshold: staleThreshold })
            .execute();

        const affected = staleRuns.affected ?? 0;
        if (affected > 0) {
            this.warn(`Cleaned up ${affected} stale running runs`);
        }

        return affected;
    }

    // ========================================
    // Helper Methods
    // ========================================

    private toIrrigationRun(entity: TabiotFertilizerIrrigationRun): IrrigationRun {
        return {
            id: entity.id,
            device_id: entity.device_id,
            schedule_name: entity.schedule_name,
            ec_setpoint: Number(entity.ec_setpoint),
            ec_achieved_avg: entity.ec_achieved_avg ? Number(entity.ec_achieved_avg) : undefined,
            flow_achieved_01_avg: entity.flow_achieved_01_avg ? Number(entity.flow_achieved_01_avg) : undefined,
            flow_achieved_02_avg: entity.flow_achieved_02_avg ? Number(entity.flow_achieved_02_avg) : undefined,
            flow_achieved_03_avg: entity.flow_achieved_03_avg ? Number(entity.flow_achieved_03_avg) : undefined,
            flow_achieved_04_avg: entity.flow_achieved_04_avg ? Number(entity.flow_achieved_04_avg) : undefined,
            flow_achieved_05_avg: entity.flow_achieved_05_avg ? Number(entity.flow_achieved_05_avg) : undefined,
            time_on_valve_01: entity.time_on_valve_01,
            time_on_valve_02: entity.time_on_valve_02,
            time_on_valve_03: entity.time_on_valve_03,
            time_on_valve_04: entity.time_on_valve_04,
            time_on_valve_05: entity.time_on_valve_05,
            start_time: entity.start_time,
            end_time: entity.end_time,
            duration_seconds: entity.duration_seconds,
            status: entity.status,
            error_code: entity.error_code,
            error_message: entity.error_message,
            is_synced_to_server: entity.is_synced_to_server,
            synced_at: entity.synced_at,
            sync_attempts: entity.sync_attempts,
            sync_error: entity.sync_error,
            created_at: entity.created_at,
        };
    }

    // ========================================
    // Logging Helpers
    // ========================================

    private log(message: string): void {
        this.node.log(`[IrrigationRun] ${message}`);
    }

    private warn(message: string): void {
        this.node.warn(`[IrrigationRun] ${message}`);
    }

    private error(message: string): void {
        this.node.error(`[IrrigationRun] ${message}`);
    }
}
