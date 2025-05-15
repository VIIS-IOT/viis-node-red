/**
 * @fileoverview Schedule Sync Handler for VIIS Sync Schedule module
 * Handles synchronization of schedules and schedule plans between server and local database
 */

import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { DatabaseService } from '../services/databaseService';
import { ApiService } from '../services/apiService';
import { ServerSchedule, ServerSchedulePlan } from '../interfaces/types';
import { logger } from '../utils/logger';
import { TabiotSchedulePlan } from '../../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { adjustToUTC7 } from '../../../ultils/helper';
import { SyncStateService, SyncResult } from '../services/syncStateService';
import { isNewer, isValidDate } from '../utils/dateHelper';

/**
 * Handler for synchronizing schedules and schedule plans
 */
export class ScheduleSyncHandler {
    /** Repository for schedule plans */
    private readonly planRepo: Repository<TabiotSchedulePlan>;
    /** Repository for schedules */
    private readonly scheduleRepo: Repository<TabiotSchedule>;
    /** Node-RED node instance */
    private readonly node: Node;
    /** API service for server communication */
    private readonly apiService: ApiService;
    /** Service for tracking sync state */
    private readonly syncStateService: SyncStateService;
    /** Statistics for current sync operation */
    private syncStats: {
        plansCreated: number;
        plansUpdated: number;
        schedulesCreated: number;
        schedulesUpdated: number;
        totalPlans: number;
        totalSchedules: number;
    };

    /**
     * Creates a new schedule sync handler
     * @param dbService - Database service for repository access
     * @param node - Node-RED node instance
     * @param accessToken - Device access token for authentication
     */
    constructor(dbService: DatabaseService, node: Node, accessToken: string) {
        this.planRepo = dbService.getSchedulePlanRepository();
        this.scheduleRepo = dbService.getScheduleRepository();
        this.node = node;
        this.apiService = new ApiService(accessToken);
        this.syncStateService = new SyncStateService(node);
        
        // Initialize sync statistics
        this.resetSyncStats();
        
        logger.info(node, 'ScheduleSyncHandler initialized');
    }
    
    /**
     * Resets sync statistics to zero
     */
    private resetSyncStats(): void {
        this.syncStats = {
            plansCreated: 0,
            plansUpdated: 0,
            schedulesCreated: 0,
            schedulesUpdated: 0,
            totalPlans: 0,
            totalSchedules: 0,
        };
    }

