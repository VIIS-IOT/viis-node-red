# VIIS Device Protection Node v2.0

## 📋 Overview

Advanced device protection node with **Min/Max/Bypass/Force** logic for IoT devices. Monitors Modbus coils and automatically enforces protection rules to prevent equipment damage.

**Features:**
- ✅ **Bypass Protection** - Skip all protections for manual control
- ✅ **Force ON/OFF** - Override logic (still respects safety limits)
- ✅ **Max Time ON** - Auto OFF after maximum runtime
- ✅ **Min Time ON** - Prevent rapid cycling (must stay ON for minimum time)
- ✅ **Min Off Time** - Prevent rapid re-start (must stay OFF for minimum time)
- ✅ **Upper/Lower Limits** - Auto control based on sensor readings
- ✅ **Multi-board Support** - Works with single and multi Modbus board configurations
- ✅ **Hot Reload** - Auto-detects configuration changes every 30 seconds

---

## 🎯 Priority Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Input: Device State (from coilRegisterData)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Check BYPASS                                       │
│  if (bypass == true) → Allow immediately, skip all checks   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Check FORCE                                        │
│  if (force_on == true) → Force ON (validate Min/Max)        │
│  if (force_off == true) → Force OFF (validate Min/Max)      │
│  if (both) → Prioritize OFF for safety                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Check MAX TIME ON                                  │
│  if (current_time_on > max_time_on) → Auto OFF + Notify     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Check MIN TIME ON                                  │
│  if (trying_to_OFF && time_on < min_time_on) → BLOCK OFF    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Check MIN OFF TIME                                 │
│  if (trying_to_ON && time_off < min_off_time) → BLOCK ON    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 6: Check UPPER/LOWER LIMITS (if applicable)           │
│  if (sensor > upper_limit) → Auto ON/OFF based on device    │
│  if (sensor < lower_limit) → Auto ON/OFF based on device    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  FINAL: Execute Command / Write to Modbus                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration

### Global Context Required

```javascript
// 1. Aqara Credentials (if using Aqara devices)
global.set("aqaraCredentials", {
    appid: "your-app-id",
    keyid: "your-key-id",
    appkey: "your-app-key",
    accesstoken: "your-access-token"
});

// 2. Config Key Values (Protection Settings)
global.set("configKeyValues", {
    // LAMP Protection
    "LAMP_PROTECT_BYPASS": false,
    "LAMP_PROTECT_FORCE_ON": false,
    "LAMP_PROTECT_FORCE_OFF": false,
    "LAMP_PROTECT_MAX_TIME_ON": 7200,      // 2 hours
    "LAMP_PROTECT_MIN_TIME_ON": 60,        // 1 minute
    "LAMP_PROTECT_MIN_OFF_TIME": 30,       // 30 seconds
    
    // FAN_INTAKE Protection
    "FAN_INTAKE_PROTECT_BYPASS": false,
    "FAN_INTAKE_PROTECT_MAX_TIME_ON": 0,   // 0 = disabled (unlimited)
    "FAN_INTAKE_PROTECT_MIN_TIME_ON": 120, // 2 minutes
    "FAN_INTAKE_PROTECT_MIN_OFF_TIME": 60, // 1 minute
    
    // COOL_AC1 Protection with Temperature Limits
    "COOL_AC1_PROTECT_BYPASS": false,
    "COOL_AC1_PROTECT_MAX_TIME_ON": 0,     // Unlimited
    "COOL_AC1_PROTECT_MIN_TIME_ON": 300,   // 5 minutes (compressor protection)
    "COOL_AC1_PROTECT_MIN_OFF_TIME": 180,  // 3 minutes
    "COOL_AC1_PROTECT_UPPER_TEMP": 30,     // Auto ON if > 30°C
    "COOL_AC1_PROTECT_LOWER_TEMP": 22      // Auto OFF if < 22°C
});

// 3. Coil Register Data (Real-time state from Modbus)
global.set("coilRegisterData", {
    "LAMP_CONTROL": true,
    "FAN_INTAKE_CONTROL": false,
    "COOL_AC1_CONTROL": true
});

// 4. Sensor Register Data (Temperature, Humidity, etc.)
global.set("sensorRegisterData", {
    "cool_Aquara_temp_1": 28.5,
    "cool_Aquara_temp_2": 27.2,
    "humid_sensor_1": 65.0,
    "humid_sensor_2": 63.5
});
```

