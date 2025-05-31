# Global Context Migration Guide

## Tổng quan

Tài liệu này hướng dẫn cách các custom node trong viis-node-red đã được cập nhật để sử dụng global context thay vì process.env, cho phép hot-reload environment variables từ env-loader node.

## Kiến trúc mới

### 1. Global Context Helper

Đã tạo utility helper tại `src/ultils/global-context-helper.ts` để:
- Truy cập environment variables từ global context với fallback về process.env
- Mapping tự động giữa tên biến môi trường và tên trong global context
- Hỗ trợ các kiểu dữ liệu: string, number, boolean, JSON object

### 2. Environment Variable Mapping

Env-loader node đã được cấu hình để map các biến môi trường như sau:

```javascript
const ENV_TO_GLOBAL_MAPPING = {
  'DEVICE_ID': 'device_id',
  'DEVICE_ACCESS_TOKEN': 'device_access_token',
  'DEVICE_LABEL': 'device_label',
  'DEVICE_SERIAL': 'device_serial',
  'DEVICE_PROFILE_ID': 'device_profile_id',
  'DEVICE_PROFILE_LABEL': 'device_profile_label',
  'VIIS_BACKEND': 'backend_url',
  'BACKEND_URL': 'server_url',
  'MODBUS_HOST': 'modbus_host',
  'MODBUS_TCP_PORT': 'modbus_tcp_port',
  'MODBUS_HOLDING_REGISTERS': 'modbusHoldingRegisters',
  'MODBUS_INPUT_REGISTERS': 'modbusInputRegisters',
  'MODBUS_COILS': 'modbusCoils',
  // ThingsBoard configuration
  'THINGSBOARD_HOST': 'thingsboard_host',
  'THINGSBOARD_PORT': 'thingsboard_port',
  'THINGSBOARD_PASSWORD': 'thingsboard_password',
  'THINGSBOARD_URL': 'thingsboard_url',
  // ... và các biến khác
};
```

## Các file đã được cập nhật

### 1. `src/configs/index.ts`

**Trước:**
```typescript
export default {
    port: Number(process.env.PORT || 3000),
    serverUrl: process.env.VIIS_BACKEND || 'https://iot.viis.tech',
    // ...
};
```

**Sau:**
```typescript
export function createConfig(nodeContext?: NodeContext) {
    const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;
    
    const getEnvVar = (envVarName: string, defaultValue?: any): any => {
        if (helper) {
            return helper.getEnvVar(envVarName, defaultValue);
        }
        return process.env[envVarName] || defaultValue;
    };

    return {
        port: getNumericEnvVar('PORT', 3000),
        serverUrl: getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech'),
        // ...
    };
}

// Backward compatibility
export default createConfig();
```

### 2. `src/modules/viis-telemetry/viis-telemetry-config.ts`

Cập nhật method `getEnvironmentConfig()` để sử dụng global context:

```typescript
getEnvironmentConfig(): EnvironmentConfig {
    const globalContext = this.nodeContext?.global;
    
    const getEnvVar = (envVarName: string, defaultValue?: any): any => {
        if (globalContext) {
            const mapping = {
                'DEVICE_ID': 'device_id',
                'MODBUS_COILS': 'modbusCoils',
                // ...
            };
            
            const globalVarName = mapping[envVarName];
            if (globalVarName) {
                const globalValue = globalContext.get(globalVarName);
                if (globalValue !== undefined) {
                    return globalValue;
                }
            }
        }
        
        return process.env[envVarName] || defaultValue;
    };

    return {
        deviceId: getEnvVar('DEVICE_ID', "unknown"),
        modbusCoils: getJsonEnvVar('MODBUS_COILS', {}),
        // ...
    };
}
```

### 3. `src/modules/viis-telemetry/viis-telemetry.ts`

Cập nhật API endpoint để sử dụng global context:

```typescript
RED.httpAdmin.get('/viis-telemetry/modbus-keys', (_req, res) => {
    const globalContext = RED.settings.functionGlobalContext || {};
    
    const getJsonEnvVar = (envVarName: string, globalVarName: string, defaultValue: any = {}): any => {
        // Try global context first
        const globalValue = globalContext[globalVarName];
        if (globalValue !== undefined) {
            return typeof globalValue === 'object' ? globalValue : defaultValue;
        }
        
        // Fallback to process.env
        const processValue = process.env[envVarName];
        if (processValue) {
            try {
                return JSON.parse(processValue);
            } catch (error) {
                return defaultValue;
            }
        }
        
        return defaultValue;
    };

    const modbusCoils = getJsonEnvVar('MODBUS_COILS', 'modbusCoils', {});
    // ...
});
```

## Cách sử dụng

### 1. Trong Node Configuration

```typescript
import { createConfig } from '../configs';
import { createGlobalContextHelper } from '../ultils/global-context-helper';

function MyNode(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);
    
    // Sử dụng config với global context
    const nodeConfig = createConfig(this.context());
    
    // Hoặc sử dụng helper trực tiếp
    const helper = createGlobalContextHelper(this.context());
    const deviceId = helper.getEnvVar('DEVICE_ID', 'unknown');
    const modbusConfig = helper.getJsonEnvVar('MODBUS_COILS', {});
}
```

### 2. Trong Utility Functions

```typescript
import { getEnvVar, getJsonEnvVar } from '../ultils/global-context-helper';

function someUtilityFunction(nodeContext: NodeContext) {
    const deviceId = getEnvVar(nodeContext, 'DEVICE_ID', 'unknown');
    const modbusCoils = getJsonEnvVar(nodeContext, 'MODBUS_COILS', {});
}
```

## Hot Reload Workflow

1. **Env-loader node** đọc file `.env` và load vào global context
2. **File watcher** phát hiện thay đổi trong `.env`
3. **Auto-reload** được trigger, cập nhật global context
4. **Custom nodes** tự động sử dụng giá trị mới từ global context

## Backward Compatibility

- Tất cả các node vẫn hoạt động với process.env nếu global context không có
- Default export của config vẫn sử dụng process.env
- Không cần thay đổi existing flows

## Testing

Để test hot-reload functionality:

1. Deploy flow với env-loader node và viis-telemetry node
2. Thay đổi giá trị trong file `.env`
3. Kiểm tra log để xác nhận reload
4. Verify rằng custom nodes sử dụng giá trị mới

## Lưu ý quan trọng

- Env-loader node phải được deploy và chạy trước các custom node khác
- Global context variables có priority cao hơn process.env
- Sensitive variables (như DEVICE_ACCESS_TOKEN) có thể được mask trong log
- Namespace có thể được sử dụng để tránh conflict với global variables khác
