# VIIS Device Protection Node v2.0

## Overview

Advanced device protection node with **Min/Max/Bypass/Force** logic for IoT devices. Monitors Modbus coils and automatically enforces protection rules to prevent equipment damage.

**Architecture:** Follows `viis-rpc-control` pattern with:
- ConfigService for configuration management
- ProtectionManager for business logic
- ProtectionGateService — centralized gate shared across all control sources (Schedule, RPC, Intent)
- ErrorNotificationService for alerts
- MQTT integration for telemetry publishing

**Features:**
- **Bypass Protection** - Skip all protections for manual control
- **Force ON/OFF** - Override logic (still respects safety limits)
- **Max Time ON** - Auto OFF after maximum runtime
- **Min Time ON** - Prevent rapid cycling (must stay ON for minimum time)
- **Min Off Time** - Prevent rapid re-start (must stay OFF for minimum time)
- **Upper/Lower Limits** - Auto control based on sensor readings
- **Sensor Binding** - Link coils to specific sensors via `sensor_id`
- **Multi-board Support** - Works with single and multi Modbus board configurations
- **Read-Back Verification** - Confirms writes succeeded
- **MQTT Publishing** - Publishes coil state changes to telemetry topic
- **Hot Reload** - Auto-detects configuration changes every 30 seconds
- **Standard Flow Access** — ProtectionGateService accessible from Function nodes

---

## Priority Flow

```
checkGate(coilKey, requestedValue)
│
├── requestedValue = OFF → ALWAYS ALLOW
│
├── bypass = true → ALLOW (skip all checks)
│
├── forceOn + forceOff → BLOCK (safety: prioritize OFF)
│
├── forceOff → BLOCK ON
│
├── requestedValue = ON:
│   ├── maxTimeOn exceeded? → BLOCK
│   ├── minOffTime not met? → BLOCK
│   ├── sensor > upperLimit? → BLOCK
│   ├── sensor < lowerLimit? → BLOCK (cooling: auto OFF)
│   └── All clear → ALLOW
│
└── forceOn → ALLOW (still check maxTimeOn for safety)
```

---

## Control Sources Integration

Protection gate is checked **before every coil write** from all sources:

| Source | Gate check? | File |
|--------|-------------|------|
| Schedule (V1 + V2) | `checkGate()` before write | `viis-schedule-executor-service.ts` |
| RPC (mobile app) | `checkGate()` before write | `rpcHandler.ts` |
| Device Intent | `checkGate()` before output | `processingService.ts` |
| Protection Node (timer) | Self-enforce + auto-OFF | `viis-device-protection.ts` |
| **Standard Node-RED Flow** | Via `global.get('protectionGateService')` | Function node (see below) |

---

## Configuration

### Node Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| **Name** | String | - | Optional label for this node |
| **Board ID** | String | "board1" | Modbus board identifier (e.g., "board1", "board2") |
| **Enable Debug** | Boolean | false | Enable detailed debug logging with [DEBUG] prefix |

### Debug Mode

When **Enable Debug** is checked, the node outputs detailed logs:

```
[DEBUG] Debug mode: ENABLED
[DEBUG] Board ID: board1
[DEBUG] Checking 15 config keys
[DEBUG] Found 3 protected coils: lamp_control_1, fan_intake, cool_ac1
[DEBUG] Processing coil: lamp_control_1, address: 1
[DEBUG] Coil lamp_control_1 current state: true
[DEBUG] Protection config for lamp_control_1: {"bypass":false,"forceOn":false,...}
[DEBUG] Protection result for lamp_control_1: allow - All protection checks passed
[DEBUG] Writing coil lamp_control_1 to false
[DEBUG] Read-back verification for coil 1: false (expected: false)
[DEBUG] Updated coilRegisterData: lamp_control_1=false
[DEBUG] Published to MQTT v1/devices/me/telemetry: lamp_control_1=false
```

---

## Production Function Naming

Every protection setting is a **production function** in ThingsBoard (`tabiot_production_function`).

### Naming Format

```
{deviceType}_protect_all_{field}     → applies to ALL coils of this type
{coilKey}_protect_{field}            → applies to ONE specific coil
```