---

## 📊 Device Configuration Fields

### Naming Convention

```
{DEVICE_LABEL}_PROTECT_{PROPERTY}
```

### All Supported Fields

| Field Pattern | Type | Default | Description |
|---------------|------|---------|-------------|
| `{DEVICE}_PROTECT_BYPASS` | Bool | false | Bypass all protections |
| `{DEVICE}_PROTECT_FORCE_ON` | Bool | false | Force device ON |
| `{DEVICE}_PROTECT_FORCE_OFF` | Bool | false | Force device OFF |
| `{DEVICE}_PROTECT_MAX_TIME_ON` | Value (s) | 0 | Max continuous ON time |
| `{DEVICE}_PROTECT_MIN_TIME_ON` | Value (s) | 0 | Min ON time before OFF allowed |
| `{DEVICE}_PROTECT_MIN_OFF_TIME` | Value (s) | 0 | Min OFF time before ON allowed |
| `{DEVICE}_PROTECT_UPPER_LIMIT` | Value | 0 | Auto ON above this value |
| `{DEVICE}_PROTECT_LOWER_LIMIT` | Value | 0 | Auto OFF below this value |

**Note:** `0` means disabled for all numeric fields.

### Supported Devices

| Device Key | Device Label | Example Fields |
|------------|--------------|----------------|
| `lamp` | LAMP | `LAMP_PROTECT_BYPASS` |
| `fan_intake` | FAN_INTAKE | `FAN_INTAKE_PROTECT_MAX_TIME_ON` |
| `fan_circ` | FAN_CIRC | `FAN_CIRC_PROTECT_MIN_TIME_ON` |
| `cool_ac1` | COOL_AC1 | `COOL_AC1_PROTECT_UPPER_TEMP` |
| `cool_ac2` | COOL_AC2 | `COOL_AC2_PROTECT_LOWER_TEMP` |
| `humid` | HUMID | `HUMID_PROTECT_UPPER_LIMIT` |
| `dehumid` | DEHUMID | `DEHUMID_PROTECT_LOWER_LIMIT` |
| `co2` | CO2 | `CO2_PROTECT_MAX_TIME_ON` |

---

## 🎮 Usage Examples

### Example 1: Basic Protection (Max Time Only)

```javascript
// Protect LAMP from running too long
global.set("configKeyValues", {
    "LAMP_PROTECT_MAX_TIME_ON": 3600  // Auto OFF after 1 hour
});
```

**Behavior:**
- LAMP turns ON → Timer starts
- After 1 hour → Auto OFF + Notification created

---

### Example 2: Anti-Cycling Protection (Min Time)

```javascript
// Protect AC compressor from rapid cycling
global.set("configKeyValues", {
    "COOL_AC1_PROTECT_MIN_TIME_ON": 300,    // Must run 5 min minimum
    "COOL_AC1_PROTECT_MIN_OFF_TIME": 180    // Must rest 3 min minimum
});
```

**Behavior:**
- AC turns ON → Must stay ON for 5 minutes
- AC turns OFF → Must wait 3 minutes before restarting

---

### Example 3: Temperature-Based Auto Control

```javascript
// Automatic temperature control
global.set("configKeyValues", {
    "COOL_AC1_PROTECT_UPPER_TEMP": 28,   // Auto ON if > 28°C
    "COOL_AC1_PROTECT_LOWER_TEMP": 24,   // Auto OFF if < 24°C
    "COOL_AC1_PROTECT_MIN_TIME_ON": 300, // Compressor protection
    "COOL_AC1_PROTECT_MIN_OFF_TIME": 180
});

// Sensor data (updated by telemetry node)
global.set("sensorRegisterData", {
    "cool_Aquara_temp_1": 29.5  // Current temperature
});
```

**Behavior:**
- Temp > 28°C → Auto ON (if min off time met)
- Temp < 24°C → Auto OFF (if min on time met)

---

### Example 4: Manual Override with Bypass

