# viis-marine-telemetry Node

Custom Node-RED node for Marine IoT telemetry with oil profile tracking and flow sensor data enrichment.

## 📋 Overview

Extends standard `viis-telemetry` with Marine IoT capabilities:
- Polls Modbus data (coils, input registers, holding registers)
- Enriches flow sensor data (fs01-fs06) with oil profile information
- Saves enriched data to database with density snapshots
- Publishes telemetry to both EMQX and ThingsBoard

## 🎯 Key Features

### Standard Telemetry
- Poll Modbus coils, input registers, holding registers
- Threshold-based change detection
- Periodic snapshot support
- Dual MQTT publishing (EMQX + ThingsBoard)

### Marine IoT Extension
- **Oil Profile Tracking**: Automatically tracks active oil profile (BO/DO/HFO)
- **Density Snapshot**: Records density at time of reading
- **Flow Sensor Enrichment**: Adds profile context to fs01-fs06 data
- **Database Integration**: Saves to `tabiot_device_telemetry` with `oil_profile_id` and `density_snapshot`
- **Machine-Specific Profiles**: Different profiles for Generator, Main Engine, Boiler

## 🔧 Configuration

### Marine IoT Settings

**Enable Marine IoT**
- Enable/disable Marine IoT features
- Default: `true`

**Flow Sensor Keys**
- Comma-separated list of flow sensor keys
- Default: `fs01,fs02,fs03,fs04,fs05,fs06`

**Profile Cache Duration**
- How long to cache active oil profile (ms)
- Default: `300000` (5 minutes)
- Reduces database queries

### Modbus Polling

**Poll Intervals**
- Coil Poll Interval: Default `1000ms`
- Input Poll Interval: Default `1000ms`
- Holding Poll Interval: Default `5000ms`

**Address Configuration**
- Coil Start Address / Quantity
- Input Start Address / Quantity
- Holding Start Address / Quantity

### Advanced

**Threshold Configuration**
- Change detection thresholds per key
- Format: `{"key": threshold}` or `{"all": 0.1}`

**Periodic Snapshot**
- Publish data even without changes
- Separate intervals for coil/input/holding

**Debug Log**
- Enable verbose logging

## 📊 Data Flow

```
┌─────────────────────────────────────────┐
│  Poll Modbus                            │
│  - Coils (1s interval)                  │
│  - Input Registers (1s interval)        │
│  - Holding Registers (5s interval)      │
└─────────────────────────────────────────┘
              ↓
    ┌─────────────────────┐
    │  Standard Telemetry │
    │  (Threshold check)  │ → Node Output
    │                     │ → MQTT (if changed)
    └─────────────────────┘
              +
    ┌─────────────────────┐
    │  Marine Flow Data   │
    │  (fs01-fs06)        │
    └─────────────────────┘
              ↓
    ┌─────────────────────┐
    │  Enrich with        │
    │  Oil Profile        │
    │  + Density          │
    └─────────────────────┘
              ↓
    ┌─────────────────────┐
    │  Save to Database   │
    │  (Every poll)       │
    └─────────────────────┘
              ↓
    ┌─────────────────────┐
    │  Publish MQTT       │
    │  ThingsBoard        │
    └─────────────────────┘
```

## 📤 Output Format

### Node Output (Standard Telemetry)
```javascript
{
    payload: {
        "pump_air": 1,
        "pump_irrigation": 0,
        "valve_1": 1,
        // ... other coils/registers
        // NOTE: fs01-fs06 NOT in output (saved directly to DB)
    }
}
```

### Database Records (Flow Sensors)
```javascript
// Saved to tabiot_device_telemetry
{
    device_id: "ship_001",
    timestamp: 1737453600000,
    key_name: "fs01",
    value_type: "float",
    float_value: 25.5,
    oil_profile_id: "BO_Generator",  // ← Marine IoT
    density_snapshot: 950             // ← Marine IoT (kg/m³)
}
```

### MQTT Payload (ThingsBoard)
```json
{
    "ts": 1737453600000,
    "fs01": 25.5,
    "fs02": 30.2,
    "fs03": 18.7,
    "fs04": 20.1,
    "fs05": 22.3,
    "fs06": 19.8
}
```