### Recognized Fields

| Field | Description | Type | Unit |
|-------|-------------|------|------|
| `bypass` | Skip all protections | Bool | - |
| `force_on` | Force ON continuously | Bool | - |
| `force_off` | Force OFF continuously | Bool | - |
| `max_time_on` | Max ON time before auto-OFF | Value | seconds (s) or minutes (m) |
| `min_time_on` | Min ON time (block early OFF) | Value | s or m |
| `min_off_time` | Min OFF time (block rapid restart) | Value | s or m |
| `upper_temp` / `upper_limit` | Sensor upper threshold | Value | C / % / ppm |
| `lower_temp` / `lower_limit` | Sensor lower threshold | Value | C / % / ppm |
| `pulse_time_on` | ON duration per cycle (pulse mode) | Value | minutes |
| `pulse_time_off` | OFF duration per cycle (pulse mode) | Value | minutes |
| `sensor_id` | Sensor identifier for threshold checks | String | - |

### 4-Level Config Lookup

When checking a coil, config is resolved in this order:

```
Level 1 (Specific coil):   {coilKey}_protect_{field}        → lamp_control_1_protect_force_off
Level 2 (All rule):        {deviceType}_protect_all_{field} → lamp_protect_all_force_off
Level 3 (Sub-type):        {subTypePrefix}_{field}          → fan_protect_intake_force_off
Level 4 (Device type):     {deviceType}_protect_{field}     → fan_protect_force_off
```

**Rule: First level with a value wins. Later levels are skipped.**

#### Example: `fan_control_intake`, field `force_off`

```javascript
configKeyValues = {
  "fan_protect_all_force_off": false,        // Level 2
  "fan_protect_intake_force_off": true,      // Level 3
  "fan_protect_force_off": false             // Level 4
}
```

| Level | Key lookup | Found? | Result |
|-------|-----------|--------|--------|
| 1 | `fan_control_intake_protect_force_off` | ❌ No | Skip |
| 2 | `fan_protect_all_force_off` | ✅ `false` | **Use `false`** |
| 3 | `fan_protect_intake_force_off` | ⏭️ Skipped (Level 2 matched) | - |
| 4 | `fan_protect_force_off` | ⏭️ Skipped (Level 2 matched) | - |

→ Result: `force_off = false` (Level 2 wins)

#### Example: Level 1 overrides all

```javascript
configKeyValues = {
  "fan_protect_all_max_time_on": 7200,              // Level 2: 2 hours
  "fan_protect_intake_max_time_on": 3600,            // Level 3: 1 hour
  "fan_control_intake_protect_max_time_on": 1800     // Level 1: 30 min
}
```

→ Result for `fan_control_intake`: `max_time_on = 1800` (Level 1 wins)

#### Full lookup table for all device types

| Coil | Level 1 (Specific) | Level 2 (All) | Level 3 (Sub-type) | Level 4 (Device) |
|------|-------------------|---------------|--------------------|--------------------|
| `lamp_control_1` | `lamp_control_1_protect_*` | `lamp_protect_all_*` | *(none)* | `lamp_protect_*` |
| `fan_control_intake` | `fan_control_intake_protect_*` | `fan_protect_all_*` | `fan_protect_intake_*` | `fan_protect_*` |
| `fan_control_circ` | `fan_control_circ_protect_*` | `fan_protect_all_*` | `fan_protect_circ_*` | `fan_protect_*` |
| `fan_control_dc` | `fan_control_dc_protect_*` | `fan_protect_all_*` | `fan_protect_dc_*` | `fan_protect_*` |
| `cool_control_ac1` | `cool_control_ac1_protect_*` | `cool_protect_all_*` | `cool_protect_1_*` | `cool_protect_*` |
| `cool_control_ac2` | `cool_control_ac2_protect_*` | `cool_protect_all_*` | `cool_protect_2_*` | `cool_protect_*` |
| `cool_control_freezer` | `cool_control_freezer_protect_*` | `cool_protect_all_*` | `cool_protect_freezer_*` | `cool_protect_*` |
| `humid_control_on` | `humid_control_on_protect_*` | `humid_protect_all_*` | *(none)* | `humid_protect_*` |
| `dehumid_control_1` | `dehumid_control_1_protect_*` | `dehumid_protect_all_*` | *(none)* | `dehumid_protect_*` |
| `co2_control_valve` | `co2_control_valve_protect_*` | `co2_protect_all_*` | *(none)* | `co2_protect_*` |

