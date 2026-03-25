# VIIS Device Protection Node v2.0

## 📋 Overview

Advanced device protection node with **Min/Max/Bypass/Force** logic for IoT devices. Monitors Modbus coils and automatically enforces protection rules to prevent equipment damage.

**Architecture:** Follows `viis-rpc-control` pattern with:
- ConfigService for configuration management
- ProtectionManager for business logic
- ErrorNotificationService for alerts
- MQTT integration for telemetry publishing

**Features:**
- ✅ **Bypass Protection** - Skip all protections for manual control
- ✅ **Force ON/OFF** - Override logic (still respects safety limits)
- ✅ **Max Time ON** - Auto OFF after maximum runtime
- ✅ **Min Time ON** - Prevent rapid cycling (must stay ON for minimum time)
- ✅ **Min Off Time** - Prevent rapid re-start (must stay OFF for minimum time)
- ✅ **Upper/Lower Limits** - Auto control based on sensor readings
- ✅ **Multi-board Support** - Works with single and multi Modbus board configurations
- ✅ **Read-Back Verification** - Confirms writes succeeded
- ✅ **MQTT Publishing** - Publishes coil state changes to telemetry topic
- ✅ **Hot Reload** - Auto-detects configuration changes every 30 seconds

---

## 🎯 Priority Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Input: Device State (from Modbus read)                     │
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
│  FINAL: Write to Modbus → Read-back → Update Cache → MQTT   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration

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

## 🌍 Environment Configuration

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

## 🧠 Global Context Required

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
    "cool_ac1_protect_upper_temp": 30,               // Auto ON if > 30°C
    "cool_ac1_protect_lower_temp": 22                // Auto OFF if < 22°C
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

## 📊 Device Configuration Fields

### Naming Convention

```
{coil_key}_protect_{property}
```

Examples:
- `lamp_control_1_protect_max_time_on`
- `fan_intake_protect_bypass`
- `cool_ac1_protect_upper_temp`

### All Supported Fields

| Field Pattern | Type | Default | Description |
|---------------|------|---------|-------------|
| `{coil}_protect_bypass` | Bool | false | Bypass all protections |
| `{coil}_protect_force_on` | Bool | false | Force device ON |
| `{coil}_protect_force_off` | Bool | false | Force device OFF |
| `{coil}_protect_max_time_on` | Number (s) | 0 | Max continuous ON time |
| `{coil}_protect_min_time_on` | Number (s) | 0 | Min ON time before OFF allowed |
| `{coil}_protect_min_off_time` | Number (s) | 0 | Min OFF time before ON allowed |
| `{coil}_protect_upper_temp` | Number | 0 | Auto ON above this value |
| `{coil}_protect_upper_limit` | Number | 0 | Auto ON above this value |
| `{coil}_protect_lower_temp` | Number | 0 | Auto OFF below this value |
| `{coil}_protect_lower_limit` | Number | 0 | Auto OFF below this value |

**Note:** `0` means disabled for all numeric fields.

### Config Resolution Order

The node uses a hierarchical lookup for protection configs:

1. **Exact match**: `lamp_control_1_protect_*`
2. **Generalized prefix**: `lamp_control_protect_*` → applies to `lamp_control_1`, `lamp_control_2`, etc.
3. **Base prefix**: `lamp_protect_*` → applies to all lamp-related coils

Example:
```javascript
// Base configuration for all lamps
"lamp_protect_max_time_on": 3600,

// Override for specific lamp
"lamp_control_1_protect_max_time_on": 7200  // Takes precedence
```

---

## 🔄 Post-Write Operations

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

## 📤 Output Messages

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

## 🎯 Usage Examples

### Example 1: Basic Protection (Max Time Only)

```javascript
// Protect LAMP from running too long
global.set("configKeyValues", {
    "lamp_control_1_protect_max_time_on": 3600  // Auto OFF after 1 hour
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
    "cool_ac1_protect_min_time_on": 300,    // Must run 5 min minimum
    "cool_ac1_protect_min_off_time": 180    // Must rest 3 min minimum
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
    "cool_ac1_protect_upper_temp": 28,   // Auto ON if > 28°C
    "cool_ac1_protect_lower_temp": 24,   // Auto OFF if < 24°C
    "cool_ac1_protect_min_time_on": 300, // Compressor protection
    "cool_ac1_protect_min_off_time": 180
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
    "lamp_control_1_protect_bypass": true,
    "fan_intake_protect_bypass": true
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
    "cool_ac1_protect_force_off": true  // Force OFF immediately
});

// Or force ON (e.g., for testing)
global.set("configKeyValues", {
    "fan_intake_protect_force_on": true  // Force ON
});
```

