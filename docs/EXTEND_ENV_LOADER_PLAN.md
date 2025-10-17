# Plan: Extend env-loader để Load Error Code Mappings

## 🎯 Overview

Extend **env-loader** node hiện tại để load cả error code mappings bên cạnh environment variables. Approach này tận dụng tối đa infrastructure đã có.

## 📦 env-loader Architecture hiện tại

```
env-loader/
├── env-loader.js                    # Node wrapper
├── env-loader.html                  # UI configuration
└── lib/
    ├── env-loader-core.js           # Main orchestration
    ├── env-file-parser.js           # Parse .env files
    ├── global-context-manager.js    # Store to global context
    ├── file-watcher.js              # Hot-reload watching
    ├── config-manager.js            # Validate config
    ├── env-validator.js             # Validate env data
    ├── error-types.js               # Custom errors
    └── utils.js                     # Utility functions
```

**Key features đã có**:
- ✅ Hot-reload với file watching (10s interval)
- ✅ Global context storage
- ✅ Modular architecture
- ✅ Error handling
- ✅ Logging infrastructure
- ✅ Configuration validation

## 🔧 Extension Plan

### Phase 1: Tạo ErrorCodeManager Component

**File mới**: `/env-loader/lib/error-code-manager.js`

```javascript
/**
 * Error Code Manager for env-loader
 * Loads and manages error code mapping files
 * 
 * @author VIIS Team
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { EnvLoaderError } = require('./error-types');

class ErrorCodeManager {
    /**
     * @param {Object} config - Configuration object
     * @param {Object} logger - Logger instance
     */
    constructor(config = {}, logger = console) {
        this.config = config;
        this.logger = logger;
        this.errorCodesDir = config.errorCodesDir || '/services/env/error-codes';
        this.enableErrorCodeLoading = config.enableErrorCodeLoading !== false;
        this.cachedMappings = null;
        this.lastLoadTime = null;
    }

    /**
     * Check if error codes directory exists
     * @returns {boolean}
     */
    directoryExists() {
        try {
            return fs.existsSync(this.errorCodesDir);
        } catch (error) {
            return false;
        }
    }

    /**
     * Load all error code mapping files from directory
     * @returns {Object} Error code mappings by device type
     */
    loadErrorCodeMappings() {
        if (!this.enableErrorCodeLoading) {
            this.logger.log('ℹ️ Error code loading is disabled');
            return {};
        }

        if (!this.directoryExists()) {
            this.logger.log(`ℹ️ Error codes directory not found: ${this.errorCodesDir}`);
            return {};
        }

        try {
            const startTime = Date.now();
            
            // Read all JSON files in directory
            const files = fs.readdirSync(this.errorCodesDir)
                .filter(f => f.endsWith('.json'));

            if (files.length === 0) {
                this.logger.log('ℹ️ No error code mapping files found');
                return {};
            }

            const allMappings = {};
            let successCount = 0;
            let failCount = 0;

            // Process each file
            files.forEach(file => {
                try {
                    const mapping = this.loadMappingFile(file);
                    if (mapping) {
                        allMappings[mapping.device_type] = mapping;
                        successCount++;
                        
                        this.logger.log(
                            `  ✅ ${mapping.device_type}: ` +
                            `${mapping.mappings?.length || 0} register mappings`
                        );
                    }
                } catch (error) {
                    failCount++;
                    this.logger.error(`  ❌ ${file}: ${error.message}`);
                }
            });

            const loadTime = Date.now() - startTime;
            this.lastLoadTime = new Date();
            this.cachedMappings = allMappings;

            this.logger.log(
                `📦 Error code mappings loaded: ` +
                `${successCount} success, ${failCount} failed (${loadTime}ms)`
            );

            return allMappings;

        } catch (error) {
            this.logger.error(`❌ Failed to load error codes: ${error.message}`);
            return {};
        }
    }

    /**
     * Load and validate a single mapping file
     * @param {string} filename - Name of the JSON file
     * @returns {Object|null} Parsed and validated mapping
     */
    loadMappingFile(filename) {
        const filePath = path.join(this.errorCodesDir, filename);
        
        // Read file
        const content = fs.readFileSync(filePath, 'utf8');
        const mapping = JSON.parse(content);

        // Validate structure
        const validation = this.validateMapping(mapping);
        if (!validation.valid) {
            throw new Error(
                `Invalid mapping structure: ${validation.errors.join(', ')}`
            );
        }

        // Add metadata
        mapping._metadata = {
            filename: filename,
            loadedAt: new Date().toISOString(),
            source: filePath
        };

        return mapping;
    }

    /**
     * Validate error code mapping structure
     * @param {Object} mapping - Mapping object to validate
     * @returns {Object} Validation result
     */
    validateMapping(mapping) {
        const errors = [];

        // Check required fields
        if (!mapping.device_type) {
            errors.push('Missing required field: device_type');
        }

        if (!mapping.mappings || !Array.isArray(mapping.mappings)) {
            errors.push('Missing or invalid field: mappings (must be array)');
        }

        // Validate each mapping entry
        if (mapping.mappings) {
            mapping.mappings.forEach((map, index) => {
                if (!map.register_type) {
                    errors.push(`Mapping[${index}]: missing register_type`);
                }
                if (map.address === undefined) {
                    errors.push(`Mapping[${index}]: missing address`);
                }
                if (!map.error_codes || !Array.isArray(map.error_codes)) {
                    errors.push(`Mapping[${index}]: invalid error_codes`);
                }
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get statistics about loaded mappings
     * @returns {Object} Statistics
     */
    getStats() {
        if (!this.cachedMappings) {
            return {
                loaded: false,
                deviceTypeCount: 0,
                totalMappings: 0,
                lastLoadTime: null
            };
        }

        let totalMappings = 0;
        Object.values(this.cachedMappings).forEach(mapping => {
            totalMappings += mapping.mappings?.length || 0;
        });

        return {
            loaded: true,
            deviceTypeCount: Object.keys(this.cachedMappings).length,
            totalMappings,
            lastLoadTime: this.lastLoadTime,
            deviceTypes: Object.keys(this.cachedMappings)
        };
    }

    /**
     * Clear cached mappings
     */
    clearCache() {
        this.cachedMappings = null;
        this.lastLoadTime = null;
    }
}

module.exports = {
    ErrorCodeManager
};
```