#### Code reference (`resolveField`)

```typescript
// Level 1: Specific coil
const specificKey = `${coilKey}_protect_${field}`;
if (configKeyValues[specificKey]) return configKeyValues[specificKey];

// Level 2: All rule
const allKey = `${deviceType}_protect_all_${field}`;
if (configKeyValues[allKey]) return configKeyValues[allKey];

// Level 3: Sub-type (FAN and COOLING only)
const subTypePrefix = getSubTypePrefix(coilKey);  // fan_protect_intake, cool_protect_1...
if (subTypePrefix) {
  const subTypeKey = `${subTypePrefix}_${field}`;
  if (configKeyValues[subTypeKey]) return configKeyValues[subTypeKey];
}

// Level 4: Device type fallback
const typeKey = `${deviceType}_protect_${field}`;
if (configKeyValues[typeKey]) return configKeyValues[typeKey];
```

---

## Sensor Binding

### How It Works

Protection needs **sensor values** to check `upper_temp`/`lower_temp`/`upper_limit`/`lower_limit`.

Sensor binding uses the `sensor_id` field — the value is the **sensor identifier** from the device profile.

### Available Sensor Identifiers

| Identifier | Unit | Description |
|-----------|------|-------------|
| `temp_monitor_sensor_1` | C | Temperature sensor 1 |
| `humid_monitor_sensor_1` | % | Humidity sensor 1 |
| `co2_monitor_sensor_1` | ppm | CO2 sensor 1 |
| `lamp_monitor_sensor_1` | lx | Light sensor 1 |
| `temp_monitor_sensor_2` | C | Temperature sensor 2 |
| `humid_monitor_sensor_2` | % | Humidity sensor 2 |
| `co2_monitor_sensor_2` | ppm | CO2 sensor 2 |
| `cool_monitor_Aquara_temp_1` | C | Aquara temp 1 |
| `cool_monitor_Aquara_temp_2` | C | Aquara temp 2 |
| `humid_monitor_Aquara_humid_1` | % | Aquara humidity 1 |
| `humid_monitor_Aquara_humid_2` | % | Aquara humidity 2 |

### Configuration Options

**Option A: Per-device-type (recommended)**

```
cool_protect_all_sensor_id = "cool_monitor_Aquara_temp_1"
→ All cool devices (ac1, ac2, freezer) check Aquara temp 1
```

**Option B: Per-coil (override)**

```
cool_control_ac1_protect_sensor_id = "cool_monitor_Aquara_temp_1"
cool_control_ac2_protect_sensor_id = "cool_monitor_Aquara_temp_2"
→ AC1 checks sensor 1, AC2 checks sensor 2
```

### Auto-mapping (fallback)

If `sensor_id` is not set, the protection node auto-maps by coil name:

| Coil contains | Auto-mapped sensor |
|--------------|-------------------|
| `cool`, `ac` | `cool_monitor_Aquara_temp_1` → `cool_Aquara_temp_1` |
| `humid` | `humid_sensor_1` → `humid_monitor_Aquara_humid_1` |
| `dehumid` | `humid_sensor_1` → `humid_monitor_Aquara_humid_1` |
| `co2` | `co2_sensor_1` |

**Recommendation:** Always set `sensor_id` explicitly. Do not rely on auto-mapping.

---

## Device-Specific Configuration

### Coil Keys (controllable devices)

```
modbus_board1_coils = {
  "lamp_control_1":         1,
  "lamp_control_2":         2,
  "co2_control_valve":      3,
  "humid_control_on":       4,
  "fan_control_intake":     5,
  "cool_control_freezer_1": 6,
  "fan_control_circ":       7,
  "fan_control_dc":         8,
  "dehumid_control_1":      9,
  "dehumid_control_2":      10,
  "cool_control_ac1":       11,
  "cool_control_ac2":       12,
  "cool_control_freezer_2": 13,
  "backup_control_2":       14,
  "backup_control_3":       15,
  "backup_control_4":       16
}
```

