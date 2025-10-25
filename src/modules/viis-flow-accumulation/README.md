# viis-flow-accumulation Node

Custom Node-RED node for calculating and publishing hourly flow sensor accumulation data for Marine IoT systems.

## 📋 Overview

This node automatically calculates hourly accumulation data from flow sensors (fs01-fs06), storing results in the database and publishing to ThingsBoard via MQTT.

## 🎯 Features

- **Scheduled Calculation**: Auto-calculate accumulation every hour using cron
- **Manual Trigger**: Calculate specific hours on demand
- **Backfill Support**: Fill historical data for date ranges
- **MQTT Publishing**: Send results to ThingsBoard
- **Database Storage**: Save to `tabiot_flow_accumulation` table

## 🔧 Configuration

### Auto Calculation
- **Enable Auto Calculation**: Enable/disable scheduled calculations
- **Cron Schedule**: Cron expression (default: `5 * * * *` = 5 minutes past every hour)

### MQTT Publishing
- **Publish to MQTT**: Enable/disable MQTT publishing
- **MQTT Topic**: ThingsBoard topic (default: `v1/devices/me/telemetry`)

### Backfill
- **Enable Backfill**: Allow backfilling historical data via input messages

## 📥 Input Messages

### Manual Calculation
```javascript
{
    topic: "calculate",
    payload: {
        hourStart: "2025-01-20T14:00:00Z"  // Optional, defaults to previous hour
    }
}
```

### Backfill Historical Data
```javascript
{
    topic: "backfill",
    payload: {
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-20T00:00:00Z"
    }
}
```

### Get Node Status
```javascript
{
    topic: "status"
}
```

## 📤 Output Format

### Node Output
```javascript
{
    payload: [
        {
            sensor_key: "fs01",
            hour_start: Date,
            hour_end: Date,
            avg_flow_m3h: 25.5,
            accumulated_m3: 25.5,
            accumulated_tons: 24.225,
            oil_profile_id: "BO_Generator",
            density_used: 950,
            sample_count: 60,
            device_id: "ship_001"
        },
        // ... fs02-fs06
    ]
}
```

### MQTT Payload (ThingsBoard Format)
```json
{
    "ts": 1737453600000,
    "hour_start": "2025-01-20T14:00:00Z",
    "hour_end": "2025-01-20T15:00:00Z",
    "fs01_avg_flow_m3h": 25.5,
    "fs01_accumulated_m3": 25.5,
    "fs01_accumulated_tons": 24.225,
    "fs01_oil_profile": "DO_MainEngine",
    "fs01_density": 950,
    "fs01_samples": 60,
    "fs02_avg_flow_m3h": 30.2,
    "fs02_accumulated_m3": 30.2,
    "fs02_accumulated_tons": 28.69,
    "fs02_oil_profile": "DO_MainEngine",
    "fs02_density": 950,
    "fs02_samples": 60
}
```

**Key Features:**
- Flat structure with sensor-prefixed keys
- Uses `ts` field (ThingsBoard standard)
- No `device_id` in payload (handled by MQTT access token)
- Easy to map in ThingsBoard dashboards

## 🗄️ Database Schema

Data is saved to `tabiot_flow_accumulation` table:

```sql
CREATE TABLE tabiot_flow_accumulation (
    id INT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(255),
    sensor_key VARCHAR(255),
    hour_start DATETIME,
    hour_end DATETIME,
    avg_flow_m3h FLOAT,
    accumulated_m3 FLOAT,
    accumulated_tons FLOAT,
    oil_profile_id VARCHAR(255),
    density_used FLOAT,
    sample_count INT,
    first_sample_ts BIGINT,
    last_sample_ts BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (device_id, sensor_key, hour_start)
);
```

## ⏱️ Cron Schedule Examples

- `5 * * * *` - Every hour at 5 minutes past (recommended)
- `0 * * * *` - Every hour at the start
- `*/30 * * * *` - Every 30 minutes
- `0 */2 * * *` - Every 2 hours
- `0 0 * * *` - Daily at midnight

## 🔄 Workflow