---

### Phase 2: Extend EnvLoaderCore

**File**: `/env-loader/lib/env-loader-core.js`

**Changes needed**:

```javascript
// Thêm import
const { ErrorCodeManager } = require('./error-code-manager');

class EnvLoaderCore {
    constructor(nodeContext, rawConfig = {}, logger = console) {
        // ... existing code ...
        
        // NEW: Add error code manager
        this.errorCodeManager = null;
    }

    async initialize() {
        try {
            // ... existing initialization ...
            
            // NEW: Initialize error code manager
            this.errorCodeManager = new ErrorCodeManager(this.config, this.logger);
            this.logger.log('✅ Error code manager initialized');
            
            // ... rest of code ...
        } catch (error) {
            // ... error handling ...
        }
    }

    async loadEnvironmentVariables() {
        // ... existing env loading logic ...
        
        try {
            // Step 1-4: Existing env loading steps
            // ...
            
            // NEW Step 5: Load error code mappings
            this.logger.log('🔍 Loading error code mappings...');
            const errorCodeMappings = this.errorCodeManager.loadErrorCodeMappings();
            
            // NEW Step 6: Store error codes in global context
            if (Object.keys(errorCodeMappings).length > 0) {
                const storeResult = this.globalContextManager.storeErrorCodeMappings(
                    errorCodeMappings
                );
                
                if (storeResult.success) {
                    this.logger.log(
                        `✅ Stored ${storeResult.deviceTypeCount} error code mappings in global context`
                    );
                }
            } else {
                this.logger.log('ℹ️ No error code mappings to store');
            }
            
            // Get stats for output message
            const errorCodeStats = this.errorCodeManager.getStats();
            
            // ... existing return logic ...
            // Include errorCodeStats in output message
            
            return {
                success: true,
                loadTime,
                variableCount: Object.keys(processedData).length,
                errorCodeStats, // NEW: Add to result
                outputMessage,
                storageResult,
                validationResult
            };
            
        } catch (error) {
            // ... error handling ...
        }
    }
    
    async cleanup() {
        this.logger.log('🧹 Cleaning up EnvLoaderCore');
        
        await this.stopFileWatching();
        
        // NEW: Clear error code cache
        if (this.errorCodeManager) {
            this.errorCodeManager.clearCache();
        }
        
        // ... rest of cleanup ...
    }
}
```