    /**
     * Synchronizes all schedule plans and schedules
     * @returns Promise that resolves to the sync result
     */
    async syncAll(): Promise<SyncResult> {
        // Reset sync statistics
        this.resetSyncStats();
        
        // Record sync start
        const startTimestamp = this.syncStateService.startSync();
        
        try {
            logger.info(this.node, 'Starting synchronization of all schedule plans and schedules');
            
            // Fetch all schedule plans and schedules from server
            const serverResponse = await this.apiService.getAllSchedulePlans();
            const serverPlans = serverResponse.result.data;
            
            this.syncStats.totalPlans = serverPlans.length;
            logger.info(this.node, `Received ${serverPlans.length} schedule plans from server`);
            
            // Process each schedule plan
            for (const serverPlan of serverPlans) {
                await this.syncSchedulePlan(serverPlan);
            }
            
            // Create sync result
            const result: SyncResult = {
                success: true,
                ...this.syncStats,
                timestamp: Date.now()
            };
            
            // Record successful sync
            this.syncStateService.recordSyncResult(result);
            
            logger.info(this.node, `Synchronization completed successfully: Created ${this.syncStats.plansCreated} plans, ` +
                `updated ${this.syncStats.plansUpdated} plans, created ${this.syncStats.schedulesCreated} schedules, ` +
                `updated ${this.syncStats.schedulesUpdated} schedules`);
                
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Synchronization failed: ${errorMessage}`);
            
            // Record failed sync
            const result: SyncResult = {
                success: false,
                errorMessage,
                ...this.syncStats,
                timestamp: Date.now()
            };
            
            this.syncStateService.recordSyncResult(result);
            
            return result;
        }
    }
    
    /**
     * Gets the current sync state information
     * @returns Status message describing the current sync state
     */
    getStatusMessage(): string {
        return this.syncStateService.getStatusMessage();
    }
    
    /**
     * Checks if a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress(): boolean {
        return this.syncStateService.isSyncInProgress();
    }

    /**
     * Synchronizes a single schedule plan and its schedules
     * @param serverPlan - Schedule plan data from server
     * @returns Promise that resolves when synchronization is complete
     */
    private async syncSchedulePlan(serverPlan: ServerSchedulePlan): Promise<void> {
        try {
            logger.info(this.node, `Syncing schedule plan: ${serverPlan.name} (${serverPlan.label})`);
            
            // Check if plan exists locally
            const localPlan = await this.planRepo.findOneBy({ name: serverPlan.name });
            
            if (!localPlan) {
                // Plan doesn't exist locally, create it
                await this.createSchedulePlan(serverPlan);
            } else {
                // Plan exists locally, check if it needs updating
                await this.updateSchedulePlanIfNeeded(localPlan, serverPlan);
            }
            
            // Sync schedules for this plan
            await this.syncSchedulesForPlan(serverPlan);
            
            logger.info(this.node, `Completed sync for schedule plan: ${serverPlan.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync schedule plan ${serverPlan.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Creates a new schedule plan in the local database
     * @param serverPlan - Schedule plan data from server
     * @returns Promise that resolves when the plan is created
     */
    private async createSchedulePlan(serverPlan: ServerSchedulePlan): Promise<void> {
        try {
            logger.info(this.node, `Creating new schedule plan: ${serverPlan.name}`);
            
            // Create a new TabiotSchedulePlan entity
            const newPlan = new TabiotSchedulePlan();
            newPlan.name = serverPlan.name;
            newPlan.label = serverPlan.label;
            newPlan.creation = new Date(serverPlan.creation);
            newPlan.modified = new Date(serverPlan.modified);
            newPlan.schedule_count = serverPlan.schedule_count;
            newPlan.status = serverPlan.status as 'active' | 'inactive';
            newPlan.is_deleted = serverPlan.is_deleted;
            newPlan.enable = serverPlan.enable;
            // Skip customer_id as it's not in the entity
            newPlan.is_synced = 1; // Mark as synced since it came from server
            newPlan.is_from_local = 0; // Not from local
            newPlan.device_id = serverPlan.device_id;
            newPlan.start_date = serverPlan.start_date || null;
            newPlan.end_date = serverPlan.end_date || null;
            
            await this.planRepo.save(newPlan);
            this.syncStats.plansCreated++;
            logger.info(this.node, `Created schedule plan: ${serverPlan.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to create schedule plan ${serverPlan.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Updates a local schedule plan if the server version is newer
     * @param localPlan - Local schedule plan entity
     * @param serverPlan - Schedule plan data from server
     * @returns Promise that resolves when the plan is updated (if needed)
     */
    private async updateSchedulePlanIfNeeded(
        localPlan: TabiotSchedulePlan, 
        serverPlan: ServerSchedulePlan
    ): Promise<void> {
        try {
            const serverModified = new Date(serverPlan.modified);
            const localModified = localPlan.modified;
            
            // Skip update if local is newer or same as server
            if (localPlan.is_from_local === 1 && localModified >= serverModified) {
                logger.info(this.node, `Local plan ${localPlan.name} is newer or same as server, skipping update`);
                return;
            }
            
            logger.info(this.node, `Updating schedule plan: ${serverPlan.name}`);
            
            // Update local plan with server data
            Object.assign(localPlan, {
                label: serverPlan.label,
                modified: serverModified,
                schedule_count: serverPlan.schedule_count,
                status: serverPlan.status || '',
                is_deleted: serverPlan.is_deleted,
                enable: serverPlan.enable,
                is_synced: 1, // Mark as synced
                start_date: serverPlan.start_date ? new Date(serverPlan.start_date) : null,
                end_date: serverPlan.end_date ? new Date(serverPlan.end_date) : null
            });
            
            await this.planRepo.save(localPlan);
            this.syncStats.plansUpdated++;
            logger.info(this.node, `Updated schedule plan: ${serverPlan.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update schedule plan ${serverPlan.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Synchronizes schedules for a specific plan
     * @param serverPlan - Schedule plan data from server
     * @returns Promise that resolves when all schedules are synchronized
     */
    private async syncSchedulesForPlan(serverPlan: ServerSchedulePlan): Promise<void> {
        try {
            const { schedules } = serverPlan;
            
            if (!schedules || !Array.isArray(schedules)) {
                logger.warn(this.node, `No schedules found for plan ${serverPlan.name}`);
                return;
            }
            
            logger.info(this.node, `Syncing ${schedules.length} schedules for plan ${serverPlan.name}`);
            
            // Find deleted schedules in local that no longer exist on server
            await this.detectDeletedSchedules(schedules, serverPlan.name);
            
            // Process each schedule
            for (const serverSchedule of schedules) {
                await this.syncSchedule(serverSchedule, serverPlan.name);
            }
            
            logger.info(this.node, `Completed syncing schedules for plan ${serverPlan.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync schedules for plan ${serverPlan.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Synchronizes a single schedule
     * @param serverSchedule - Schedule data from server
     * @param planName - Parent schedule plan name
     * @returns Promise that resolves when the schedule is synchronized
     */
    private async syncSchedule(serverSchedule: ServerSchedule, planName: string): Promise<void> {
        try {
            logger.info(this.node, `Syncing schedule: ${serverSchedule.name}`);
            
            // Check if schedule exists locally
            const localSchedule = await this.scheduleRepo.findOneBy({ name: serverSchedule.name });
            
            if (!localSchedule) {
                // Schedule doesn't exist locally, create it
                await this.createSchedule(serverSchedule, planName);
            } else {
                // Schedule exists locally, check if it needs updating
                await this.updateScheduleIfNeeded(localSchedule, serverSchedule);
            }
            
            logger.info(this.node, `Completed sync for schedule: ${serverSchedule.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to sync schedule ${serverSchedule.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Creates a new schedule in the local database
     * @param serverSchedule - Schedule data from server
     * @param planName - Parent schedule plan name
     * @returns Promise that resolves when the schedule is created
     */
    private async createSchedule(serverSchedule: ServerSchedule, planName: string): Promise<void> {
        try {
            logger.info(this.node, `Creating new schedule: ${serverSchedule.name}`);
            
            // Create a new TabiotSchedule entity
            const newSchedule = new TabiotSchedule();
            newSchedule.name = serverSchedule.name;
            newSchedule.label = serverSchedule.label;
            newSchedule.device_id = serverSchedule.device_id;
            newSchedule.status = serverSchedule.status as 'running' | 'stopped' | 'finished' | '';
            newSchedule.action = typeof serverSchedule.action === 'object' 
                ? JSON.stringify(serverSchedule.action) 
                : serverSchedule.action;
            newSchedule.enable = serverSchedule.enable ? 1 : 0;
            newSchedule.set_time = serverSchedule.set_time;
            newSchedule.start_time = serverSchedule.start_time;
            newSchedule.end_time = serverSchedule.end_time;
            newSchedule.start_date = serverSchedule.start_date || null;
            newSchedule.end_date = serverSchedule.end_date || null;
            newSchedule.type = serverSchedule.type as '' | 'circulate' | 'period' | 'fixed' | 'interval';
            newSchedule.interval = serverSchedule.interval;
            newSchedule.is_synced = 1; // Mark as synced since it came from server
            newSchedule.is_from_local = 0; // Not from local
            newSchedule.is_deleted = serverSchedule.is_deleted;
            newSchedule.schedule_plan_id = planName;
            newSchedule.creation = adjustToUTC7(new Date());
            newSchedule.modified = adjustToUTC7(new Date());
            
            await this.scheduleRepo.save(newSchedule);
            this.syncStats.schedulesCreated++;
            this.syncStats.totalSchedules++;
            logger.info(this.node, `Created schedule: ${serverSchedule.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to create schedule ${serverSchedule.name}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Updates a local schedule if the server version is newer
     * @param localSchedule - Local schedule entity
     * @param serverSchedule - Schedule data from server
     * @returns Promise that resolves when the schedule is updated (if needed)
     */
    private async updateScheduleIfNeeded(
        localSchedule: TabiotSchedule, 
        serverSchedule: ServerSchedule
    ): Promise<void> {
        try {
            // If local was created locally and is not deleted, only update if server version is newer
            if (localSchedule.is_from_local === 1 && localSchedule.is_deleted === 0) {
                const serverModified = new Date(serverSchedule.modified || Date.now());
                const localModified = localSchedule.modified;
                
                if (localModified && serverModified && localModified >= serverModified) {
                    logger.info(this.node, `Local schedule ${localSchedule.name} is newer than server, skipping update`);
                    this.syncStats.totalSchedules++; // Still count as processed
                    return;
                }
            }
            
            logger.info(this.node, `Updating schedule: ${serverSchedule.name}`);
            
            // Update local schedule with server data
            Object.assign(localSchedule, {
                label: serverSchedule.label,
                status: serverSchedule.status || 'finished',
                action: typeof serverSchedule.action === 'object' 
                    ? JSON.stringify(serverSchedule.action) 
                    : serverSchedule.action,
                enable: serverSchedule.enable ? 1 : 0,
                set_time: serverSchedule.set_time,
                start_time: serverSchedule.start_time,
                end_time: serverSchedule.end_time,
                start_date: serverSchedule.start_date ? new Date(serverSchedule.start_date) : null,
                end_date: serverSchedule.end_date ? new Date(serverSchedule.end_date) : null,
                type: serverSchedule.type,
                interval: serverSchedule.interval,
                is_synced: 1, // Mark as synced
                is_deleted: serverSchedule.is_deleted,
                modified: adjustToUTC7(new Date())
            });
            
            await this.scheduleRepo.save(localSchedule);
            this.syncStats.schedulesUpdated++;
            this.syncStats.totalSchedules++;
            logger.info(this.node, `Updated schedule: ${serverSchedule.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to update schedule ${serverSchedule.name}: ${errorMessage}`);
            throw error;
        }
    }
    
    /**
     * Detects schedules that exist locally but are not present in server data
     * Marks these schedules as deleted in the local database
     * 
     * @param serverSchedules - Array of schedules from the server
     * @param planName - Schedule plan name
     * @returns Promise that resolves when deleted schedules are processed
     */
    private async detectDeletedSchedules(serverSchedules: ServerSchedule[], planName: string): Promise<void> {
        try {
            logger.info(this.node, `Checking for deleted schedules in plan ${planName}`);
            
            // Get all active schedules for this plan from local DB
            const localSchedules = await this.scheduleRepo.find({
                where: {
                    schedule_plan_id: planName,
                    is_deleted: 0
                }
            });
            
            if (!localSchedules || localSchedules.length === 0) {
                logger.info(this.node, `No local schedules found for plan ${planName}`);
                return;
            }
            
            // Create a map of server schedule names for fast lookup
            const serverScheduleMap = new Map<string, boolean>();
            serverSchedules.forEach(schedule => {
                serverScheduleMap.set(schedule.name, true);
            });
            
            // Find schedules that exist locally but not on server
            const deletedSchedules = localSchedules.filter(localSchedule => 
                !serverScheduleMap.has(localSchedule.name)
            );
            
            if (deletedSchedules.length === 0) {
                logger.info(this.node, `No deleted schedules found for plan ${planName}`);
                return;
            }
            
            logger.info(this.node, `Found ${deletedSchedules.length} deleted schedules for plan ${planName}`);
            
            // Mark each missing schedule as deleted
            for (const deletedSchedule of deletedSchedules) {
                logger.info(this.node, `Marking schedule ${deletedSchedule.name} as deleted`);
                
                deletedSchedule.is_deleted = 1;
                deletedSchedule.modified = adjustToUTC7(new Date());
                
                await this.scheduleRepo.save(deletedSchedule);
                this.syncStats.schedulesUpdated++;
                this.syncStats.totalSchedules++;
            }
            
            logger.info(this.node, `Processed ${deletedSchedules.length} deleted schedules for plan ${planName}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(this.node, `Failed to detect deleted schedules for plan ${planName}: ${errorMessage}`);
            throw error;
        }
    }
}