```
┌─────────────────────────────────────────┐
│  viis-marine-telemetry                  │
│  - Poll Modbus every 5s                 │
│  - Save to tabiot_device_telemetry      │
└─────────────────────────────────────────┘
              ↓ (Save to DB)
         [Database]
              ↑ (Read from DB)
┌─────────────────────────────────────────┐
│  viis-flow-accumulation                 │
│  - Run cron every hour at :05           │
│  - Read 720 samples from DB             │
│  - Calculate average & accumulation     │
│  - Save to tabiot_flow_accumulation     │
│  - Publish MQTT to ThingsBoard          │
└─────────────────────────────────────────┘
```

## 📊 Calculation Logic

### Average Flow Rate
```
avg_flow_m3h = SUM(all samples in hour) / sample_count
```

### Accumulated Volume (m³)
```
accumulated_m3 = avg_flow_m3h × 1 hour
```

### Accumulated Weight (tons)
```
accumulated_tons = accumulated_m3 × (density_kg/m³ ÷ 1000)
```

### Example:
- Average flow: 25.5 m³/h
- Density: 950 kg/m³
- **Accumulated m³**: 25.5 m³
- **Accumulated tons**: 25.5 × 0.95 = 24.225 tons

## 🚀 Usage Example

### Option 1: Auto Calculation (Recommended)

```
[viis-marine-telemetry]  ← Runs continuously
         
[viis-flow-accumulation] ← Runs auto via cron
         ↓
    [Debug]
```

**Config:**
```javascript
{
    name: "Hourly Accumulation",
    enableAutoCalculation: true,
    cronSchedule: "5 * * * *",
    publishToMqtt: true,
    mqttTopic: "v1/devices/me/telemetry"
}
```

### Option 2: Manual Trigger

```
[Inject: Manual]
   ↓
[Function: Prepare]
   ↓
[viis-flow-accumulation]
   ↓
[Debug]
```

**Function node:**
```javascript
// Calculate specific hour
msg = {
    topic: "calculate",
    payload: {
        hourStart: "2025-01-20T14:00:00Z"
    }
};
return msg;
```

## ⚠️ Important Notes

### 1. Independence from Marine Telemetry
- **DO NOT** wire marine-telemetry output to flow-accumulation input
- Flow-accumulation reads from database, not from node output
- Both nodes work independently

### 2. Data Requirements
- Requires `viis-marine-telemetry` to be running
- Needs at least 1 hour of data in `tabiot_device_telemetry`
- Oil profile affects density calculation

### 3. Timing
- Default schedule: 5 minutes past every hour
- Calculates data for the **previous** hour
- Example: At 15:05, calculates 14:00-15:00

### 4. Oil Profile
- Uses `oil_profile_id` and `density_snapshot` from telemetry
- If no profile, uses default density (1000 kg/m³)
- Different profiles = different tons calculation

## 🔍 Troubleshooting

### No accumulation data generated

**Check:**
1. Is `viis-marine-telemetry` running?
2. Is there data in `tabiot_device_telemetry`?
3. Check Node-RED logs for errors
4. Verify cron schedule is correct

**Query to check source data:**
```sql
SELECT COUNT(*) as sample_count
FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06')
  AND timestamp >= UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 1 HOUR)) * 1000
  AND timestamp < UNIX_TIMESTAMP(NOW()) * 1000;
```

### MQTT not publishing

**Check:**
1. Is `publishToMqtt` enabled?
2. Is ThingsBoard MQTT client connected?
3. Check `DEVICE_ACCESS_TOKEN` in env
4. Verify topic is correct

### Manual trigger not working

**Check:**
1. Message format is correct
2. `hourStart` is valid ISO date
3. There is data for that hour in DB

## 📚 Related Components

- **viis-marine-telemetry**: Collects realtime flow sensor data
- **FlowAccumulationService**: Core calculation logic
- **TabiotFlowAccumulation**: Database entity
- **TabiotDeviceTelemetry**: Source data table

## 🔗 Dependencies

- `cron@^3.1.7` - Job scheduling
- `typeorm` - Database ORM
- `mqtt` - ThingsBoard publishing

## 📝 Version History

- **v1.0.0** - Initial release with auto calculation and MQTT publishing
- Supports hourly accumulation for 6 flow sensors
- ThingsBoard-compatible flat payload format

## 👥 Support

For issues or questions, refer to the VIIS Node-RED documentation or contact the development team.