---

### Phase 3: Extend GlobalContextManager

**File**: `/env-loader/lib/global-context-manager.js`

**Add methods**:

```javascript
class GlobalContextManager {
    // ... existing code ...
    
    /**
     * Store error code mappings in global context
     * @param {Object} errorCodeMappings - Error code mappings by device type
     * @returns {Object} Storage result
     */
    storeErrorCodeMappings(errorCodeMappings) {
        try {
            // Store in dedicated global context key
            this.globalContext.set('errorCodeMappings', errorCodeMappings);
            
            const deviceTypeCount = Object.keys(errorCodeMappings).length;
            
            this.logger.log(
                `💾 Stored error code mappings in global context: ` +
                `${deviceTypeCount} device types`
            );
            
            // Also store metadata for debugging
            this.globalContext.set('errorCodeMappings_metadata', {
                deviceTypes: Object.keys(errorCodeMappings),
                loadedAt: new Date().toISOString(),
                count: deviceTypeCount
            });
            
            return {
                success: true,
                deviceTypeCount
            };
            
        } catch (error) {
            this.logger.error(`Failed to store error code mappings: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Get error code mappings from global context
     * @returns {Object} Error code mappings
     */
    getErrorCodeMappings() {
        return this.globalContext.get('errorCodeMappings') || {};
    }
    
    /**
     * Get error code mappings metadata
     * @returns {Object} Metadata
     */
    getErrorCodeMappingsMetadata() {
        return this.globalContext.get('errorCodeMappings_metadata') || null;
    }
    
    /**
     * Get enhanced context summary including error codes
     * @returns {Object} Context summary
     */
    getContextSummary() {
        // ... existing env summary ...
        
        const errorCodeMetadata = this.getErrorCodeMappingsMetadata();
        
        return {
            // ... existing fields ...
            errorCodeMappings: errorCodeMetadata ? {
                loaded: true,
                deviceTypeCount: errorCodeMetadata.count,
                deviceTypes: errorCodeMetadata.deviceTypes,
                loadedAt: errorCodeMetadata.loadedAt
            } : {
                loaded: false
            }
        };
    }
}
```

---

### Phase 4: Update Configuration

**File**: `/env-loader/lib/config-manager.js`

**Add configuration field**:

```javascript
class ConfigManager {
    constructor(rawConfig = {}) {
        this.rawConfig = rawConfig;
        this.defaults = {
            // ... existing defaults ...
            
            // NEW: Error code loading defaults
            enableErrorCodeLoading: true,
            errorCodesDir: '/services/env/error-codes'
        };
    }
    
    validate() {
        const config = {
            // ... existing validation ...
            
            // NEW: Error code configuration
            enableErrorCodeLoading: this.rawConfig.enableErrorCodeLoading !== false,
            errorCodesDir: this.rawConfig.errorCodesDir || this.defaults.errorCodesDir
        };
        
        // ... rest of validation ...
        
        return config;
    }
    
    getSummary() {
        return {
            // ... existing summary ...
            
            // NEW: Include error code config
            errorCodeLoading: {
                enabled: this.config.enableErrorCodeLoading,
                directory: this.config.errorCodesDir
            }
        };
    }
}
```

---

### Phase 5: Update UI Configuration

**File**: `/env-loader/env-loader.html`

**Add configuration fields**:

```html
<script type="text/html" data-template-name="env-loader">
    <!-- Existing fields -->
    <!-- ... -->
    
    <!-- NEW SECTION: Error Code Configuration -->
    <div class="form-row">
        <h4>Error Code Mappings</h4>
    </div>
    
    <div class="form-row">
        <label for="node-input-enableErrorCodeLoading">
            <input type="checkbox" id="node-input-enableErrorCodeLoading" 
                   style="width: auto; vertical-align: top;">
            Enable error code loading
        </label>
    </div>
    
    <div class="form-row">
        <label for="node-input-errorCodesDir">
            <i class="fa fa-exclamation-triangle"></i> Error Codes Directory
        </label>
        <input type="text" id="node-input-errorCodesDir" 
               placeholder="/services/env/error-codes">
        <span class="form-tips">
            Directory containing error code mapping JSON files. 
            Leave empty to use default: /services/env/error-codes
        </span>
    </div>
</script>

