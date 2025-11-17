# viis-marine-telemetry Node

Custom Node-RED node for Marine IoT telemetry with oil profile tracking and DH6400 flow sensor integration.

## 📋 Overview

Specialized node for Marine IoT with DH6400 flowmeter capabilities:
- **DH6400 Serial Polling**: Direct serial communication with 6-channel DH6400 flowmeters
- **Dual Flow Metrics**: Tracks both instantaneous flow (fs01-fs06) and total accumulated flow (tfs01-tfs06)
- **Oil Profile Enrichment**: Enriches flow sensor data with machine-specific oil profiles
- **Trip Accumulation**: Real-time trip-based fuel consumption tracking with checkpoint system
- **Database Integration**: Saves enriched telemetry with oil_profile_id and density_snapshot
- **ThingsBoard Publishing**: Throttled MQTT publishing with configurable intervals

## 🎯 Key Features

### DH6400 Serial Communication
- **Direct Serial Polling**: Communicates with DH6400 flowmeters via RS485/serial (default: `/dev/ttyACM0`)
- **Multi-Channel Support**: Polls up to 6 channels (slave IDs 1-6) on single serial bus
- **25-Byte Protocol**: Implements DH6400 proprietary protocol for data extraction
- **Configurable Polling**: Default 10-second intervals (configurable via env or node config)
- **Robust Error Handling**: Automatic retry with exponential backoff, error event emission

### Dual Flow Metrics
- **Instantaneous Flow (fs01-fs06)**: Current flow rate in m³/h for each channel
- **Total Accumulated Flow (tfs01-tfs06)**: Cumulative total volume in m³ since DH6400 power-on
- **Checkpoint-Based Delta Calculation**: Detects TFS resets and calculates accurate deltas
- **Trip Accumulation**: Tracks consumption per active trip using delta values

### Marine IoT Oil Profile System
- **Machine-Specific Profiles**: Separate oil profiles for BOILER, MAIN_ENGINE, GENERATOR_HFO, GENERATOR_DO
- **Density Tracking**: Records density snapshot (kg/m³) for m³ → tons conversion
- **Profile Caching**: 5-minute cache to reduce database load
- **Automatic Enrichment**: All flow data tagged with active oil profile and density

### MQTT Publishing with Throttling
- **Dual Publish Intervals**:
  - fs data (instant flow): Every 10 minutes (configurable via `fsPublishInterval`)
  - tfs data (total accumulated): Every 60 minutes (configurable via `tfsPublishInterval`)
- **Data Caching**: Stores latest values between publish intervals
- **ThingsBoard Integration**: Publishes to `v1/devices/me/telemetry` topic
- **Error Reporting**: Sends DH6400 errors to output for `viis-error-trigger` node

## 🔧 Configuration

### Environment Variables (Required)

```env
# DH6400 Serial Configuration
DH6400_SERIAL_PORT=/dev/ttyACM0          # Serial port for DH6400 (RS485/USB)
DH6400_BAUD_RATE=9600                     # Serial baud rate (default: 9600)
DH6400_POLLING_INTERVAL=10000             # Polling interval in ms (default: 10 seconds)
DH6400_ENABLED_CHANNELS=1,2,3,4,5,6       # Slave IDs to poll (1-6)

# ThingsBoard MQTT
THINGSBOARD_MQTT_BROKER=mqtt://thingsboard:1883
DEVICE_ACCESS_TOKEN=your_device_token

# Database
DATABASE_HOST=viis-local-mysql
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=viis_iot

# Device Identity
DEVICE_ID=ship_001
```

### Node Configuration

**Enable Marine IoT**
- Enable/disable Marine IoT oil profile tracking
- Default: `true`

**Flow Sensor Keys**
- Comma-separated list of flow sensor keys
- Default: `fs01,fs02,fs03,fs04,fs05,fs06`
- Maps to DH6400 channels 1-6

**Profile Cache Duration**
- How long to cache active oil profiles (ms)
- Default: `300000` (5 minutes)
- Reduces database load while maintaining accuracy

**DH6400 Polling Interval** (Optional)
- Overrides `DH6400_POLLING_INTERVAL` env variable
- Set in node configuration if per-node interval needed

**FS Publish Interval**
- How often to publish instantaneous flow data to ThingsBoard
- Default: `600000` (10 minutes)
- Controls fs01-fs06 publish frequency

**TFS Publish Interval**
- How often to publish total accumulated flow data to ThingsBoard
- Default: `3600000` (60 minutes)
- Controls tfs01-tfs06 publish frequency

