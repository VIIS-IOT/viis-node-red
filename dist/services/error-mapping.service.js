"use strict";
/**
 * Error Mapping Service
 * Parses Modbus error codes to human-readable messages using mappings from global context
 *
 * @author VIIS Team
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorMappingService = void 0;
const global_context_helper_1 = require("../ultils/global-context-helper");
/**
 * Service for parsing Modbus error codes using mappings from global context
 */
class ErrorMappingService {
    /**
     * Creates a new ErrorMappingService instance
     * @param nodeContext - Node-RED node context
     */
    constructor(nodeContext) {
        this.contextHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
    }
    /**
     * Parse Modbus error code to human-readable error
     * @param source - Modbus error source information
     * @param deviceType - Device type name
     * @returns Parsed error or null if no mapping found
     */
    parseModbusError(source, deviceType) {
        var _a, _b, _c;
        // Get mapping for device type
        const mapping = this.contextHelper.getErrorCodeMappingForDevice(deviceType);
        if (!mapping) {
            console.warn(`[ErrorMappingService] No error mapping found for device type: ${deviceType}`);
            return null;
        }
        // Find matching register mapping
        const registerMap = (_a = mapping.mappings) === null || _a === void 0 ? void 0 : _a.find((m) => m.register_type === source.register_type &&
            m.address === source.address);
        if (!registerMap) {
            // No mapping for this specific register
            return null;
        }
        // Find error code definition
        let errorDef;
        if (source.register_type === 'holding') {
            // For holding registers: any non-zero value matches the first error code
            if (source.value !== 0 && ((_b = registerMap.error_codes) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                errorDef = registerMap.error_codes[0];
            }
        }
        else {
            // For coils and other types: exact match required
            errorDef = (_c = registerMap.error_codes) === null || _c === void 0 ? void 0 : _c.find((ec) => ec.code === source.value);
        }
        if (!errorDef) {
            // Value exists but no error code defined for this value
            return null;
        }
        // Return parsed error
        return {
            err_code: errorDef.err_code,
            message: errorDef.message,
            severity: errorDef.severity,
            auto_resolve: errorDef.auto_resolve !== false, // Default to true
            description: errorDef.description,
            metadata: {
                register_type: source.register_type,
                address: source.address,
                raw_value: source.value,
                device_type: deviceType
            }
        };
    }
    /**
     * Check if an error should be auto-resolved
     * @param source - Modbus error source information
     * @param deviceType - Device type name
     * @returns True if error should be auto-resolved when value clears
     */
    shouldAutoResolve(source, deviceType) {
        var _a;
        const parsedError = this.parseModbusError(source, deviceType);
        return (_a = parsedError === null || parsedError === void 0 ? void 0 : parsedError.auto_resolve) !== null && _a !== void 0 ? _a : true;
    }
    /**
     * Get all available device types with error mappings
     * @returns Array of device type names
     */
    getAvailableDeviceTypes() {
        return this.contextHelper.getAvailableErrorDeviceTypes();
    }
    /**
     * Get error mapping for specific device type
     * @param deviceType - Device type name
     * @returns Error code mapping or null
     */
    getMappingForDeviceType(deviceType) {
        return this.contextHelper.getErrorCodeMappingForDevice(deviceType);
    }
    /**
     * Check if error code mappings are loaded
     * @returns True if mappings exist
     */
    hasMappings() {
        return this.contextHelper.hasErrorCodeMappings();
    }
    /**
     * Get statistics about loaded mappings
     * @returns Mapping statistics
     */
    getMappingStats() {
        const deviceTypes = this.getAvailableDeviceTypes();
        return {
            loaded: deviceTypes.length > 0,
            deviceTypeCount: deviceTypes.length,
            deviceTypes
        };
    }
    /**
     * Parse Modbus error code by board ID (new approach)
     * @param source - Modbus error source information
     * @param boardId - Board ID (e.g., 'board1')
     * @returns Parsed error or null if no mapping found
     */
    parseModbusErrorByBoardId(source, boardId) {
        var _a, _b, _c;
        // Try to get mapping by board_id first
        const mapping = this.getMappingForBoardId(boardId);
        if (!mapping) {
            console.warn(`[ErrorMappingService] No error mapping found for board ID: ${boardId}`);
            return null;
        }
        // Find matching register mapping
        const registerMap = (_a = mapping.mappings) === null || _a === void 0 ? void 0 : _a.find((m) => m.register_type === source.register_type &&
            m.address === source.address);
        if (!registerMap) {
            return null;
        }
        // Find error code definition
        let errorDef;
        if (source.register_type === 'holding') {
            // For holding registers: any non-zero value matches the first error code
            if (source.value !== 0 && ((_b = registerMap.error_codes) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                errorDef = registerMap.error_codes[0];
            }
        }
        else {
            // For coils and other types: exact match required
            errorDef = (_c = registerMap.error_codes) === null || _c === void 0 ? void 0 : _c.find((ec) => ec.code === source.value);
        }
        if (!errorDef) {
            return null;
        }
        // Return parsed error
        return {
            err_code: errorDef.err_code,
            message: errorDef.message,
            severity: errorDef.severity,
            auto_resolve: errorDef.auto_resolve !== false,
            description: errorDef.description,
            metadata: {
                register_type: source.register_type,
                address: source.address,
                raw_value: source.value,
                device_type: boardId, // Use boardId as device_type for compatibility
                board_id: boardId
            }
        };
    }
    /**
     * Get error mapping for specific board ID
     * @param boardId - Board ID (e.g., 'board1')
     * @returns Error code mapping or null
     */
    getMappingForBoardId(boardId) {
        // First try to get by board_id field
        const allMappings = this.contextHelper.getErrorCodeMappings();
        if (!allMappings || typeof allMappings !== 'object') {
            return null;
        }
        // Try to find mapping with matching board_id
        for (const key in allMappings) {
            const mapping = allMappings[key];
            if (mapping.board_id === boardId) {
                return mapping;
            }
        }
        // Fallback: Try using boardId as key directly (for backward compatibility)
        return allMappings[boardId] || null;
    }
    /**
     * Get all available board IDs with error mappings
     * @returns Array of board IDs
     */
    getAvailableBoardIds() {
        const allMappings = this.contextHelper.getErrorCodeMappings();
        if (!allMappings || typeof allMappings !== 'object') {
            return [];
        }
        const boardIds = [];
        for (const key in allMappings) {
            const mapping = allMappings[key];
            if (mapping.board_id) {
                boardIds.push(mapping.board_id);
            }
        }
        return [...new Set(boardIds)]; // Remove duplicates
    }
}
exports.ErrorMappingService = ErrorMappingService;