### LAMP (lights)

```
-- All lamp protection --
lamp_protect_all_bypass        = false    (Bool)
lamp_protect_all_force_on      = false    (Bool)
lamp_protect_all_force_off     = false    (Bool)
lamp_protect_all_max_time_on   = 14400    (seconds — 4 hours)
lamp_protect_all_min_off_time  = 300      (seconds — 5 minutes)

-- Per-coil override (optional) --
lamp_control_1_protect_max_time_on = 7200   (seconds — 2 hours)
lamp_control_1_protect_sensor_id   = "temp_monitor_sensor_1"
lamp_control_1_protect_upper_temp  = 35     (C)
```

**Explanation:**
- `max_time_on = 14400`: Lamp must not stay ON continuously超过 4 hours → auto-OFF
- `min_off_time = 300`: After turning OFF, must wait at least 5 minutes before turning ON again
- `upper_temp = 35`: If temperature > 35C → block turning ON (prevent overheating)

### FAN

FAN has 3 sub-types, each needs its own **protection group**:

| Coil Key | Protection Group | Config Lookup |
|----------|-----------------|---------------|
| `fan_control_intake` | `fan_protect_intake_*` | specific → all → intake |
| `fan_control_circ` | `fan_protect_circ_*` | specific → all → circ |
| `fan_control_dc` | `fan_protect_dc_*` | specific → all → dc |

```
-- FAN Intake --
fan_protect_intake_bypass        = false
fan_protect_intake_force_on      = false
fan_protect_intake_force_off     = false
fan_protect_intake_max_time_on   = 7200    (2 hours)
fan_protect_intake_min_off_time  = 120     (2 minutes)

-- FAN Circulation --
fan_protect_circ_bypass        = false
fan_protect_circ_force_on      = false
fan_protect_circ_force_off     = false
fan_protect_circ_max_time_on   = 7200
fan_protect_circ_min_off_time  = 120

-- FAN DC --
fan_protect_dc_bypass        = false
fan_protect_dc_force_on      = false
fan_protect_dc_force_off     = false
fan_protect_dc_max_time_on   = 7200
fan_protect_dc_min_off_time  = 120
```

### COOLING (AC / freezer)

```
-- All cooling protection --
cool_protect_all_bypass        = false
cool_protect_all_force_on      = false
cool_protect_all_force_off     = false
cool_protect_all_max_time_on   = 180      (MINUTES — 3 hours)
cool_protect_all_min_off_time  = 10       (MINUTES — 10 minutes)
cool_protect_all_upper_temp    = 30       (C — above 30C → auto ON)
cool_protect_all_lower_temp    = 18       (C — below 18C → auto OFF)
cool_protect_all_sensor_id     = "cool_monitor_Aquara_temp_1"

-- Per-coil override --
cool_control_ac1_protect_max_time_on = 120
cool_control_ac1_protect_sensor_id   = "cool_monitor_Aquara_temp_1"
cool_control_ac2_protect_sensor_id   = "cool_monitor_Aquara_temp_2"
```

**Note:** `max_time_on` and `min_off_time` for COOLING are in **minutes** (not seconds).

### HUMIDITY (humidifier)

```
humid_protect_all_bypass        = false
humid_protect_all_force_on      = false
humid_protect_all_force_off     = false
humid_protect_all_max_time_on   = 3600     (seconds — 1 hour)
humid_protect_all_min_off_time  = 300      (seconds — 5 minutes)
humid_protect_all_upper_limit   = 85       (% — above 85% → block ON)
humid_protect_all_sensor_id     = "humid_monitor_Aquara_humid_1"
```

### DE-HUMIDITY (dehumidifier)

```
dehumid_protect_all_bypass        = false
dehumid_protect_all_force_on      = false
dehumid_protect_all_force_off     = false
dehumid_protect_all_max_time_on   = 3600
dehumid_protect_all_min_off_time  = 300
dehumid_protect_all_lower_limit   = 40      (% — below 40% → block ON)
dehumid_protect_all_sensor_id     = "humid_monitor_Aquara_humid_1"
```