## 📊 Data Flow

```
┌──────────────────────────────────────────────────────────┐
│  DH6400 Serial Polling (Every 10 seconds)                │
│  - Polls channels 1-6 sequentially via RS485             │
│  - Extracts: instantFlowM3h + totalAccumulatedM3        │
└──────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Parse DH6400 25-Byte Response      │
        │  - Channel 1-6 → fs01-fs06          │
        │  - Channel 1-6 → tfs01-tfs06        │
        └─────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Enrich with Oil Profiles           │
        │  - Query machine-specific profile   │
        │  - Add oil_profile_id + density     │
        │  - Cache for 5 minutes              │
        └─────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Save to Database (Every poll)      │
        │  - fs01-fs06: instant flow + profile│
        │  - tfs01-tfs06: total flow + profile│
        └─────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Calculate TFS Delta                │
        │  - Compare with last checkpoint     │
        │  - Detect resets (decrease)         │
        │  - Calculate m³ and tons delta      │
        └─────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Update Trip Accumulation           │
        │  - Add delta to active trip         │
        │  - Track per sensor (fs01-fs06)     │
        │  - Update running totals            │
        └─────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────┐
        │  Throttled MQTT Publishing          │
        │  - fs: Every 10 min (instant flow)  │
        │  - tfs: Every 60 min (total flow)   │
        │  → ThingsBoard v1/devices/me/telemetry│
        └─────────────────────────────────────┘
```

## 📤 Output Format

### Node Output (DH6400 Telemetry)

**Success - Telemetry Data:**
```javascript
{
    topic: "dh6400-telemetry",
    payload: {
        // Instantaneous flow (published every 10 min)
        "fs01": 25.5,    // m³/h
        "fs02": 30.2,
        "fs03": 18.7,
        "fs04": 20.1,
        "fs05": 22.3,
        "fs06": 19.8,

        // Total accumulated flow (published every 60 min)
        "tfs01": 1234.5678,  // m³
        "tfs02": 2345.6789,
        "tfs03": 3456.7890,
        "tfs04": 4567.8901,
        "tfs05": 5678.9012,
        "tfs06": 6789.0123,

        "_timestamp": 1737453600000
    }
}
```

**Error - DH6400 Polling Error:**
```javascript
{
    topic: "dh6400-error",
    payload: {
        err_code: "DH6400_NO_RESPONSE_CH3",
        message: "No response from DH6400 channel 3 after 3 retries",
        severity: "medium",
        type: "warning",
        entity: "DH6400_CHANNEL_3",
        metadata: {
            channel: 3,
            serialPort: "/dev/ttyACM0",
            retries: 3
        }
    }
}
```

### Database Records

**Instantaneous Flow Sensors (fs01-fs06):**
```javascript
// Saved to tabiot_device_telemetry every poll (~10 seconds)
{
    device_id: "ship_001",
    timestamp: 1737453600000,
    key_name: "fs01",
    value_type: "float",
    float_value: 25.5,              // m³/h (instant flow rate)
    oil_profile_id: "BO_BOILER",    // Active profile for BOILER
    density_snapshot: 950           // kg/m³ from active profile
}
```

**Total Accumulated Flow (tfs01-tfs06):**
```javascript
// Saved to tabiot_device_telemetry every poll (~10 seconds)
{
    device_id: "ship_001",
    timestamp: 1737453600000,
    key_name: "tfs01",
    value_type: "float",
    float_value: 1234.5678,         // m³ (total since DH6400 power-on)
    oil_profile_id: "BO_BOILER",
    density_snapshot: 950
}
```

### MQTT Payload (ThingsBoard)

**Published every 10 minutes (fs):**
```json
{
    "fs01": 25.5,
    "fs02": 30.2,
    "fs03": 18.7,
    "fs04": 20.1,
    "fs05": 22.3,
    "fs06": 19.8
}
```

**Published every 60 minutes (tfs):**
```json
{
    "tfs01": 1234.5678,
    "tfs02": 2345.6789,
    "tfs03": 3456.7890,
    "tfs04": 4567.8901,
    "tfs05": 5678.9012,
    "tfs06": 6789.0123
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
    UNIQUE KEY (device_id, timestamp, key_name),
    INDEX idx_key_timestamp (key_name, timestamp),
    INDEX idx_device_timestamp (device_id, timestamp)
);
```