<script type="text/javascript">
    RED.nodes.registerType('env-loader', {
        category: 'config',
        defaults: {
            // ... existing defaults ...
            
            // NEW: Error code defaults
            enableErrorCodeLoading: { value: true },
            errorCodesDir: { value: '/services/env/error-codes' }
        },
        // ... rest of config ...
    });
</script>
```

---

### Phase 6: Extend FileWatcher (Optional - for Hot Reload)

**File**: `/env-loader/lib/file-watcher.js`

```javascript
class FileWatcher {
    async setup(changeCallback, errorCallback) {
        // ... existing env file watching ...
        
        // NEW: Also watch error-codes directory
        if (this.config.enableErrorCodeLoading && this.config.errorCodesDir) {
            try {
                if (fs.existsSync(this.config.errorCodesDir)) {
                    this.watcher.add(this.config.errorCodesDir);
                    this.logger.log(
                        `👁️ Watching error codes directory: ${this.config.errorCodesDir}`
                    );
                }
            } catch (error) {
                this.logger.warn(`Could not watch error codes directory: ${error.message}`);
            }
        }
        
        // ... rest of code ...
    }
}
```

---

## 🚀 Implementation Steps

### Step 1: Create ErrorCodeManager
- [ ] Create `/env-loader/lib/error-code-manager.js`
- [ ] Implement `loadErrorCodeMappings()`
- [ ] Implement `validateMapping()`
- [ ] Implement `getStats()`
- [ ] Add unit tests

### Step 2: Update EnvLoaderCore
- [ ] Import ErrorCodeManager
- [ ] Initialize in `initialize()`
- [ ] Call `loadErrorCodeMappings()` in `loadEnvironmentVariables()`
- [ ] Include stats in output
- [ ] Add cleanup logic

### Step 3: Update GlobalContextManager
- [ ] Add `storeErrorCodeMappings()`
- [ ] Add `getErrorCodeMappings()`
- [ ] Update `getContextSummary()`

### Step 4: Update ConfigManager
- [ ] Add `enableErrorCodeLoading` config
- [ ] Add `errorCodesDir` config
- [ ] Validate new configs
- [ ] Include in summary

### Step 5: Update UI
- [ ] Add checkbox for enable/disable
- [ ] Add text input for directory path
- [ ] Update help text
- [ ] Update defaults

### Step 6: Testing
- [ ] Create sample error-codes JSON files
- [ ] Test loading from directory
- [ ] Test validation errors
- [ ] Test hot-reload
- [ ] Test disable feature
- [ ] Integration test with viis nodes

---

## 📁 Sample Error Code Files

### `/services/env/error-codes/default.json`
```json
{
  "device_type": "default",
  "description": "Default error codes for all devices",
  "mappings": [
    {
      "register_type": "holding",
      "address": 9999,
      "description": "General error register",
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_GENERAL",
          "message": "General system error",
          "severity": "medium",
          "auto_resolve": true
        }
      ]
    }
  ]
}
```

### `/services/env/error-codes/climate-controller.json`
```json
{
  "device_type": "Climate_Controller",
  "description": "Error codes for climate control system",
  "mappings": [
    {
      "register_type": "holding",
      "address": 1000,
      "description": "Temperature error register",
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_TEMP_HIGH",
          "message": "Nhiệt độ vượt ngưỡng an toàn",
          "severity": "high",
          "auto_resolve": true,
          "description": "Temperature exceeds safe threshold"
        },
        {
          "code": 2,
          "err_code": "ERR_SENSOR_FAULT",
          "message": "Cảm biến nhiệt độ bị lỗi",
          "severity": "critical",
          "auto_resolve": false,
          "description": "Temperature sensor malfunction"
        }
      ]
    },
    {
      "register_type": "coil",
      "address": 500,
      "description": "Fan overrun flag",
      "error_codes": [
        {
          "code": true,
          "err_code": "ERR_FAN_OVERRUN",
          "message": "Quạt chạy quá giới hạn thời gian",
          "severity": "medium",
          "auto_resolve": true
        }
      ]
    }
  ]
}
```

---

## 🔄 Usage in Other Nodes

### ErrorMappingService

```typescript
// src/services/error-mapping.service.ts

import { NodeContext } from 'node-red';

interface ModbusErrorSource {
  register_type: 'holding' | 'input' | 'coil';
  address: number;
  value: number | boolean;
  board_id?: string;
}

interface ParsedError {
  err_code: string;
  message: string;
  severity: string;
  auto_resolve: boolean;
  description?: string;
}