### CO2

```
co2_protect_all_bypass        = false
co2_protect_all_force_on      = false
co2_protect_all_force_off     = false
co2_protect_all_max_time_on   = 600       (seconds — 10 minutes)
co2_protect_all_min_off_time  = 120       (seconds — 2 minutes)
co2_protect_all_upper_limit   = 1500      (ppm — above 1500 → auto ON)
co2_protect_all_lower_limit   = 400       (ppm — below 400 → block ON)
co2_protect_all_sensor_id     = "co2_monitor_sensor_1"
```

---

## Using from Standard Node-RED Flow Nodes

The `ProtectionGateService` is stored in Node-RED global context, making it accessible from any Function node without needing the custom node directly.

### Prerequisite

The `viis-device-protection` custom node **must be deployed at least once** to initialize the `ProtectionGateService` in global context. After that, any Function node can access it.

### Access Points

| Data | Global Context Key | Access from Function node |
|------|-------------------|--------------------------|
| ProtectionGateService | `protectionGateService` | `global.get('protectionGateService')` |
| Protection Config | `configKeyValues` | `global.get('configKeyValues')` |
| Coil States | `coilRegisterData` | `global.get('coilRegisterData')` |
| Sensor Data | `sensorRegisterData` | `global.get('sensorRegisterData')` |

### Example 1: Set Protection Config from Function Node

```javascript
// Function node: Configure protection rules
const config = global.get('configKeyValues') || {};

// All lamps: max 4h ON, 5min cooldown, 35C upper limit
config['lamp_protect_all_max_time_on'] = 14400;
config['lamp_protect_all_min_off_time'] = 300;
config['lamp_protect_all_upper_temp'] = 35;
config['lamp_protect_all_sensor_id'] = 'temp_monitor_sensor_1';

// Override for specific lamp
config['lamp_control_1_protect_max_time_on'] = 7200;

global.set('configKeyValues', config);
return msg;
```

### Example 2: Check Gate Before Modbus Write

```javascript
// Function node: Gate check before writing to Modbus
const gate = global.get('protectionGateService');

if (!gate) {
    node.warn('ProtectionGateService not initialized — passthrough');
    return msg;
}

const coilKey = 'lamp_control_1';
const requestedValue = true; // ON
const source = 'manual'; // or 'schedule', 'rpc', 'intent'

const result = gate.checkGate(coilKey, requestedValue, source);

if (result.allowed) {
    // Proceed to Modbus write node
    msg.payload = { address: 1, value: true };
    msg.protection = result;
    return msg;
} else {
    // Blocked — log reason, do not write
    node.warn(`PROTECTION BLOCKED: ${result.reason}`);
    msg.payload = { blocked: true, reason: result.reason, action: result.action };
    return msg;
}
```

### Example 3: Update State After Successful Write

```javascript
// Function node: Update gate state after Modbus write success
const gate = global.get('protectionGateService');

if (gate && msg.payload && msg.payload.writeSuccess !== false) {
    gate.updateState('lamp_control_1', true);
    node.log('Updated protection state: lamp_control_1 = ON');
}

return msg;
```

### Example 4: Read Protection Config

```javascript
// Function node: Read current protection config for a coil
const gate = global.get('protectionGateService');

if (gate) {
    const config = gate.getProtectionConfigForCoil('lamp_control_1');
    msg.payload = {
        coil: 'lamp_control_1',
        config: config
    };
}

return msg;
```

### Example 5: Sync Sensor Values

```javascript
// Function node: Update sensor values for protection checks
const gate = global.get('protectionGateService');

if (gate) {
    // Read from sensorRegisterData or from msg.payload
    const sensorData = global.get('sensorRegisterData') || {};
    
    for (const [key, value] of Object.entries(sensorData)) {
        gate.updateSensorValue(key, value);
    }
}

return msg;
```

### Example 6: Complete Flow (Inject → Gate → Modbus → Update)

```
[Inject trigger]
      ↓
[Function: Check Gate]
      ↓ (allowed)
[Modbus Flex Write]
      ↓
[Function: Update State + Log]
      ↓
[Debug output]

      ↓ (blocked)
[Function: Log Block Reason]
      ↓
[Debug: show reason]
```