### Trip Accumulation Table
```sql
CREATE TABLE tabiot_trip_accumulation (
    id INT PRIMARY KEY AUTO_INCREMENT,
    trip_id VARCHAR(255),
    device_id VARCHAR(255),
    sensor_key VARCHAR(50),           -- fs01-fs06
    total_volume_m3 DECIMAL(15, 4),   -- Running total in m³
    total_volume_tons DECIMAL(15, 4), -- Running total in tons
    current_density FLOAT,             -- Current oil density
    oil_profile_id VARCHAR(255),      -- Current active profile
    last_update_time BIGINT,
    sample_count INT,
    UNIQUE KEY (trip_id, sensor_key)
);
```

### Flow Checkpoint Table
```sql
CREATE TABLE tabiot_flow_checkpoint (
    id INT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(255),
    sensor_key VARCHAR(50),           -- tfs01-tfs06
    checkpoint_type VARCHAR(50),      -- 'trip' or 'hourly'
    checkpoint_value DECIMAL(15, 4),  -- Last TFS value (m³)
    checkpoint_time BIGINT,
    UNIQUE KEY (device_id, sensor_key, checkpoint_type)
);
```

## 🛢️ Oil Profile System

### Machine Types & Sensor Mapping (4-Machine Configuration)

```javascript
const MACHINE_SENSOR_MAP = {
    BOILER: ['fs01'],                    // Direct consumption, no return
    MAIN_ENGINE: ['fs02', 'fs03'],       // fs02 (in) - fs03 (return)
    GENERATOR_HFO: ['fs03', 'fs04'],     // fs03 (in) - fs04 (return)
    GENERATOR_DO: ['fs05', 'fs06']       // fs05 (in) - fs06 (return)
};
```

**Note:** fs03 is shared between MAIN_ENGINE (return) and GENERATOR_HFO (inlet)

### Oil Types
- **BO** (Bunker Oil): Heavy fuel oil for boiler
- **DO** (Diesel Oil): Marine diesel for generators
- **HFO** (Heavy Fuel Oil): High viscosity fuel for main engine/generators

### Profile Structure
```javascript
{
    name: "BO_BOILER",
    device_id: "ship_001",
    machine_type: "BOILER",
    oil_type: "BO",
    operating_temperature: 85,
    density: 950,  // kg/m³
    label: "BO 85°C Boiler",
    is_active: true
}
```

### Profile Caching
- **Per-Machine Caching**: Each machine type has separate cache
- **Cache Duration**: 5 minutes (configurable via `profileCacheDuration`)
- **Auto-Refresh**: Refreshes automatically when cache expires
- **Manual Clearing**: Can be cleared via input message (`clearProfileCache: true`)
- **Reduces Database Load**: Minimizes queries while maintaining accuracy

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

## ⏱️ Polling & Publishing Behavior

### DH6400 Polling Frequency
- **Default Interval**: 10 seconds (configurable)
- **Sequential Polling**: Channels 1-6 polled one after another
- **Per-Poll Operations**:
  - Read instantaneous flow (m³/h) for 6 channels
  - Read total accumulated flow (m³) for 6 channels
  - Enrich with oil profiles
  - Save to database (fs + tfs)
  - Calculate TFS deltas
  - Update trip accumulation (if active trip)

### MQTT Publishing Frequency
- **fs (instant flow)**: Every 10 minutes (600,000ms)
- **tfs (total accumulated)**: Every 60 minutes (3,600,000ms)
- **Throttling Logic**: Data is cached and published only when interval expires
- **Benefit**: Reduces MQTT traffic while maintaining database granularity

### Data Volume

**Database Storage (High Granularity):**
- **fs01-fs06**: 6 polls/minute × 6 sensors = **36 records/minute**
- **tfs01-tfs06**: 6 polls/minute × 6 sensors = **36 records/minute**
- **Total**: **72 records/minute** = **~104,000 records/day**

**MQTT Publishing (Throttled):**
- **fs**: 6 values every 10 min = **~864 values/day**
- **tfs**: 6 values every 60 min = **~144 values/day**
- **Total**: **~1,008 MQTT publishes/day** (99% reduction vs database)

### Storage Recommendations
- Implement data retention policy (e.g., 90 days for telemetry, keep trip data longer)
- Add indexes on frequently queried columns
- Consider partitioning by timestamp for large datasets
- Regular cleanup of old telemetry data

```sql
-- Example cleanup query (keep last 90 days)
DELETE FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06','tfs01','tfs02','tfs03','tfs04','tfs05','tfs06')
  AND timestamp < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 90 DAY)) * 1000;
```

## 🔄 Hot Reload Support