## 🗄️ Database Schema

### Enhanced Telemetry Table
```sql
CREATE TABLE tabiot_device_telemetry (
    id INT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(255),
    timestamp BIGINT,
    key_name VARCHAR(255),
    value_type ENUM('int', 'float', 'string', 'boolean', 'json'),
    float_value FLOAT,
    -- Marine IoT fields:
    oil_profile_id VARCHAR(255),      -- Profile name at time of reading
    density_snapshot FLOAT,            -- Density (kg/m³) for m³→tons conversion
    UNIQUE KEY (device_id, timestamp, key_name)
);
```

## 🛢️ Oil Profile System

### Machine Types
- **MAIN_ENGINE** (fs01-fs02): Ship propulsion engines (Máy chính 1, 2)
- **GENERATOR** (fs03-fs04): Main generator engines (Máy phát 3, 4)
- **BOILER** (fs05-fs06): Auxiliary boilers (Nồi hơi 5, 6)

### Oil Types
- **BO** (Bunker Oil): Heavy fuel oil
- **DO** (Diesel Oil): Marine diesel
- **HFO** (Heavy Fuel Oil): High viscosity fuel

### Profile Structure
```javascript
{
    name: "BO_Generator_850",
    device_id: "ship_001",
    machine_type: "GENERATOR",
    oil_type: "BO",
    operating_temperature: 85,
    density: 950,  // kg/m³
    label: "BO 85°C Generator",
    is_active: true
}
```

### Profile Caching
- Profiles cached for 5 minutes (configurable)
- Reduces database load
- Refreshes automatically when cache expires
- Can be manually cleared via input message

## 📥 Input Messages

### Clear Profile Cache
```javascript
{
    clearProfileCache: true
}
```

### Get Cache Status
```javascript
{
    getCacheStatus: true
}
```

**Response:**
```javascript
{
    payload: {
        hasCache: true,
        age: 120000,  // ms since loaded
        profile: {
            name: "BO_Generator_850",
            density: 950
        }
    }
}
```

### Update Threshold Config
```javascript
{
    thresholdConfig: {
        "fs01": 0.5,
        "fs02": 0.5,
        "all": 0.1
    }
}
```

### Enable/Disable Debug Log
```javascript
{
    enableDebugLog: true
}
```

## ⏱️ Polling Behavior

### Frequency
- **Coils**: Every 1 second
- **Input Registers**: Every 1 second
- **Holding Registers**: Every 5 seconds (includes fs01-fs06)

### Data Volume
Flow sensors generate approximately:
- **12 samples/minute** × 6 sensors = 72 samples/minute
- **720 samples/hour** × 6 sensors = 4,320 records/hour
- **~104,000 records/day** for all 6 sensors

### Storage Recommendations
- Implement data retention policy (e.g., 90 days)
- Use database partitioning for large datasets
- Regular cleanup of old telemetry data

```sql
-- Example cleanup query
DELETE FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06')
  AND timestamp < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 90 DAY)) * 1000;
```

## 🔄 Hot Reload Support

This node supports hot-reload for Modbus configuration changes:

1. Modify env files in `/services/env/`
2. Wait 30-40 seconds for auto-reload
3. **No rebuild or restart required**

**Requires:** `env-loader` node must be deployed in flow

## 📊 Sensor Mapping Example

### Environment Configuration
```env
# device1.env
MODBUS_BOARD1_HOLDING_REGISTERS={
    "fs01": 0,
    "fs02": 1,
    "fs03": 2,
    "fs04": 3,
    "fs05": 4,
    "fs06": 5,
    "error_fs01": 90,
    "error_fs02": 91
}
```

### Result
- Holding register 0 → fs01 (Main engine inlet)
- Holding register 1 → fs02 (Main engine return)
- Holding register 2 → fs03 (Generator inlet)
- etc.

## 🚀 Usage Example

### Basic Flow
```
[viis-marine-telemetry]
         ↓
    [Debug]  ← See standard telemetry
```