**Function node — Check Gate:**
```javascript
const gate = global.get('protectionGateService');
if (!gate) return msg;

const result = gate.checkGate(msg.coilKey || 'lamp_control_1', true, 'flow');
if (result.allowed) {
    msg.payload = { value: true, address: msg.address || 1 };
    return msg;
}
node.warn(`Blocked: ${result.reason}`);
return null; // drop message
```

**Function node — Update State:**
```javascript
const gate = global.get('protectionGateService');
if (gate) {
    gate.updateState(msg.coilKey || 'lamp_control_1', true);
}
return msg;
```

### ProtectionGateService API Reference

```typescript
class ProtectionGateService {
    // Main gate check — call BEFORE writing coil
    checkGate(coilKey: string, requestedValue: boolean, source: string): GateResult;

    // Update coil state after successful write
    updateState(coilKey: string, newState: boolean): void;

    // Sync coil state from Modbus read (called by protection node timer)
    syncCoilState(coilKey: string, currentState: boolean): void;

    // Update sensor value for limit checks
    updateSensorValue(sensorKey: string, value: number): void;

    // Get current coil state
    getCoilState(coilKey: string): CoilState | undefined;

    // Get full protection config for a coil (with 2-level lookup)
    getProtectionConfigForCoil(coilKey: string): ProtectionConfig;

    // Reload config from configKeyValues
    refreshConfig(configKeyValues: Record<string, any>): void;
}

interface GateResult {
    allowed: boolean;
    reason: string;
    action: 'allow' | 'block' | 'force_on' | 'force_off' | 'auto_off';
    metadata?: {
        elapsedOnTime?: number;
        elapsedOffTime?: number;
        sensorValue?: number;
        sensorId?: string;
        violation?: string;
    };
}
```

---

## Environment Configuration

### Required Environment Variables

```bash
# Device Identity
DEVICE_ID=device_001
DEVICE_ACCESS_TOKEN=your_access_token

# Modbus Configuration (Single Board)
MODBUS_TYPE=TCP
MODBUS_HOST=192.168.1.100
MODBUS_TCP_PORT=502
MODBUS_UNIT_ID=1
MODBUS_TIMEOUT=5000
MODBUS_RECONNECT_INTERVAL=5000

# OR Multi-Board Configuration
MODBUS_BOARDS=[{"id":"board1","host":"192.168.1.101","port":502},{"id":"board2","host":"192.168.1.102","port":502}]
MODBUS_DEFAULT_BOARD=board1

# MQTT Configuration (ThingsBoard)
THINGSBOARD_HOST=mqtt.viis.tech
THINGSBOARD_PORT=1883
THINGSBOARD_PASSWORD=your_password

# OR Local MQTT (EMQX)
EMQX_HOST=emqx
EMQX_PORT=1883
EMQX_USERNAME=admin
EMQX_PASSWORD=password
```

---

## Global Context Required

### 1. Modbus Coil Mappings

```javascript
// Multi-board pattern (preferred)
global.set("modbus_board1_coils", {
    "lamp_control_1": 1,
    "lamp_control_2": 2,
    "fan_intake": 3,
    "cool_ac1": 4,
    "humid": 5
});

global.set("modbus_board1_holding_registers", {
    "temp_sensor_1": 100,
    "humid_sensor_1": 101
});

global.set("modbus_board1_input_registers", {
    "co2_sensor_1": 200
});

// OR legacy single-board pattern
global.set("modbusCoils", {
    "lamp_control_1": 1,
    "fan_intake": 3
});
```

### 2. Protection Configuration