This node supports hot-reload for DH6400 configuration changes:

1. Modify env files in `/services/env/common.env`
2. Wait 30-40 seconds for env-loader to reload
3. **Restart Node-RED flow** to apply DH6400 serial port changes

**Note:** Serial port changes require flow restart because serial connection is established during node initialization.

**Requires:** `env-loader` node must be deployed in flow

## 📊 DH6400 Channel Mapping

### Physical Connection
```
DH6400 Flowmeter (6 channels)
    ↓ RS485 Serial Bus
USB/RS485 Converter (/dev/ttyACM0)
    ↓ USB
Raspberry Pi / Edge Device
```

### Channel to Sensor Mapping
```javascript
// DH6400 Serial Configuration
const CHANNEL_MAPPING = {
    1: { fs: 'fs01', tfs: 'tfs01', machine: 'BOILER' },
    2: { fs: 'fs02', tfs: 'tfs02', machine: 'MAIN_ENGINE' },
    3: { fs: 'fs03', tfs: 'tfs03', machine: 'MAIN_ENGINE/GENERATOR_HFO' }, // Shared
    4: { fs: 'fs04', tfs: 'tfs04', machine: 'GENERATOR_HFO' },
    5: { fs: 'fs05', tfs: 'tfs05', machine: 'GENERATOR_DO' },
    6: { fs: 'fs06', tfs: 'tfs06', machine: 'GENERATOR_DO' }
};
```

### Flow Routing (4-Machine Configuration)
- **BOILER**: fs01 (inlet only, direct consumption)
- **MAIN_ENGINE**: fs02 (inlet) - fs03 (return)
- **GENERATOR_HFO**: fs03 (inlet) - fs04 (return)
- **GENERATOR_DO**: fs05 (inlet) - fs06 (return)

### SCALE_CONFIGS Example
```env
SCALE_CONFIGS=[
    {"channel": 1, "k_factor": 1.0, "decimal_places": 4},
    {"channel": 2, "k_factor": 1.0, "decimal_places": 4},
    {"channel": 3, "k_factor": 1.0, "decimal_places": 4},
    {"channel": 4, "k_factor": 1.0, "decimal_places": 4},
    {"channel": 5, "k_factor": 1.0, "decimal_places": 4},
    {"channel": 6, "k_factor": 1.0, "decimal_places": 4}
]
```

## 🚀 Usage Example

### Basic Flow (DH6400 Telemetry Only)
```
[viis-marine-telemetry]
         ↓
    [Debug]  ← See DH6400 telemetry + errors
         ↓
[viis-error-trigger]  ← Process DH6400 errors
```

### With Trip Management
```
[Inject: Start Trip] → [viis-trip-start]
                              ↓
                    [viis-marine-telemetry]  ← Polls DH6400 continuously
                              ↓                  Updates trip accumulation
                          [Debug]
                              ↓
[Inject: End Trip] → [viis-trip-end]  ← Get final consumption report
                              ↓
                          [Debug]  ← See trip summary
```

### Node Configuration Example
```javascript
{
    name: "Marine Telemetry DH6400",
    enableMarineIoT: true,
    flowSensorKeys: "fs01,fs02,fs03,fs04,fs05,fs06",
    profileCacheDuration: 300000,      // 5 minutes
    dh6400PollingInterval: 10000,      // 10 seconds
    fsPublishInterval: 600000,          // 10 minutes
    tfsPublishInterval: 3600000         // 60 minutes
}
```

## 🔍 Monitoring & Debugging

### Expected Node-RED Logs

**Initialization:**
```
[Marine] Initializing DH6400 serial polling node...
[Marine] Device ID: ship_001
[Marine] DATABASE_HOST from global context: viis-local-mysql
[Marine] Database connection initialized
[Marine] Marine IoT enabled for sensors: fs01, fs02, fs03, fs04, fs05, fs06
[Marine] DH6400 serial polling enabled for 6 channels
[DH6400Polling] Initialized with 6 channels on /dev/ttyACM0
[DH6400Polling] Connected to /dev/ttyACM0
[Marine] DH6400 polling started
```

**Normal Operation:**
```
[DH6400Polling] fs01: instant=25.50 m³/h, total=1234.5678 m³
[DH6400Polling] fs02: instant=30.20 m³/h, total=2345.6789 m³
[Marine] Received DH6400 data for 6 channels
[Marine] DH6400 tfs01: 1234.5678 m³ (instant: 25.50 m³/h)
[Marine] Processed 6 DH6400 TFS values
[Marine] Saved 6 TFS records to database
[Marine] tfs01 delta: 0.0254 m³ (0.0241 tons)
[Marine] Updated trip accumulation for 6 sensors
[Marine] Data cached, waiting for publish interval (fs: 8.5min, tfs: 58.5min)
```