```javascript
// Maintenance mode - disable all protections
global.set("configKeyValues", {
    "LAMP_PROTECT_BYPASS": true,  // Ignore all limits
    "FAN_INTAKE_PROTECT_BYPASS": true
});
```

**Behavior:**
- All protections disabled
- Devices run freely
- Useful for testing/maintenance

---

### Example 5: Force Control

```javascript
// Emergency shutdown
global.set("configKeyValues", {
    "COOL_AC1_PROTECT_FORCE_OFF": true  // Force OFF immediately
});

// Or force ON (e.g., for testing)
global.set("configKeyValues", {
    "FAN_INTAKE_PROTECT_FORCE_ON": true  // Force ON
});
```

**Behavior:**
- Force OFF → Immediate shutdown (respects min time for safety)
- Force ON → Immediate start (respects max time for safety)

---

## 📤 Output Messages

When protection actions are triggered, the node sends messages:

### Auto OFF (Max Time Exceeded)
```javascript
{
  payload: {
    "LAMP_CONTROL": false,
    reason: "Max time ON exceeded (3601.2s/3600s) - Auto OFF",
    action: "auto_off"
  }
}
```

### Block OFF (Min Time Not Met)
```javascript
{
  payload: {
    "COOL_AC1_CONTROL": true,
    reason: "Min time ON not met (120.5s/300s) - Must stay ON",
    action: "block"
  }
}
```

### Force ON
```javascript
{
  payload: {
    "FAN_INTAKE_CONTROL": true,
    reason: "Force ON active",
    action: "force_on"
  }
}
```

### Auto ON (Upper Limit)
```javascript
{
  payload: {
    "COOL_AC1_CONTROL": true,
    reason: "Sensor (29.5) exceeded upper limit (28) - Auto ON",
    action: "auto_on",
    metadata: {
      sensor_value: 29.5
    }
  }
}
```

---

## 🔍 Monitoring & Diagnostics

### Node Status

| Status | Meaning |
|--------|---------|
| 🟢 Running | Normal operation |
| 🟡 No configKeyValues | Configuration missing |
| 🔴 Modbus client failed | Connection error |

### Violation Tracking

The node tracks protection violations internally. Access via:

```typescript
// In protection-manager.ts
getViolationStats(deviceKey: string): { 
    maxTime: number; 
    minTime: number; 
    minOffTime: number 
}

resetViolations(deviceKey: string): void
```

---

## ⚙️ Environment Variables

### Modbus Configuration

```bash
# Single Board
MODBUS_TYPE=TCP
MODBUS_HOST=192.168.1.100
MODBUS_TCP_PORT=502
MODBUS_UNIT_ID=1
MODBUS_TIMEOUT=5000
MODBUS_RECONNECT_INTERVAL=5000

# OR Multi Board
MODBUS_BOARDS=[{"id":"board1","host":"192.168.1.101","port":502},{"id":"board2","host":"192.168.1.102","port":502}]
MODBUS_DEFAULT_BOARD=board1

# Coil Mappings
MODBUS_COILS={"LAMP_CONTROL":0,"FAN_INTAKE_CONTROL":1,"COOL_AC1_CONTROL":2}
```

---

## 🧩 Integration with Other Nodes

### Common Pattern Compliance

This node follows the **VIIS Node-RED Common Pattern** (`common_pattern.md`):

1. ✅ **Credentials from Global Context** - Reads Modbus config and mappings from global context
2. ✅ **Core Service Reuse** - Uses `GlobalContextHelper`, `ErrorNotificationService`, `ClientRegistry`
3. ✅ **Multi-Board Mapping** - Supports `modbus_board1_coils`, `modbus_board2_coils`, etc.
4. ✅ **RPC Fallback Behavior** - Cooperates with `viis-rpc-control` for unmapped keys
5. ✅ **Dependent Node Behavior** - Uses both `configKeyValues` and Modbus mappings

### Multi-Board Mapping Pattern

The node automatically detects and uses multi-board mappings:

```javascript
// Primary: Multi-board mappings (common pattern)
global.set("modbus_board1_coils", {
    "lamp_control_1": 1,
    "lamp_control_2": 2,
    "co2_control_valve": 3
});

global.set("modbus_board1_holding_registers", {
    "temp_sensor_1": 100,
    "humid_sensor_1": 101
});

// Node will use these mappings based on boardId configuration
```