**Behavior:**
- Force OFF → Immediate shutdown (respects min time for safety)
- Force ON → Immediate start (respects max time for safety)

---

## 🔍 Monitoring & Diagnostics

### Node Status

| Status | Meaning |
|--------|---------|
| 🟢 Running | Normal operation |
| 🟡 No configKeyValues | Configuration missing |
| 🔴 Modbus client failed | Connection error |

### Violation Tracking

The node tracks protection violations internally via `ProtectionManager`:

```typescript
// Access violation stats
const stats = protectionManager.getViolationStats("lamp_control_1");
// Returns: { maxTime: 5, minTime: 2, minOffTime: 3 }

// Reset violations
protectionManager.resetViolations("lamp_control_1");
```

**Interpretation:**
- High `maxTime` violations → Device runs too long
- High `minTime` violations → Frequent on/off cycling
- High `minOffTime` violations → Rapid restart attempts

---

## 🧩 Integration with Other Nodes

### Common Pattern Compliance

This node follows the **VIIS Node-RED Common Pattern** (`common_pattern.md`):

1. ✅ **Credentials from Global Context** - Reads Modbus config and mappings from global context
2. ✅ **Core Service Reuse** - Uses `GlobalContextHelper`, `ErrorNotificationService`, `ClientRegistry`
3. ✅ **Multi-Board Mapping** - Supports `modbus_board1_coils`, `modbus_board2_coils`, etc.
4. ✅ **RPC Fallback Behavior** - Cooperates with `viis-rpc-control` for unmapped keys
5. ✅ **Dependent Node Behavior** - Uses both `configKeyValues` and Modbus mappings

### Typical Flow

```
[viis-telemetry] → [Update sensorRegisterData] → [viis-device-protection]
                                                      │
                                                      ▼
                                         [Write to Modbus Coil]
                                                      │
                                                      ▼
                                    [Read-back → Update Cache → MQTT]
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
    "wires": [["update_sensor_data"]]
  },
  {
    "id": "update_sensor_data",
    "type": "function",
    "func": "global.set('sensorRegisterData', msg.payload);\nreturn msg;",
    "wires": [["protection_node"]]
  },
  {
    "id": "protection_node",
    "type": "viis-device-protection",
    "boardId": "board1",
    "enableDebug": true,
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
2. Coil keys match Modbus mapping exactly
3. Modbus client is initialized (green status)
4. Check debug logs for coil detection

### Issue: Device won't turn ON

**Possible causes:**
- Min off time not met (check `MIN_OFF_TIME`)
- Max time exceeded (check `MAX_TIME_ON`)
- Force OFF is active (check `FORCE_OFF`)
- Coil address not in Modbus mapping

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

### Issue: MQTT not publishing

**Check:**
- MQTT credentials in environment variables
- MQTT client connection status
- Check debug logs for publish attempts

### Issue: Read-back verification failed

**Possible causes:**
- Modbus write succeeded but read failed (timeout)
- Coil state changed by external factor
- Check `writeSuccess: false` in output messages

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

### 5. Use Hierarchical Configs

```javascript
// Base config for all fans
"fan_protect_max_time_on": 7200,

// Override for specific fan
"fan_intake_protect_max_time_on": 3600  // Takes precedence
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
    getViolationStats(deviceKey: string): { 
        maxTime: number; 
        minTime: number; 
        minOffTime: number 
    } | null;

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

### ConfigService Class

```typescript
class ConfigService {
    // Get all config values
    getConfigKeyValues(): Record<string, any>;

    // Get protection config by coil key
    getProtectionConfigByLabel(coilKey: string): ProtectionConfig;

    // Get sensor data
    getSensorData(): Record<string, number>;
}
```

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.0 | 2026-03-24 | Added Min/Max/Bypass/Force logic, read-back verification, MQTT publishing |
| v1.0 | - | Initial Max Time protection only |

---

## 📄 License

VIIS IoT Platform - Internal Use Only

---

**Last Updated:** 2026-03-24  
**Status:** ✅ Production Ready  
**Architecture:** Follows viis-rpc-control pattern