**Publishing:**
```
[Marine] Publishing fs data (interval: 10.0min)
[Marine] Publishing tfs data (interval: 60.0min)
[Marine] Published 12 values to ThingsBoard
```

### Check Database Records

**Recent flow sensor data (instant + total):**
```sql
-- Last 5 minutes of data
SELECT
    key_name,
    float_value,
    oil_profile_id,
    density_snapshot,
    FROM_UNIXTIME(timestamp/1000) as time
FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06','tfs01','tfs02','tfs03','tfs04','tfs05','tfs06')
  AND timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL 5 MINUTE) * 1000
ORDER BY time DESC, key_name
LIMIT 100;
```

**Verify oil profile enrichment:**
```sql
-- Check if profiles are being applied
SELECT
    key_name,
    AVG(float_value) as avg_flow,
    oil_profile_id,
    AVG(density_snapshot) as avg_density,
    COUNT(*) as sample_count
FROM tabiot_device_telemetry
WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06')
  AND timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL 1 HOUR) * 1000
GROUP BY key_name, oil_profile_id
ORDER BY key_name;
```

**Check trip accumulation:**
```sql
-- Active trip consumption
SELECT
    sensor_key,
    total_volume_m3,
    total_volume_tons,
    oil_profile_id,
    current_density,
    sample_count,
    FROM_UNIXTIME(last_update_time/1000) as last_update
FROM tabiot_trip_accumulation
WHERE trip_id = (SELECT id FROM tabiot_trip WHERE device_id = 'ship_001' AND status = 'active')
ORDER BY sensor_key;
```

### MQTT Monitoring
Subscribe to ThingsBoard topics:
```bash
# ThingsBoard telemetry
mosquitto_sub -h thingsboard -t 'v1/devices/me/telemetry' -u YOUR_TOKEN

# Or use MQTT Explorer / MQTTX
Topic: v1/devices/me/telemetry
```

## ⚠️ Troubleshooting

### No DH6400 data in database

**Check:**
1. Is DH6400 serial port accessible? `ls -la /dev/ttyACM*`
2. Are permissions correct? `sudo chmod 666 /dev/ttyACM0`
3. Is Marine IoT enabled? (`enableMarineIoT: true`)
4. Is database connected? (Check logs for connection errors)
5. Check Node-RED logs for DH6400 polling errors

**Test serial port:**
```bash
# Check if device is detected
dmesg | grep tty

# Test with minicom
minicom -D /dev/ttyACM0 -b 9600
```

### DH6400 polling errors

**Error: "Cannot open /dev/ttyACM0"**
- Port does not exist or wrong name
- Check with `ls -la /dev/tty*`
- Verify `DH6400_SERIAL_PORT` in env

**Error: "Permission denied"**
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER
# Or set permissions
sudo chmod 666 /dev/ttyACM0
```

**Error: "No response from DH6400 channel X"**
- DH6400 device not powered
- Wrong slave ID configured
- RS485 wiring issue (A/B reversed)
- Baud rate mismatch (should be 9600)

### Oil profile is null

**Possible causes:**
1. No active oil profile configured for machine type
2. Database connection issue
3. Profile cache expired and couldn't refresh

**Solution:**
```sql
-- Check existing profiles
SELECT * FROM tabiot_oil_profile WHERE device_id = 'ship_001';