### Typical Flow

```
[viis-telemetry] → [Update coilRegisterData] → [viis-device-protection]
                                                      │
                                                      ▼
                                         [Write to Modbus Coil]
                                                      │
                                                      ▼
                                         [Send Notification if needed]
```

### Example Flow (JSON)

```json
[
  {
    "id": "telemetry_node",
    "type": "viis-telemetry",
    "wires": [["update_coil_data"]]
  },
  {
    "id": "update_coil_data",
    "type": "function",
    "func": "global.set('coilRegisterData', msg.payload);\nreturn msg;",
    "wires": [["protection_node"]]
  },
  {
    "id": "protection_node",
    "type": "viis-device-protection",
    "wires": [["debug_output"]]
  },
  {
    "id": "debug_output",
    "type": "debug",
    "active": true
  }
]
```

---

## 🐛 Troubleshooting

### Issue: Protection not triggering

**Check:**
1. `configKeyValues` is set in global context
2. Device label matches exactly (case-sensitive)
3. `coilRegisterData` is being updated
4. Modbus client is initialized (green status)

### Issue: Device won't turn ON

**Possible causes:**
- Min off time not met (check `MIN_OFF_TIME`)
- Max time exceeded (check `MAX_TIME_ON`)
- Force OFF is active (check `FORCE_OFF`)

### Issue: Device won't turn OFF

**Possible causes:**
- Min time not met (check `MIN_TIME_ON`)
- Force ON is active (check `FORCE_ON`)
- Bypass is enabled (check `BYPASS`)

### Issue: Notifications not created

**Check:**
- `ErrorNotificationService` is initialized
- Global context is accessible
- Check node logs for errors

---

## 📈 Best Practices

### 1. Set Reasonable Limits

```javascript
// GOOD - Protects equipment
"COOL_AC1_PROTECT_MIN_TIME_ON": 300,    // 5 min
"COOL_AC1_PROTECT_MIN_OFF_TIME": 180    // 3 min

// BAD - Too aggressive
"COOL_AC1_PROTECT_MIN_TIME_ON": 10,     // 10 sec (not enough)
"COOL_AC1_PROTECT_MIN_OFF_TIME": 5      // 5 sec (damages compressor)
```

### 2. Use Bypass Sparingly

```javascript
// Enable bypass only for maintenance
"LAMP_PROTECT_BYPASS": true  // ⚠️ Disable after maintenance!
```

### 3. Monitor Violations

Regularly check violation stats to identify problematic devices:

```javascript
// High max time violations → Device runs too long
// High min time violations → Frequent on/off cycling
```

### 4. Sensor Calibration

Ensure sensor readings are accurate for limit-based protection:

```javascript
// Calibrate temperature sensors regularly
"cool_Aquara_temp_1": 25.0  // Should match actual temperature
```

---

## 📚 API Reference

### ProtectionManager Class

```typescript
class ProtectionManager {
    // Evaluate protection logic
    evaluateProtection(
        deviceKey: string,
        currentState: boolean,
        config: CoilProtectionConfig
    ): ProtectionResult;
    
    // Update sensor value
    updateSensorValue(deviceKey: string, value: number): void;
    
    // Get violation statistics
    getViolationStats(deviceKey: string): object | null;
    
    // Reset violations
    resetViolations(deviceKey: string): void;
    
    // Clear all states
    clearAllStates(): void;
}
```

### ProtectionResult Interface

```typescript
interface ProtectionResult {
    allowed: boolean;
    finalState: boolean;
    reason?: string;
    action?: 'allow' | 'block' | 'force_on' | 'force_off' | 'auto_off' | 'auto_on' | 'bypass';
    metadata?: {
        elapsedOnTime?: number;
        elapsedOffTime?: number;
        violation?: string;
        sensorValue?: number;
    };
}
```

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.0 | 2026-03-24 | Added Min/Max/Bypass/Force logic |
| v1.0 | - | Initial Max Time protection only |

---

## 📄 License

VIIS IoT Platform - Internal Use Only

---

**Last Updated:** 2026-03-24  
**Status:** ✅ Production Ready
