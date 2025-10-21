# Marine IoT System - Complete Overview

Complete documentation for VIIS Marine IoT telemetry and accumulation system.

## 📋 Table of Contents

- [System Architecture](#system-architecture)
- [Components](#components)
- [Data Flow](#data-flow)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## 🏗️ System Architecture

### Overview

The Marine IoT system consists of two main custom nodes working independently:

```
┌─────────────────────────────────────────────────────────────┐
│                    Marine IoT System                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────┐                              │
│  │  viis-marine-telemetry     │ ← Realtime (every 5s)        │
│  │  - Poll Modbus             │                              │
│  │  - Enrich with oil profile │                              │
│  │  - Save to DB              │                              │
│  │  - Publish MQTT            │                              │
│  └────────────────────────────┘                              │
│              ↓                                                │
│         [Database]                                            │
│  tabiot_device_telemetry                                      │
│  (720 samples/hour × 6 sensors)                               │
│              ↑                                                │
│  ┌────────────────────────────┐                              │
│  │  viis-flow-accumulation    │ ← Hourly (cron at :05)       │
│  │  - Read hour of data       │                              │
│  │  - Calculate averages      │                              │
│  │  - Calculate accumulation  │                              │
│  │  - Save to DB              │                              │
│  │  - Publish MQTT            │                              │
│  └────────────────────────────┘                              │
│              ↓                                                │
│         [Database]                                            │
│  tabiot_flow_accumulation                                     │
│  (6 records/hour × 6 sensors)                                 │
│              ↓                                                │
│       [ThingsBoard]                                           │
│  - Realtime telemetry                                         │
│  - Hourly accumulation                                        │
│  - Dashboards & Analytics                                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧩 Components

### 1. viis-marine-telemetry Node

**Purpose:** Collect and enrich realtime flow sensor data

**Key Features:**
- Polls Modbus every 5 seconds
- Tracks active oil profile per machine
- Enriches fs01-fs06 data with density snapshots
- Saves ALL samples to database (no change detection)
- Publishes to ThingsBoard MQTT

**Documentation:** [viis-marine-telemetry README](src/modules/viis-marine-telemetry/README.md)

### 2. viis-flow-accumulation Node

**Purpose:** Calculate hourly accumulation from realtime data

**Key Features:**
- Runs automatically via cron (default: 5 * * * *)
- Reads 1 hour of telemetry data from DB
- Calculates average flow rates and accumulation
- Supports backfill for historical data
- Publishes flat ThingsBoard-compatible payloads

**Documentation:** [viis-flow-accumulation README](src/modules/viis-flow-accumulation/README.md)

### 3. OilProfileService

**Purpose:** Manage oil profiles for different machines

**Key Features:**
- Multi-machine support (Generator, Main Engine, Boiler)
- Multiple oil types (BO, DO, HFO)
- Temperature-dependent density
- Active profile tracking per machine

**API:** [Oil Profile REST API](src/modules/viis-rest-api/controllers/oil-profile.controller.ts)

### 4. FlowAccumulationService

**Purpose:** Core calculation logic for accumulation

**Methods:**
- `calculateHourlyAccumulation()` - Calculate specific hour
- `calculatePreviousHour()` - Calculate last hour (for cron)
- `backfillAccumulation()` - Fill historical data
- `getDailyTotal()` - Get total for a day

**Location:** [FlowAccumulationService.ts](src/services/MarineIoT/FlowAccumulationService.ts)

---

## 🔄 Data Flow

### Realtime Telemetry Flow

```
1. Modbus Poll (every 5s)
   ↓
2. Read holding registers
   ↓
3. Extract fs01-fs06 values
   ↓
4. Query active oil profile
   ↓
5. Enrich with oil_profile_id + density_snapshot
   ↓
6. Save to tabiot_device_telemetry
   ↓
7. Publish to ThingsBoard MQTT
```

### Hourly Accumulation Flow

```
1. Cron triggers at :05 past hour
   ↓
2. Query previous hour data (e.g., 14:00-15:00)
   ↓
3. For each sensor (fs01-fs06):
   - Calculate avg_flow_m3h
   - Calculate accumulated_m3 = avg × 1 hour
   - Calculate accumulated_tons = m3 × (density/1000)
   ↓
4. Save to tabiot_flow_accumulation
   ↓
5. Format flat payload for ThingsBoard
   ↓
6. Publish to MQTT
```

---

## 🚀 Getting Started

### Prerequisites

1. **Docker environment** with:
   - Node-RED container (nodered1)
   - MySQL container (viis-local-mysql)
   - MQTT broker (EMQX or ThingsBoard)

2. **Database tables:**
   - `tabiot_device_telemetry`
   - `tabiot_flow_accumulation`
   - `tabiot_oil_profile`

3. **Environment variables** in `/services/env/common.env`:
   ```env
   DATABASE_HOST=viis-local-mysql
   DATABASE_PORT=3306
   DATABASE_USERNAME=root
   DATABASE_PASSWORD=admin@123
   DATABASE_NAME=viis_local
   
   DEVICE_ACCESS_TOKEN=your-thingsboard-token
   THINGSBOARD_HOST=mqtt.viis.tech
   THINGSBOARD_PORT=1883
   ```

### Installation Steps

1. **Build custom nodes:**
   ```bash
   cd /services/nodered/custom-nodes/viis-node-red
   npm run build
   ```

2. **Restart Node-RED:**
   ```bash
   docker restart nodered1
   ```

3. **Deploy env-loader node** (required for hot-reload)

4. **Create oil profiles** via REST API or database

5. **Deploy marine-telemetry node** in your flow

6. **Deploy flow-accumulation node** in your flow

### Quick Test

1. **Check marine telemetry is saving data:**
   ```sql
   SELECT COUNT(*) as records 
   FROM tabiot_device_telemetry
   WHERE key_name IN ('fs01','fs02','fs03','fs04','fs05','fs06')
     AND timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL 1 MINUTE) * 1000;
   ```
   Should see ~72 records/minute (12 samples/minute × 6 sensors)

2. **Wait for hourly accumulation:**
   At :05 past any hour, check:
   ```sql
   SELECT * FROM tabiot_flow_accumulation
   ORDER BY hour_start DESC
   LIMIT 6;
   ```

---

## ⚙️ Configuration

### Marine Telemetry Configuration

```javascript
{
    name: "Marine Telemetry",
    enableMarineIoT: true,
    flowSensorKeys: "fs01,fs02,fs03,fs04,fs05,fs06",
    profileCacheDuration: "300000",  // 5 minutes
    pollIntervalHolding: "5000",     // 5 seconds
    enableDebugLog: false
}
```

### Flow Accumulation Configuration

```javascript
{
    name: "Hourly Accumulation",
    enableAutoCalculation: true,
    cronSchedule: "5 * * * *",       // At :05 past every hour
    publishToMqtt: true,
    mqttTopic: "v1/devices/me/telemetry"
}
```

### Oil Profile Example

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

---

## 📡 API Reference

### Oil Profile Management

**Base URL:** `http://localhost:1880/api/v2/oil-profile`

#### Create Profile
```http
POST /api/v2/oil-profile
Authorization: Bearer <token>
Content-Type: application/json

{
    "device_id": "ship_001",
    "machine_type": "GENERATOR",
    "oil_type": "BO",
    "operating_temperature": 85,
    "density": 950,
    "label": "BO 85°C Generator"
}
```

#### Get Active Profile
```http
GET /api/v2/oil-profile/active/:device_id/:machine_type
Authorization: Bearer <token>
```

#### List All Profiles
```http
GET /api/v2/oil-profile/device/:device_id
Authorization: Bearer <token>
```

#### Activate Profile
```http
PUT /api/v2/oil-profile/:profile_name/activate
Authorization: Bearer <token>
```

#### Update Profile
```http
PUT /api/v2/oil-profile/:profile_name
Authorization: Bearer <token>
Content-Type: application/json

{
    "density": 960,
    "label": "Updated label"
}
```

#### Delete Profile
```http
DELETE /api/v2/oil-profile/:profile_name
Authorization: Bearer <token>
```

### Marine Telemetry API

**Base URL:** `http://localhost:1880/api/v2/marine/telemetry`

#### Get Latest Telemetry
```http
GET /api/v2/marine/telemetry/latest/:device_id?keys=fs01,fs02,fs03
Authorization: Bearer <token>
```

#### Get History
```http
GET /api/v2/marine/telemetry/history/:device_id?start_time=<ts>&end_time=<ts>
Authorization: Bearer <token>
```

#### Get Machines Summary
```http
GET /api/v2/marine/telemetry/machines/:device_id
Authorization: Bearer <token>
```

---

## 📊 Database Schema

### tabiot_device_telemetry
```sql
CREATE TABLE tabiot_device_telemetry (
    id INT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(255),
    timestamp BIGINT,
    key_name VARCHAR(255),
    value_type ENUM('int', 'float', 'string', 'boolean', 'json'),
    float_value FLOAT,
    oil_profile_id VARCHAR(255),
    density_snapshot FLOAT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (device_id, timestamp, key_name),
    INDEX idx_device_key_time (device_id, key_name, timestamp)
);
```

### tabiot_flow_accumulation
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
    UNIQUE KEY (device_id, sensor_key, hour_start),
    INDEX idx_device_time (device_id, hour_start)
);
```

### tabiot_oil_profile
```sql
CREATE TABLE tabiot_oil_profile (
    name VARCHAR(255) PRIMARY KEY,
    device_id VARCHAR(255),
    machine_type ENUM('GENERATOR', 'MAIN_ENGINE', 'BOILER'),
    oil_type ENUM('BO', 'DO', 'HFO'),
    operating_temperature FLOAT,
    density FLOAT COMMENT 'kg/m³',
    label VARCHAR(255),
    is_active BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES tabiot_device(name) ON DELETE CASCADE,
    INDEX idx_device_machine_active (device_id, machine_type, is_active)
);
```

---

## 🔍 Monitoring & Analytics

### Key Metrics to Monitor

1. **Realtime Telemetry Health**
   - Samples per minute (should be ~12/min per sensor)
   - Oil profile cache hit rate
   - Database write latency

2. **Accumulation Health**
   - Hourly job success rate
   - Calculation time
   - Missing hours (gaps in data)

3. **Data Quality**
   - Percentage of samples with oil_profile_id
   - Density snapshot coverage
   - Outlier detection in flow rates

### Useful Queries

**Daily accumulation summary:**
```sql
SELECT 
    sensor_key,
    DATE(hour_start) as date,
    SUM(accumulated_m3) as total_m3,
    SUM(accumulated_tons) as total_tons,
    COUNT(*) as hours_recorded
FROM tabiot_flow_accumulation
WHERE device_id = 'ship_001'
    AND hour_start >= CURDATE() - INTERVAL 7 DAY
GROUP BY sensor_key, DATE(hour_start)
ORDER BY date DESC, sensor_key;
```

**Check for missing hours:**
```sql
WITH RECURSIVE hours AS (
    SELECT DATE_SUB(NOW(), INTERVAL 24 HOUR) as hour
    UNION ALL
    SELECT hour + INTERVAL 1 HOUR
    FROM hours
    WHERE hour < NOW()
)
SELECT 
    h.hour,
    COUNT(a.id) as records_found
FROM hours h
LEFT JOIN tabiot_flow_accumulation a
    ON DATE_FORMAT(h.hour, '%Y-%m-%d %H:00:00') = a.hour_start
    AND a.device_id = 'ship_001'
GROUP BY h.hour
HAVING records_found = 0;
```

---

## ⚠️ Troubleshooting

### Common Issues

#### 1. No flow sensor data in database

**Symptoms:** Empty `tabiot_device_telemetry` for fs01-fs06

**Checklist:**
- [ ] Is marine-telemetry node deployed?
- [ ] Is Marine IoT enabled in config?
- [ ] Is database connection working?
- [ ] Are holding registers mapped correctly?
- [ ] Check Node-RED logs for errors

**Fix:**
```bash
docker logs -f nodered1 | grep Marine
```

#### 2. No hourly accumulation generated

**Symptoms:** Empty `tabiot_flow_accumulation`

**Checklist:**
- [ ] Is flow-accumulation node deployed?
- [ ] Is auto calculation enabled?
- [ ] Is cron schedule correct?
- [ ] Is there source data in tabiot_device_telemetry?
- [ ] Wait until :05 past the hour

**Fix:**
Manually trigger:
```javascript
// In function node
msg = {
    topic: "calculate",
    payload: {}
};
return msg;
```

#### 3. Oil profile is null in telemetry

**Symptoms:** `oil_profile_id` and `density_snapshot` are null

**Checklist:**
- [ ] Is there an active oil profile for this device?
- [ ] Is the machine_type correct for the sensor?
- [ ] Is profile cache expired?

**Fix:**
Create and activate a profile via API or database.

#### 4. MQTT not publishing

**Symptoms:** Data in DB but not in ThingsBoard

**Checklist:**
- [ ] Is MQTT publishing enabled?
- [ ] Is DEVICE_ACCESS_TOKEN correct?
- [ ] Is ThingsBoard MQTT broker reachable?
- [ ] Check MQTT topic configuration

**Debug:**
```bash
# Subscribe to topic manually
mosquitto_sub -h mqtt.viis.tech -p 1883 \
    -u YOUR_TOKEN -P '' \
    -t 'v1/devices/me/telemetry' -v
```

---

## 📚 Additional Resources

- [Oil Profile Service Documentation](src/services/MarineIoT/OilProfileService.ts)
- [Flow Accumulation Service Documentation](src/services/MarineIoT/FlowAccumulationService.ts)
- [Marine Telemetry Processor](src/modules/viis-marine-telemetry/viis-marine-telemetry-processor.ts)
- [REST API Controllers](src/modules/viis-rest-api/controllers/)
- [Database Migrations](src/orm/migrations/)

---

## 🎓 Best Practices

1. **Always create oil profiles** before deploying marine telemetry
2. **Monitor database size** and implement retention policies
3. **Use separate profiles per machine** for accuracy
4. **Enable debug logs** only for troubleshooting
5. **Set appropriate cache duration** (5 minutes recommended)
6. **Deploy env-loader node** for hot-reload support
7. **Backup accumulation data** regularly
8. **Test backfill** on non-production data first

---

## 📝 Version History

- **v1.0.3** - Current version
  - Marine IoT system with oil profile tracking
  - Hourly accumulation calculation
  - ThingsBoard integration
  - REST API for profile management

---

## 👥 Support

For technical support or questions:
- Check this documentation first
- Review node-specific README files
- Check Node-RED debug logs
- Contact VIIS development team

---

**Last Updated:** January 2025