```javascript
global.set("configKeyValues", {
    // LAMP Protection
    "lamp_control_1_protect_bypass": false,
    "lamp_control_1_protect_force_on": false,
    "lamp_control_1_protect_force_off": false,
    "lamp_control_1_protect_max_time_on": 7200,      // 2 hours
    "lamp_control_1_protect_min_time_on": 60,        // 1 minute
    "lamp_control_1_protect_min_off_time": 30,       // 30 seconds

    // FAN_INTAKE Protection
    "fan_intake_protect_bypass": false,
    "fan_intake_protect_max_time_on": 0,             // 0 = disabled
    "fan_intake_protect_min_time_on": 120,           // 2 minutes
    "fan_intake_protect_min_off_time": 60,           // 1 minute

    // COOL_AC1 Protection with Temperature Limits
    "cool_ac1_protect_bypass": false,
    "cool_ac1_protect_max_time_on": 0,               // Unlimited
    "cool_ac1_protect_min_time_on": 300,             // 5 minutes (compressor protection)
    "cool_ac1_protect_min_off_time": 180,            // 3 minutes
    "cool_ac1_protect_upper_temp": 30,               // Auto ON if > 30C
    "cool_ac1_protect_lower_temp": 22                // Auto OFF if < 22C
});
```

### 3. Sensor Data (Optional)

```javascript
global.set("sensorRegisterData", {
    "cool_Aquara_temp_1": 28.5,
    "cool_Aquara_temp_2": 27.2,
    "humid_sensor_1": 65.0,
    "humid_sensor_2": 63.5,
    "co2_sensor_1": 450
});
```

---

## Post-Write Operations

After writing to Modbus, the node automatically performs:

### 1. Read-Back Verification
```typescript
const readValue = await readCoil(address);
const writeSuccess = (readValue === targetValue);
```

### 2. Global Context Cache Update
```javascript
global.set("coilRegisterData", {
    "lamp_control_1": false,  // Updated state
    "fan_intake": true
});
```

### 3. MQTT Publishing
```javascript
// Publish to: v1/devices/me/telemetry
{
    "ts": 1711234567890,
    "lamp_control_1": false
}
```

### 4. Output Message
```javascript
{
    "payload": {
        "lamp_control_1": false,
        "reason": "Max time ON exceeded (3601.2s/3600s) - Auto OFF",
        "action": "auto_off",
        "writeSuccess": true
    }
}
```

---

## Output Messages

When protection actions are triggered, the node sends messages:

### Auto OFF (Max Time Exceeded)
```javascript
{
  "payload": {
    "lamp_control_1": false,
    "reason": "Max time ON exceeded (3601.2s/3600s) - Auto OFF",
    "action": "auto_off",
    "writeSuccess": true
  }
}
```

### Block OFF (Min Time Not Met)
```javascript
{
  "payload": {
    "cool_ac1": true,
    "reason": "Min time ON not met (120.5s/300s) - Must stay ON",
    "action": "block",
    "writeSuccess": null  // No write performed
  }
}
```

### Force ON
```javascript
{
  "payload": {
    "fan_intake": true,
    "reason": "Force ON active",
    "action": "force_on",
    "writeSuccess": true
  }
}
```

### Auto ON (Upper Limit)
```javascript
{
  "payload": {
    "cool_ac1": true,
    "reason": "Sensor (29.5) exceeded upper limit (28) - Auto ON",
    "action": "auto_on",
    "writeSuccess": true
  }
}
```

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `payload.{coil_key}` | Boolean | New coil state |
| `reason` | String | Human-readable reason for action |
| `action` | String | Action type (`allow`, `block`, `force_on`, `force_off`, `auto_on`, `auto_off`, `bypass`) |
| `writeSuccess` | Boolean | `true` if write + read-back succeeded, `false` if verification failed, `null` if no write performed |

---

## Naming Mismatch (Device Profile vs Code)

Current device profiles use **different names** from what the code expects. Use this mapping to fix:

### Needs Fix

| Device Profile Identifier | Correct Production Function | Notes |
|--------------------------|----------------------------|-------|
| `lamp_protect_min_time_off` | `lamp_protect_all_min_off_time` | `min_time_off` → `min_off_time`, add `_all_` |
| `lamp_protect_max_temp_on` | `lamp_protect_all_upper_temp` | `max_temp_on` → `upper_temp`, add `_all_` |
| `fan_protect_intake_min_time_off` | `fan_protect_intake_min_off_time` | `min_time_off` → `min_off_time` |
| `fan_protect_circ_min_time_off` | `fan_protect_circ_min_off_time` | Rename |
| `fan_protect_dc_min_time_off` | `fan_protect_dc_min_off_time` | Rename |
| `cool_protect_min_time_off` | `cool_protect_all_min_off_time` | Rename, add `_all_` |
| `humid_protect_min_time_off` | `humid_protect_all_min_off_time` | Rename + add `_all_` |
| `dehumid_protect_min_time_off` | `dehumid_protect_all_min_off_time` | Rename + add `_all_` |
| `co2_protect_min_time_off` | `co2_protect_all_min_off_time` | Rename + add `_all_` |

