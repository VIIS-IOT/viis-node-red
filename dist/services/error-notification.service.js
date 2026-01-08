"use strict";
/**
 * Error Notification Service
 * Creates and manages error/warning notifications with deduplication
 *
 * @author VIIS Team
 * @version 1.0.0
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorNotificationService = void 0;
const error_mapping_service_1 = require("./error-mapping.service");
const TabiotNotification_1 = require("../orm/entities/notification/TabiotNotification");
const dataSource_1 = require("../orm/dataSource");
const axios_1 = __importDefault(require("axios"));
const global_context_helper_1 = require("../ultils/global-context-helper");
/**
 * Service for creating and managing error notifications
 */
class ErrorNotificationService {
    /**
     * Creates a new ErrorNotificationService instance
     * @param nodeContext - Node-RED node context
     */
    constructor(nodeContext) {
        this.notificationRepo = null;
        this.initialized = false;
        this.notificationCache = new Map(); // Cache for deduplication when DB not ready
        this.nodeContext = nodeContext;
        this.errorMappingService = new error_mapping_service_1.ErrorMappingService(nodeContext);
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
        this.initializeRepository();
    }
    /**
     * Initialize notification repository
     */
    async initializeRepository() {
        try {
            const dataSource = (0, dataSource_1.createDataSource)(this.nodeContext);
            // Initialize DataSource if not already initialized
            if (!dataSource.isInitialized) {
                await dataSource.initialize();
                console.log('[ErrorNotificationService] DataSource initialized successfully');
            }
            this.notificationRepo = dataSource.getRepository(TabiotNotification_1.TabiotNotification);
            this.initialized = true;
            // Clear notification cache when DB becomes ready (no longer needed)
            if (this.notificationCache.size > 0) {
                console.log(`[ErrorNotificationService] DB ready, clearing ${this.notificationCache.size} cached entries`);
                this.notificationCache.clear();
            }
            console.log('[ErrorNotificationService] Repository initialized successfully');
        }
        catch (error) {
            console.error('[ErrorNotificationService] Failed to initialize repository:', error);
            this.initialized = false;
        }
    }
    /**
     * Create notification from Modbus error
     * @param source - Modbus error source
     * @param deviceType - Device type name
     * @param entity - Entity identifier (e.g., node ID, device ID)
     * @returns Created or updated notification, or null if no error
     */
    async createFromModbus(source, deviceType, entity) {
        // Parse error using mapping service
        const parsedError = this.errorMappingService.parseModbusError(source, deviceType);
        if (!parsedError) {
            // No error or no mapping found
            return null;
        }
        // Create or update notification with deduplication
        return await this.createOrUpdateNotification(parsedError.err_code, parsedError.message, parsedError.severity, 'error', entity, `${deviceType} - ${entity}`, parsedError.metadata);
    }
    /**
     * Create notification from business logic
     * @param errorData - Business logic error data
     * @returns Created or updated notification
     */
    async createFromBusinessLogic(errorData) {
        // If database not ready, use memory-based deduplication and send HTTP only
        if (!this.notificationRepo || !this.initialized) {
            console.warn('[ErrorNotificationService] Database not ready, using memory-based deduplication');
            // Check memory-based deduplication (prevent spam during DB initialization)
            const cacheKey = `${errorData.entity}_${errorData.err_code}`;
            const lastSentTime = this.notificationCache.get(cacheKey);
            const now = Date.now();
            // Debounce: Don't send if sent within last 5 minutes
            if (lastSentTime && (now - lastSentTime) < 5 * 60 * 1000) {
                console.warn(`[ErrorNotificationService] Notification ${errorData.err_code} for ${errorData.entity} skipped (debounced, sent ${Math.floor((now - lastSentTime) / 1000)}s ago)`);
                // Return cached notification (don't create new one)
                const cachedNotification = new TabiotNotification_1.TabiotNotification();
                cachedNotification.name = this.generateNotificationName(errorData.entity, errorData.err_code);
                cachedNotification.entity = errorData.entity;
                cachedNotification.err_code = errorData.err_code;
                cachedNotification.message = errorData.message;
                return cachedNotification;
            }
            // Create temporary notification object for HTTP sending
            const tempNotification = new TabiotNotification_1.TabiotNotification();
            tempNotification.name = this.generateNotificationName(errorData.entity, errorData.err_code);
            tempNotification.entity = errorData.entity;
            tempNotification.type = errorData.type;
            tempNotification.severity = errorData.severity;
            tempNotification.message = errorData.message;
            tempNotification.err_code = errorData.err_code;
            tempNotification.entity_label = errorData.entity_label || errorData.entity;
            tempNotification.is_read = 0;
            tempNotification.is_sent = 0;
            tempNotification.created_at = new Date();
            tempNotification.metadata = JSON.stringify(Object.assign({ occurrence_count: 1, first_occurred: new Date().toISOString(), last_occurred: new Date().toISOString(), db_skipped: true }, errorData.metadata));
            // Send HTTP notification directly (await to ensure it's sent)
            try {
                await this.sendNotificationToBackend(tempNotification, 'create');
                // Update cache on successful send
                this.notificationCache.set(cacheKey, now);
                console.log(`[ErrorNotificationService] HTTP notification sent (DB pending): ${errorData.err_code}`);
            }
            catch (error) {
                console.error(`[ErrorNotificationService] Failed to send HTTP notification: ${error.message}`);
                // Don't cache on failure, allow retry next time
            }
            return tempNotification;
        }
        return await this.createOrUpdateNotification(errorData.err_code, errorData.message, errorData.severity, errorData.type, errorData.entity, errorData.entity_label || errorData.entity, errorData.metadata);
    }
    /**
     * Create or update notification with deduplication
     * Uses DB lookup to check for existing unresolved notification
     * @returns Created or updated notification
     */
    async createOrUpdateNotification(err_code, message, severity, type, entity, entity_label, metadata) {
        if (!this.notificationRepo) {
            throw new Error('Notification repository not initialized');
        }
        try {
            // Check if repository metadata is available
            if (!this.notificationRepo.metadata) {
                console.warn('[ErrorNotificationService] Repository metadata not available, cannot create notification');
                throw new Error('Database not initialized');
            }
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.name) === 'EntityMetadataNotFoundError') {
                console.warn('[ErrorNotificationService] Entity metadata not found, database not ready');
                throw new Error('Database not initialized');
            }
            throw error;
        }
        // Try to find existing unresolved notification
        const existing = await this.findUnresolvedNotification(err_code, entity);
        if (existing) {
            // Update existing notification
            console.log(`[ErrorNotificationService] Updating existing notification: ${existing.name}`);
            // Update occurrence tracking in metadata only
            const updates = {
                message // Update message in case it changed
            };
            // Parse existing metadata or create new object
            let existingMetadata = {};
            try {
                if (existing.metadata) {
                    existingMetadata = typeof existing.metadata === 'string'
                        ? JSON.parse(existing.metadata)
                        : existing.metadata;
                }
            }
            catch (error) {
                console.warn('[ErrorNotificationService] Failed to parse existing metadata:', error);
                existingMetadata = {};
            }
            // Always update metadata with occurrence tracking
            updates.metadata = JSON.stringify(Object.assign(Object.assign(Object.assign({}, existingMetadata), { occurrence_count: (existingMetadata.occurrence_count || 1) + 1, last_occurred: new Date().toISOString() }), metadata));
            // Update directly via repository
            await this.notificationRepo.update({ name: existing.name }, updates);
            // Fetch and return updated notification
            const updatedNotification = await this.notificationRepo.findOne({ where: { name: existing.name } }) || existing;
            // Send notification to backend (async, don't await to avoid blocking)
            this.sendNotificationToBackend(updatedNotification, 'create').catch(error => {
                console.error('[ErrorNotificationService] Failed to sync notification to backend:', error.message);
            });
            return updatedNotification;
        }
        // Create new notification
        console.log(`[ErrorNotificationService] Creating new notification: ${err_code} for ${entity}`);
        // Create new notification directly
        const notification = new TabiotNotification_1.TabiotNotification();
        notification.name = this.generateNotificationName(entity, err_code);
        notification.entity = entity;
        notification.type = type;
        notification.severity = severity;
        notification.message = message;
        notification.err_code = err_code;
        notification.entity_label = entity_label;
        notification.is_read = 0;
        notification.is_sent = 0;
        notification.created_at = new Date();
        notification.metadata = JSON.stringify(Object.assign({ occurrence_count: 1, first_occurred: new Date().toISOString(), last_occurred: new Date().toISOString() }, metadata));
        const savedNotification = await this.notificationRepo.save(notification);
        // Send notification to backend (async, don't await to avoid blocking)
        this.sendNotificationToBackend(savedNotification, 'create').catch(error => {
            console.error('[ErrorNotificationService] Failed to sync notification to backend:', error.message);
        });
        return savedNotification;
    }
    /**
     * Find unresolved notification for given error code and entity
     * @param err_code - Error code
     * @param entity - Entity identifier
     * @returns Existing notification or null
     */
    async findUnresolvedNotification(err_code, entity) {
        if (!this.notificationRepo) {
            return null;
        }
        try {
            // Check if repository metadata is available
            if (!this.notificationRepo.metadata) {
                console.warn('[ErrorNotificationService] Repository metadata not available, skipping database query');
                return null;
            }
            // Find unread notification with same err_code and entity
            // Assuming is_read = 0 means unresolved
            const notification = await this.notificationRepo.findOne({
                where: {
                    err_code,
                    entity,
                    is_read: 0 // Unresolved
                },
                order: {
                    created_at: 'DESC' // Get most recent
                }
            });
            return notification;
        }
        catch (error) {
            // Silently skip if entity metadata not found (database not initialized yet)
            if ((error === null || error === void 0 ? void 0 : error.name) === 'EntityMetadataNotFoundError') {
                return null;
            }
            console.error('[ErrorNotificationService] Error finding unresolved notification:', error);
            return null;
        }
    }
    /**
     * Auto-resolve notification when error clears
     * @param source - Modbus error source (with cleared value)
     * @param deviceType - Device type name
     * @param entity - Entity identifier
     * @returns True if notification was resolved
     */
    async autoResolveIfClear(source, deviceType, entity) {
        var _a;
        // Check if value indicates error is cleared
        const isCleared = this.isErrorCleared(source);
        if (!isCleared) {
            return false;
        }
        // Parse to get err_code (even though error is cleared, we need the mapping)
        const mapping = this.errorMappingService.getMappingForDeviceType(deviceType);
        if (!mapping) {
            return false;
        }
        // Find register mapping
        const registerMap = (_a = mapping.mappings) === null || _a === void 0 ? void 0 : _a.find((m) => m.register_type === source.register_type &&
            m.address === source.address);
        if (!registerMap || !registerMap.error_codes) {
            return false;
        }
        // Try to resolve all potential error codes from this register
        for (const errorDef of registerMap.error_codes) {
            if (errorDef.auto_resolve !== false) {
                await this.resolveNotification(errorDef.err_code, entity);
            }
        }
        return true;
    }
    /**
     * Check if error value indicates cleared state
     * @param source - Modbus error source
     * @returns True if error is cleared
     */
    isErrorCleared(source) {
        if (source.register_type === 'coil') {
            return source.value === false;
        }
        else {
            return source.value === 0;
        }
    }
    /**
     * Resolve (mark as read) a notification
     * @param err_code - Error code
     * @param entity - Entity identifier
     * @returns True if resolved
     */
    async resolveNotification(err_code, entity) {
        const notification = await this.findUnresolvedNotification(err_code, entity);
        if (notification) {
            console.log(`[ErrorNotificationService] Auto-resolving notification: ${notification.name}`);
            // Parse existing metadata
            let existingMetadata = {};
            try {
                if (notification.metadata) {
                    existingMetadata = JSON.parse(notification.metadata);
                }
            }
            catch (error) {
                console.warn('[ErrorNotificationService] Failed to parse metadata:', error);
            }
            // Update via repository
            await this.notificationRepo.update({ name: notification.name }, {
                is_read: 1,
                metadata: JSON.stringify(Object.assign(Object.assign({}, existingMetadata), { resolved_at: new Date().toISOString(), resolved_by: 'auto' }))
            });
            // Note: We don't send HTTP notification on resolve
            // Only send when creating new error notification
            console.log(`[ErrorNotificationService] Notification resolved (local only): ${notification.name}`);
            return true;
        }
        return false;
    }
    /**
     * Generate unique notification name
     * @param entity - Entity identifier
     * @param err_code - Error code
     * @returns Unique notification name
     */
    generateNotificationName(entity, err_code) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `notification_${entity}_${err_code}_${timestamp}_${random}`;
    }
    /**
     * Convert severity to notification type
     * @param severity - Severity level
     * @returns Notification type
     */
    severityToType(severity) {
        switch (severity) {
            case 'low':
                return 'info';
            case 'medium':
                return 'warning';
            case 'high':
                return 'error';
            case 'critical':
                return 'alert';
            default:
                return 'warning';
        }
    }
    /**
     * Create notification from Modbus error using Board ID (new approach)
     * @param source - Modbus error source information
     * @param boardId - Board ID (e.g., 'board1')
     * @param entity - Entity identifier
     * @returns Created/updated notification or null
     */
    async createFromModbusByBoardId(source, boardId, entity) {
        // Parse error using boardId
        const parsedError = this.errorMappingService.parseModbusErrorByBoardId(source, boardId);
        if (!parsedError) {
            // No mapping found for this board/register/value combination
            return null;
        }
        // Create business logic error from parsed Modbus error
        const businessLogicError = {
            err_code: parsedError.err_code,
            message: parsedError.message,
            severity: parsedError.severity,
            type: this.severityToType(parsedError.severity),
            entity,
            metadata: Object.assign(Object.assign({}, parsedError.metadata), { board_id: boardId })
        };
        // Create/update notification
        return await this.createFromBusinessLogic(businessLogicError);
    }
    /**
     * Auto-resolve notification when error clears using Board ID
     * @param source - Modbus error source (with cleared value)
     * @param boardId - Board ID
     * @param entity - Entity identifier
     * @returns True if notification was resolved
     */
    async autoResolveIfClearByBoardId(source, boardId, entity) {
        var _a;
        // Check if value indicates error is cleared
        const isCleared = this.isErrorCleared(source);
        if (!isCleared) {
            return false;
        }
        // Get mapping for this board
        const mapping = this.errorMappingService.getMappingForBoardId(boardId);
        if (!mapping) {
            return false;
        }
        // Find register mapping
        const registerMap = (_a = mapping.mappings) === null || _a === void 0 ? void 0 : _a.find((m) => m.register_type === source.register_type &&
            m.address === source.address);
        if (!registerMap || !registerMap.error_codes) {
            return false;
        }
        // Try to resolve all potential error codes from this register
        for (const errorDef of registerMap.error_codes) {
            if (errorDef.auto_resolve !== false) {
                await this.resolveNotification(errorDef.err_code, entity);
            }
        }
        return true;
    }
    /**
     * Send notification to backend via HTTP API
     * Mirrors the format used by viis-schedule-executor for consistency
     * Note: Only called when creating new error notification, not when resolving
     * @param notification - Created notification
     * @param action - 'create' for new error (resolve action not used)
     * @returns True if sent successfully
     */
    async sendNotificationToBackend(notification, action) {
        var _a, _b;
        try {
            // Get backend URL and device access token from environment
            const backendUrl = this.globalHelper.getEnvVar('VIIS_BACKEND', '');
            const deviceAccessToken = this.globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '');
            const deviceId = this.globalHelper.getEnvVar('DEVICE_ID', 'unknown');
            if (!backendUrl || !deviceAccessToken) {
                console.warn('[ErrorNotificationService] HTTP sync skipped: Missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN');
                return false;
            }
            // Determine severity and status based on action
            const isResolve = action === 'resolve';
            const alarmStatus = isResolve ? 'Clear' : 'Pending';
            // Map notification severity to alarm severity
            let severity = 'notification';
            if (notification.severity === 'critical' || notification.severity === 'high') {
                severity = isResolve ? 'notification' : 'error';
            }
            // Parse metadata for additional context
            let metadata = {};
            try {
                if (notification.metadata) {
                    metadata = typeof notification.metadata === 'string'
                        ? JSON.parse(notification.metadata)
                        : notification.metadata;
                }
            }
            catch (error) {
                console.warn('[ErrorNotificationService] Failed to parse metadata:', error);
            }
            // Build message with Vietnamese format
            let message;
            if (isResolve) {
                message = `Lỗi "${notification.err_code}" đã được khắc phục: ${notification.entity_label || notification.entity}`;
            }
            else {
                message = notification.message || `Lỗi ${notification.err_code} phát hiện tại ${notification.entity_label || notification.entity}`;
            }
            // Prepare request payload (ThingsboardAlarm format)
            const payload = {
                alarm_name: notification.err_code || 'ERROR',
                id: deviceId,
                msg: message,
                severity: severity,
                trigger_time: ((_a = notification.created_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || new Date().toISOString(),
                tb_alarm_id: notification.name,
                alarm_status: alarmStatus,
                clear_by: isResolve ? 'Auto' : '',
                clear_by_user_id: '',
                entity: notification.entity || deviceId,
                // Include metadata for context
                metadata: {
                    err_code: notification.err_code,
                    entity_label: notification.entity_label,
                    severity: notification.severity,
                    board_id: metadata.board_id,
                    register_type: metadata.register_type,
                    address: metadata.address
                }
            };
            const url = `${backendUrl}/api/v2/alarm/notification-by-token`;
            // Send HTTP request with timeout
            const response = await axios_1.default.post(url, payload, {
                params: {
                    device_access_token: deviceAccessToken
                },
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            if (response.status === 200 || response.status === 201) {
                console.log(`[ErrorNotificationService] 📡 HTTP notification sent: ${notification.err_code} (${action})`, `Status: ${response.status}`);
                return true;
            }
            else {
                console.warn(`[ErrorNotificationService] HTTP notification failed: ${response.status}`, response.statusText);
                return false;
            }
        }
        catch (error) {
            // Log error but don't throw - notification already saved to DB
            if (axios_1.default.isAxiosError(error)) {
                const axiosError = error;
                console.error(`[ErrorNotificationService] HTTP notification error:`, `Status: ${((_b = axiosError.response) === null || _b === void 0 ? void 0 : _b.status) || 'N/A'}`, `Message: ${axiosError.message}`);
            }
            else {
                console.error('[ErrorNotificationService] HTTP notification error:', error.message);
            }
            return false;
        }
    }
    /**
     * Get service statistics
     * @returns Service statistics
     */
    getStats() {
        return {
            mappingService: this.errorMappingService.getMappingStats(),
            repositoryInitialized: this.notificationRepo !== null,
            cacheSize: this.notificationCache.size
        };
    }
    /**
     * Clean up expired cache entries (older than 10 minutes)
     * Should be called periodically to prevent memory leak
     */
    cleanupCache() {
        const now = Date.now();
        const expiryThreshold = 10 * 60 * 1000; // 10 minutes
        let cleanedCount = 0;
        for (const [key, timestamp] of this.notificationCache.entries()) {
            if (now - timestamp > expiryThreshold) {
                this.notificationCache.delete(key);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(`[ErrorNotificationService] Cache cleanup: removed ${cleanedCount} expired entries`);
        }
    }
}
exports.ErrorNotificationService = ErrorNotificationService;