-- Create and activate profile if missing
INSERT INTO tabiot_oil_profile (name, device_id, machine_type, oil_type, density, is_active)
VALUES ('BO_BOILER', 'ship_001', 'BOILER', 'BO', 950, true);
```

### Database connection error: ECONNREFUSED

**Common causes:**
1. Using wrong database host (localhost vs container name)
2. Env variables not loaded (missing `env-loader` node)
3. Database container not running

**Fix:**
1. Verify `DATABASE_HOST=viis-local-mysql` in common.env
2. Ensure `env-loader` node is deployed and running
3. Check: `docker ps | grep mysql`
4. Wait 5 seconds after Node-RED starts for env-loader to initialize

### Trip accumulation not updating

**Check:**
1. Is there an active trip? Query `tabiot_trip` table
2. Are TFS values increasing? Check `tabiot_device_telemetry`
3. Check for TFS reset detection in logs
4. Verify checkpoint table has records

**Debug query:**
```sql
-- Check if checkpoints are being updated
SELECT * FROM tabiot_flow_checkpoint
WHERE device_id = 'ship_001'
ORDER BY checkpoint_time DESC;
```

### Performance issues

**If DH6400 polling is slow:**
1. Reduce `DH6400_POLLING_INTERVAL` (but not below 5 seconds)
2. Disable channels you don't need via `DH6400_ENABLED_CHANNELS`
3. Check serial port quality (USB cable, RS485 converter)

**If database is slow:**
1. Add indexes (already included in schema)
2. Implement data retention policy (delete old data)
3. Consider partitioning `tabiot_device_telemetry` by month

## 🔗 Related Components

### Node-RED Nodes
- **viis-error-trigger**: Processes DH6400 error events and triggers alerts
- **viis-trip-start**: Starts a new fuel consumption trip
- **viis-trip-end**: Ends active trip and generates consumption report
- **env-loader**: Loads environment variables (required for initialization)

### Backend Services
- **DH6400PollingService**: Manages DH6400 serial communication and polling
- **DH6400MultiChannelManager**: Low-level DH6400 protocol implementation
- **OilProfileService**: Manages machine-specific oil profiles
- **TripManagementService**: Handles trip lifecycle (start/end/active)
- **TripAccumulationService**: Calculates running totals per trip
- **FlowCheckpointService**: Manages TFS checkpoints and delta calculation

### Database Tables
- `tabiot_device_telemetry`: Stores fs/tfs data with oil profiles
- `tabiot_trip`: Trip metadata (start time, end time, status)
- `tabiot_trip_accumulation`: Running consumption totals per trip
- `tabiot_flow_checkpoint`: TFS checkpoints for delta calculation
- `tabiot_oil_profile`: Oil profile definitions

## 📦 Dependencies

```json
{
  "typeorm": "^0.3.x",           // Database ORM
  "mqtt": "^4.x",                 // MQTT client for ThingsBoard
  "serialport": "^10.x",          // Serial communication for DH6400
  "typedi": "^0.10.x"             // Dependency injection
}
```

## 📝 Version History

### v2.0.0 - DH6400 Serial Integration (Current)
- ✅ Complete migration from Modbus to DH6400 serial communication
- ✅ Direct 25-byte protocol implementation
- ✅ Dual metrics: instantaneous flow (fs) + total accumulated (tfs)
- ✅ Checkpoint-based TFS delta calculation with reset detection
- ✅ Trip accumulation with running totals
- ✅ Throttled MQTT publishing (10min for fs, 60min for tfs)
- ✅ Per-machine oil profile caching
- ✅ 4-machine configuration support (BOILER, MAIN_ENGINE, GENERATOR_HFO, GENERATOR_DO)

### v1.0.x - Modbus-based (Deprecated)
- ❌ Modbus RTU polling (removed)
- ❌ Single oil profile per device (replaced with per-machine profiles)
- ❌ No trip accumulation (added in v2.0)

## 🎓 Best Practices

1. **Serial Port Setup**
   - Ensure `/dev/ttyACM0` permissions are correct (`chmod 666` or add user to `dialout` group)
   - Use quality USB/RS485 converters to avoid communication errors
   - Keep serial cables short (<10m for RS485)

2. **Oil Profile Management**
   - Create separate profiles for each machine type
   - Set realistic density values (kg/m³) for accurate tons calculation
   - Only activate one profile per machine type at a time
   - Update profiles when fuel type changes

3. **Trip Management**
   - Start trip before departure/fuel consumption begins
   - End trip after vessel arrives/consumption stops
   - Review trip accumulation data before ending trip
   - Archive trip data for reporting/analysis

4. **Database Maintenance**
   - Implement 90-day retention for telemetry data
   - Keep trip data indefinitely for compliance
   - Add indexes if queries become slow
   - Monitor database size regularly

5. **MQTT Publishing**
   - Adjust publish intervals based on ThingsBoard load
   - Use fs interval (10min) for operational monitoring
   - Use tfs interval (60min) for hourly reports
   - Monitor ThingsBoard device activity for data arrival

6. **Error Handling**
   - Connect node output to `viis-error-trigger` for DH6400 errors
   - Monitor error frequency to detect hardware issues
   - Check serial port if errors persist (3+ consecutive failures)

## 👥 Support

For issues or questions:
- Check this README for troubleshooting steps
- Review Node-RED debug logs
- Verify serial port and database connectivity
- Contact the VIIS development team for advanced support
