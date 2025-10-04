# VIIS Node-RED Custom Nodes Standardization Guide

## Overview
Hướng dẫn này mô tả cách sử dụng GlobalContextHelper và createConfig để standardize việc đọc environment variables trong các custom nodes.

## Key Changes

### 1. **orm/dataSource.ts**
- Đã thêm `createDataSource(nodeContext?)` factory function
- Sử dụng GlobalContextHelper khi có nodeContext
- Fallback về process.env khi không có context
- Default export vẫn giữ cho backward compatibility

### 2. **configs/index.ts**
- Đã có sẵn `createConfig(nodeContext?)` factory function
- Tự động sử dụng GlobalContextHelper khi có context
- Fallback về process.env

### 3. **services/httpService.ts**
- Constructor nhận optional nodeContext parameter
- Sử dụng GlobalContextHelper để lấy API_BASE_URL

## How to Migrate Your Node

### Step 1: Import Required Modules
```typescript
import { createConfig } from "../configs";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import { createDataSource } from "../orm/dataSource";
```

### Step 2: Use createConfig in Your Node
```typescript
function YourNode(this: Node, config: YourNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;
    
    // Get configuration with global context support
    const appConfig = createConfig(node.context());
    
    // Access variables
    const deviceId = appConfig.deviceId;
    const backendUrl = appConfig.serverUrl;
}
```

### Step 3: For Custom Environment Variables
```typescript
const helper = new GlobalContextHelper(node.context());

// String variables
const customVar = helper.getEnvVar('CUSTOM_VAR', 'default');

// Numeric variables  
const port = helper.getNumericEnvVar('PORT', 3000);

// Boolean variables
const debug = helper.getBooleanEnvVar('DEBUG_MODE', false);

// JSON variables
const modbusRegisters = helper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {});
```

### Step 4: For Database Connections
```typescript
const dataSource = createDataSource(node.context());

if (!dataSource.isInitialized) {
    await dataSource.initialize();
}
```

## Migration Checklist

### Before (Old Way)
```typescript
// Direct process.env access
const deviceId = process.env.DEVICE_ID;
const dbHost = process.env.DATABASE_HOST || 'localhost';
const modbusPort = parseInt(process.env.MODBUS_TCP_PORT || '502');
const modbusCoils = JSON.parse(process.env.MODBUS_COILS || '{}');
```

### After (New Standardized Way)
```typescript
// Using createConfig
const config = createConfig(node.context());
const deviceId = config.deviceId;

// Or using GlobalContextHelper directly
const helper = new GlobalContextHelper(node.context());
const dbHost = helper.getEnvVar('DB_HOST', 'viis-local-mysql');
const modbusPort = helper.getNumericEnvVar('MODBUS_TCP_PORT', 502);
const modbusCoils = helper.getJsonEnvVar('MODBUS_COILS', {});
```

## Build and Deploy

### Build TypeScript
```bash
cd /home/phuongtung0801/Documents/WORK/VIIS/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm run build
```

### Verify Build
```bash
# Check if dist files are updated
ls -la dist/configs/
ls -la dist/ultils/
ls -la dist/orm/
```

### Test in Docker
```bash
# Restart NodeRED container to load new code
docker-compose -f docker-compose-standardized.yml restart nodered1

# Check logs
docker logs -f nodered1
```

## Benefits of Standardization

1. **Hot Reload Support**: Environment variables từ .env files có thể thay đổi mà không cần restart container
2. **Single Source of Truth**: Mỗi device có một file config duy nhất
3. **Consistent Access**: Tất cả nodes dùng cùng một cách để access config
4. **Type Safety**: TypeScript types được maintain
5. **Backward Compatible**: Vẫn fallback về process.env khi cần

## Environment Variable Mapping

| process.env Name | Global Context Name | Config Property |
|-----------------|-------------------|----------------|
| DEVICE_ID | device_id | deviceId |
| DEVICE_ACCESS_TOKEN | device_access_token | deviceAccessToken |
| DEVICE_LABEL | device_label | deviceLabel |
| DB_HOST | db_host | - (used in dataSource) |
| DB_PORT | db_port | - (used in dataSource) |
| MODBUS_HOST | modbus_host | - (use helper) |
| MODBUS_TCP_PORT | modbus_tcp_port | - (use helper) |

## Testing Your Migration

1. **Unit Test**: Check if config loads correctly
```typescript
const config = createConfig(node.context());
console.log('Config loaded:', config);
```

2. **Integration Test**: Verify hot reload
```bash
# Edit env file
nano /services/env/device1.env

# Change DEVICE_LABEL
# Save and watch NodeRED logs for reload
```

3. **Database Test**: Check connection
```typescript
const ds = createDataSource(node.context());
await ds.initialize();
console.log('Database connected:', ds.isInitialized);
```

## Common Issues

### Issue: TypeScript compilation errors
**Solution**: Make sure all imports are correct
```bash
npm run build
# Fix any TypeScript errors shown
```

### Issue: Config not loading from global context
**Solution**: Ensure env-loader node is deployed and running
- Check env-loader status in Node-RED
- Verify .env files are mounted correctly

### Issue: Database connection fails
**Solution**: Check DB_HOST uses container name
```typescript
// Should be 'viis-local-mysql' not 'localhost' or IP
DB_HOST=viis-local-mysql
```

## Next Steps

1. Migrate remaining nodes that use process.env directly
2. Test hot reload functionality
3. Document any custom environment variables
4. Update CI/CD pipeline if needed

## Support

For questions or issues:
1. Check this guide
2. See `examples/standardized-node-template.ts` for full example
3. Review GlobalContextHelper implementation in `ultils/global-context-helper.ts`