export class ErrorMappingService {
  private nodeContext: NodeContext;
  
  constructor(nodeContext: NodeContext) {
    this.nodeContext = nodeContext;
  }
  
  /**
   * Parse Modbus error code to human-readable error
   */
  parseModbusError(
    source: ModbusErrorSource,
    deviceType: string
  ): ParsedError | null {
    // Read from global context (loaded by env-loader)
    const allMappings = this.nodeContext.global.get('errorCodeMappings') || {};
    const mapping = allMappings[deviceType];
    
    if (!mapping) {
      console.warn(`No error mapping found for device type: ${deviceType}`);
      
      // Try default mapping
      const defaultMapping = allMappings['default'];
      if (!defaultMapping) {
        return null;
      }
      return this.findErrorInMapping(defaultMapping, source);
    }
    
    return this.findErrorInMapping(mapping, source);
  }
  
  /**
   * Find error in mapping object
   */
  private findErrorInMapping(
    mapping: any,
    source: ModbusErrorSource
  ): ParsedError | null {
    // Find matching register mapping
    const registerMap = mapping.mappings.find((m: any) => 
      m.register_type === source.register_type && 
      m.address === source.address
    );
    
    if (!registerMap) {
      return null;
    }
    
    // Find error code definition
    const errorDef = registerMap.error_codes.find((ec: any) => 
      ec.code === source.value
    );
    
    if (!errorDef) {
      return null;
    }
    
    return {
      err_code: errorDef.err_code,
      message: errorDef.message,
      severity: errorDef.severity,
      auto_resolve: errorDef.auto_resolve ?? true,
      description: errorDef.description
    };
  }
  
  /**
   * Get all available device types
   */
  getAvailableDeviceTypes(): string[] {
    const allMappings = this.nodeContext.global.get('errorCodeMappings') || {};
    return Object.keys(allMappings);
  }
  
  /**
   * Get mapping for specific device type
   */
  getMappingForDeviceType(deviceType: string): any | null {
    const allMappings = this.nodeContext.global.get('errorCodeMappings') || {};
    return allMappings[deviceType] || null;
  }
}
```

---

## ✅ Benefits của Approach này

### 1. Tận dụng Infrastructure
- ✅ **EnvLoaderCore**: Orchestration logic đã có
- ✅ **FileWatcher**: Hot-reload tự động (10s)
- ✅ **GlobalContextManager**: Store/retrieve pattern
- ✅ **Error handling**: Consistent error types
- ✅ **Logging**: Unified logging pattern

### 2. Consistency
- ✅ **Same node**: env-loader load cả env + error-codes
- ✅ **Same pattern**: Read files → Validate → Store to global context
- ✅ **Same UI**: Cấu hình ở 1 chỗ
- ✅ **Same deployment**: Không cần thêm node

### 3. Maintainability
- ✅ **Modular**: ErrorCodeManager độc lập
- ✅ **Testable**: Unit test từng component
- ✅ **Extensible**: Dễ thêm features sau
- ✅ **Clear separation**: Env logic riêng, error-code logic riêng

### 4. Production Ready
- ✅ **Error handling**: Proper error types
- ✅ **Validation**: Validate JSON structure
- ✅ **Performance**: Cached mappings
- ✅ **Monitoring**: Stats và metadata
- ✅ **Hot-reload**: Zero downtime updates

---

## 📊 Timeline Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| 1. ErrorCodeManager | Create component + tests | 3-4 hours |
| 2. EnvLoaderCore | Extend core logic | 2 hours |
| 3. GlobalContextManager | Add storage methods | 1 hour |
| 4. ConfigManager | Update config | 1 hour |
| 5. UI | Update HTML | 1 hour |
| 6. Testing | Integration tests | 2-3 hours |
| **Total** | | **10-12 hours** |

---

## 🎯 Next Steps

1. **Review this plan** - Có cần điều chỉnh gì không?
2. **Create sample JSON files** - Chuẩn bị test data
3. **Implement Phase 1** - ErrorCodeManager component
4. **Test incrementally** - Test sau mỗi phase
5. **Integration** - Tích hợp với ErrorNotificationService
6. **Documentation** - Update user docs

---

**Prepared by**: AI Assistant  
**Date**: 2025-01-17  
**Version**: 1.0  
**Status**: Ready for implementation