### With Accumulation
```
[viis-marine-telemetry]  ← Runs continuously
         
[viis-flow-accumulation] ← Runs hourly via cron
         ↓
    [Debug]  ← See hourly accumulation
```

### Configuration Example
```javascript
{
    name: "Marine Telemetry",
    enableMarineIoT: true,
    flowSensorKeys: "fs01,fs02,fs03,fs04,fs05,fs06",
    profileCacheDuration: "300000",
    pollIntervalHolding: "5000",
    enableDebugLog: false,
    thresholdConfig: "{\"all\": 0.1}"
}
```

## 🔍 Monitoring & Debugging

### Enable Debug Logging
Set `enableDebugLog: true` in node config

**Expected logs:**
```
[Marine] Marine IoT enabled for sensors: fs01, fs02, fs03, fs04, fs05, fs06
[Marine] Database connection initialized
[Marine] Loaded active profile: BO_Generator (GENERATOR, BO, density: 950)
[Marine] Processed 6 flow sensor readings with profiles: BO_Generator
[Marine] Saved 6 flow sensor records to database
```

### Check Database Records
```sql
-- Recent flow sensor data
SELECT * FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06')
  AND timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL 5 MINUTE) * 1000
ORDER BY timestamp DESC
LIMIT 50;

-- Verify oil profile enrichment
SELECT 
    key_name,
    float_value,
    oil_profile_id,
    density_snapshot,
    FROM_UNIXTIME(timestamp/1000) as time
FROM tabiot_device_telemetry
WHERE key_name = 'fs01'
ORDER BY timestamp DESC
LIMIT 10;
```

### MQTT Monitoring
Subscribe to ThingsBoard topics:
```
v1/devices/me/telemetry
v1/devices/me/attributes
```

## ⚠️ Troubleshooting

### No flow sensor data in database

**Check:**
1. Is Marine IoT enabled? (`enableMarineIoT: true`)
2. Is database connected? (Check logs for connection errors)
3. Are holding registers mapped correctly? (Check env file)
4. Is Modbus polling working? (Check node status)

### Oil profile is null

**Possible causes:**
1. No active oil profile configured for device
2. Database connection issue
3. Profile cache expired and couldn't refresh

**Solution:**
- Create/activate an oil profile for the device
- Check database connectivity
- Verify oil profile table exists

### Database connection error: ECONNREFUSED

**Common causes:**
1. Using wrong database host (localhost vs container name)
2. Env variables not loaded (missing `env-loader` node)
3. Database container not running

**Fix:**
1. Verify `DATABASE_HOST=viis-local-mysql` in common.env
2. Ensure `env-loader` node is deployed and running
3. Check: `docker ps | grep mysql`

### Performance issues

**If polling is slow:**
1. Reduce poll intervals
2. Reduce number of registers to poll
3. Check Modbus network latency

**If database is slow:**
1. Add indexes on timestamp and key_name
2. Implement data retention policy
3. Consider time-series database for high volume

## 🔗 Related Components

- **viis-flow-accumulation**: Calculates hourly accumulation
- **viis-telemetry**: Base telemetry node (non-Marine)
- **OilProfileService**: Manages oil profiles
- **FlowAccumulationService**: Calculates accumulation
- **env-loader**: Loads environment variables

## 📦 Dependencies

- `typeorm` - Database ORM
- `mqtt` - MQTT publishing
- `modbus-serial` - Modbus communication

## 📝 Version History

- **v1.0.3** - Current version
  - Marine IoT oil profile tracking
  - Multi-machine profile support
  - Enhanced database schema with oil_profile_id and density_snapshot
  - Hot-reload support for Modbus config

## 🎓 Best Practices

1. **Always deploy env-loader node** for hot-reload to work
2. **Set appropriate cache duration** to balance load and accuracy
3. **Monitor database size** and implement retention policy
4. **Use debug log** only for troubleshooting (verbose output)
5. **Create oil profiles** before deploying for accurate density tracking
6. **Separate profiles per machine** for better accuracy

## 👥 Support

For issues or questions, refer to the VIIS Node-RED documentation or contact the development team.