### Already Correct (just add `_all_`)

| Device Profile Identifier | Production Function | Status |
|--------------------------|-------------------|--------|
| `lamp_protect_bypass` | `lamp_protect_all_bypass` | Add `_all_` |
| `lamp_protect_force_on` | `lamp_protect_all_force_on` | Add `_all_` |
| `lamp_protect_force_off` | `lamp_protect_all_force_off` | Add `_all_` |
| `lamp_protect_max_time_on` | `lamp_protect_all_max_time_on` | Add `_all_` |
| `cool_protect_bypass` | `cool_protect_all_bypass` | Add `_all_` |
| `cool_protect_upper_temp` | `cool_protect_all_upper_temp` | Add `_all_` |
| `cool_protect_lower_temp` | `cool_protect_all_lower_temp` | Add `_all_` |

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Protection not working | `viis-device-protection` node not deployed | Deploy node, check global context |
| Config not recognized | Wrong identifier format | Ensure `{type}_protect_all_{field}` is correct |
| Sensor not checking | `sensor_id` not set | Add `{type}_protect_all_sensor_id` |
| FAN shares wrong config | Using `fan_protect_*` instead of `fan_protect_intake_*` | Set separate config per fan sub-type |
| Time value wrong unit | Minutes vs Seconds | COOLING uses minutes, others use seconds |
| Blocked forever, won't turn ON | `min_off_time` too large | Reduce value or enable bypass |
| Gate not accessible from flow | `viis-device-protection` not deployed yet | Deploy custom node first to init global context |

---

## File Structure

```
viis-device-protection/
├── constants.ts                          # Centralized constants
├── services/
│   ├── configService.ts                  # Configuration management
│   └── protection-gate-service.ts        # Centralized gate (shared with Schedule/RPC/Intent)
├── tests/
│   ├── protection-manager.test.ts        # Unit tests (14 tests)
│   ├── protection-gate-service.test.ts   # Gate service unit tests
│   ├── protection-gate-integration.test.ts  # Integration tests (11 tests)
│   └── viis-protection-comprehensive.test.ts  # Comprehensive tests (22 tests)
├── protection-manager.ts                 # Core business logic
├── viis-device-protection.ts             # Main node implementation
├── viis-device-protection.html           # UI definition
└── README.md                             # This file
```

---

## Best Practices

### 1. Set Reasonable Limits

```
// GOOD — Protects equipment
cool_protect_all_min_time_on = 300    // 5 min
cool_protect_all_min_off_time = 180   // 3 min

// BAD — Too aggressive
cool_protect_all_min_time_on = 10     // 10 sec (not enough)
cool_protect_all_min_off_time = 5     // 5 sec (damages compressor)
```

### 2. Use Bypass Sparingly

```
// Enable bypass only for maintenance
lamp_protect_all_bypass = true  // Disable after maintenance!
```

### 3. Always Set sensor_id

```
// GOOD — Explicit
cool_protect_all_sensor_id = "cool_monitor_Aquara_temp_1"

// BAD — Relies on auto-mapping, may break
// (no sensor_id set)
```

### 4. Use Hierarchical Configs

```
// Base config for all fans
fan_protect_all_max_time_on = 7200

// Override for specific fan
fan_protect_intake_max_time_on = 3600  // Takes precedence
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.1 | 2026-06-13 | Added standard Node-RED flow access docs, aligned with protection-mechanism-guide.md |
| v2.0 | 2026-03-24 | Added Min/Max/Bypass/Force logic, read-back verification, MQTT publishing |
| v1.0 | - | Initial Max Time protection only |

---

**Last Updated:** 2026-06-13
**Status:** Production Ready
**Architecture:** Follows viis-rpc-control pattern
