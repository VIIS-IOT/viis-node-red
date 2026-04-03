# VIIS Aqara Device Node - READ/WRITE Support

Custom Node-RED node for controlling Aqara devices via Aqara Open API with **READ** and **WRITE** operations.

## ⭐ NEW Features (v1.1.0)

- ✅ **READ AC State**: Query temperature, mode, fan speed from stateful ACs
- ✅ **WRITE Commands**: Send IR control commands
- ✅ **Auto-detect**: Automatically handles READ vs WRITE based on msg.payload.action

---

## Quick Start

### WRITE: Control AC Temperature
```javascript
msg.payload = {
  action: "write",  // or omit (default)
  power: true,
  temperature: 24,
  mode: 1,      // Cool
  fanSpeed: 2   // Medium
};
msg.deviceId = "ir.837392177046114304";
return msg;
```

### READ: Query AC State (Temperature)
```javascript
msg.payload = {
  action: "read"  // or "query"
};
msg.deviceId = "ir.837392177046114304";
return msg;
```

**Output:**
```javascript
{
  payload: {
    success: true,
    action: "read",
    temperature: 26,        // ← Current AC temperature!
    mode: 0,
    modeName: "cooling",
    fanSpeed: 2,
    fanName: "medium",
    power: true,
    rawState: "P0_M0_T26_S2_D0"
  }
}
```

---

## Use Cases

### Use Case 1: READ Temperature from AC

**Flow:**
```
[Inject] → [Function: Read Command] → [Aqara Device] → [Debug]
```

**Function Code:**
```javascript
// Query AC state
msg.payload = {
  action: "read"
};
msg.deviceId = "ir.837392177046114304";
return msg;
```

**Output:**
```javascript
{
  payload: {
    success: true,
    action: "read",
    deviceId: "ir.837392177046114304",
    temperature: 26,        // °C
    mode: 0,
    modeName: "cooling",
    fanSpeed: 2,
    fanName: "medium",
    power: true,
    rawState: "P0_M0_T26_S2_D0",
    timestamp: 1711180800000
  },
  topic: "aqara/state"
}
```

---

### Use Case 2: WRITE - Set Temperature

**Flow:**
```
[Inject] → [Function: Set Temp] → [Aqara Device] → [Debug]
```

**Function Code:**
```javascript
msg.payload = {
  action: "write",
  power: true,
  temperature: 24,
  mode: 1,      // Cool
  fanSpeed: 2   // Medium
};
msg.deviceId = "ir.837392177046114304";
return msg;
```

**Output:**
```javascript
{
  payload: {
    success: true,
    action: "write",
    deviceId: "ir.837392177046114304",
    acKey: "P0_M1_T24_S2",
    response: { status: "sent" },
    timestamp: 1711180800000
  }
}
```

---

### Use Case 3: READ-WRITE Automation Loop

**Flow:**
```
[Inject: Timer] → [Aqara Device: READ] → [Function: Logic] → [Aqara Device: WRITE]
```

**Complete Automation Code:**
```javascript
// Input from READ operation
const acState = msg.payload;

// Check if READ was successful
if (!acState.success) {
  node.error("Failed to read AC state");
  return null;
}

const currentTemp = acState.temperature;
const targetTemp = 25;
const hysteresis = 1.5;

// Decision logic
if (currentTemp > targetTemp + hysteresis) {
  // Too hot - increase cooling
  msg.payload = {
    action: "write",
    power: true,
    temperature: Math.max(20, currentTemp - 3),
    mode: 1,      // Cool
    fanSpeed: 3   // High
  };
  node.status({fill: "blue", shape: "dot", text: `🌡️ ${currentTemp}°C → Cooling`});
} else if (currentTemp < targetTemp - hysteresis) {
  // Too cold - turn off or reduce
  msg.payload = {
    action: "write",
    power: false
  };
  node.status({fill: "red", shape: "dot", text: `🌡️ ${currentTemp}°C → OFF`});
} else {
  // Comfortable - maintain
  msg.payload = {
    action: "write",
    power: true,
    temperature: targetTemp,
    mode: 0,      // Auto
    fanSpeed: 1   // Low
  };
  node.status({fill: "green", shape: "dot", text: `🌡️ ${currentTemp}°C → OK`});
}

msg.deviceId = "ir.837392177046114304";
return msg;
```

---

### Use Case 4: Monitor AC Status

**Flow:**
```
[Inject: Every 5min] → [Aqara Device: READ] → [Function: Log] → [Dashboard]
```

**Function Code:**
```javascript
const state = msg.payload;

if (state.success) {
  // Log to dashboard or database
  return {
    payload: {
      temperature: state.temperature,
      mode: state.modeName,
      fan: state.fanName,
      power: state.power ? "ON" : "OFF",
      timestamp: new Date().toISOString()
    }
  };
} else {
  node.warn("AC state read failed: " + state.error);
  return null;
}
```

---

### Use Case 5: Check if AC is ON Before Control

**Flow:**
```
[Function: Check State] → [Aqara Device: READ] → [Switch: Power?]
                         ├─ ON: [Function: Adjust Temp] → [Aqara Device: WRITE]
                         └─ OFF: [Function: Turn ON] → [Aqara Device: WRITE]
```

**Initial Function:**
```javascript
// First, read current state
msg.payload = { action: "read" };
msg.deviceId = "ir.837392177046114304";
return msg;
```

**Switch Node:**
- Rule 1: `msg.payload.power === true` → AC is ON
- Rule 2: `msg.payload.power === false` → AC is OFF

**Adjust Temp Function (if ON):**
```javascript
msg.payload = {
  action: "write",
  temperature: msg.payload.temperature - 2,  // Reduce by 2°C
  mode: 1
};
return msg;
```

**Turn ON Function (if OFF):**
```javascript
msg.payload = {
  action: "write",
  power: true,
  temperature: 24,
  mode: 1
};
return msg;
```

---

## Input Message Format

### READ Operation
```javascript
{
  payload: {
    action: "read"  // or "query"
  },
  deviceId: "ir.xxxxx",  // Aqara device ID
  topic: "aqara/query"
}
```

### WRITE Operation
```javascript
{
  payload: {
    action: "write",     // or omit (default)
    power: true,         // ON/OFF
    temperature: 24,     // 16-30°C
    mode: 1,             // 0=Auto, 1=Cool, 2=Heat, 3=Fan, 4=Dry
    fanSpeed: 2,         // 0=Auto, 1=Low, 2=Medium, 3=High
    auto: true           // Respect automation
  },
  deviceId: "ir.xxxxx",
  topic: "aqara/control"
}
```

---

## Output Message Format

### READ Success Response
```javascript
{
  payload: {
    success: true,
    action: "read",
    deviceId: "ir.837392177046114304",
    
    // Parsed state
    temperature: 26,           // °C
    mode: 0,                   // 0-4
    modeName: "cooling",       // Readable name
    fanSpeed: 2,               // 0-3
    fanName: "medium",         // Readable name
    power: true,               // ON/OFF
    rawState: "P0_M0_T26_S2_D0",
    
    timestamp: 1711180800000
  },
  topic: "aqara/state"
}
```

### READ Error Response
```javascript
{
  payload: {
    success: false,
    action: "read",
    deviceId: "ir.837392177046114304",
    error: "Device is stateless",
    errorCode: 3002,
    timestamp: 1711180800000
  },
  topic: "aqara/error"
}
```

### WRITE Success Response
```javascript
{
  payload: {
    success: true,
    action: "write",
    deviceId: "ir.837392177046114304",
    acKey: "P0_M1_T24_S2",
    response: { status: "sent" },
    timestamp: 1711180800000
  },
  topic: "aqara/command"
}
```

---

## AC State Format

### State String: `Px_Mm_Ty_Ss_Dd`

| Segment | Values | Meaning |
|---------|--------|---------|
| **P** (Power) | 0 = ON<br>1 = OFF | Power state |
| **M** (Mode) | 0 = cooling<br>1 = heating<br>2 = auto<br>3 = fan<br>4 = dry | Operation mode |
| **T** (Temp) | 16-30 | Temperature in °C |
| **S** (Fan) | 0 = auto<br>1 = low<br>2 = medium<br>3 = high | Fan speed |
| **D** (Direction) | 0 = sweep<br>1-5 = fixed | Wind direction |

### Examples
- `P0_M0_T26_S2_D0` = ON, Cooling, **26°C**, Medium fan, Sweep
- `P1_M0_T0_S0_D0` = OFF
- `P0_M1_T28_S1_D1` = ON, Heating, 28°C, Low fan, Fixed direction

---

## ⚠️ Important Limitations

### Stateful vs Stateless AC

**Stateful AC (type=2):**
- ✅ CAN read temperature
- ✅ Reports state back to hub
- Examples: Aqara AC Controller P3, M2 Hub
- READ operations work

**Stateless AC (type=0/1):**
- ❌ CANNOT read temperature
- ❌ No state feedback (IR only sends)
- Most standard IR remotes
- READ will fail with error code 3002

### Check Device Type

Use `query.ir.info` to check:
```javascript
msg.payload = {
  action: "read",
  intent: "query.ir.info"
};
```

Response:
```javascript
{
  result: {
    type: 2  // 2 = stateful (OK), 0/1 = stateless (NO)
  }
}
```

---

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 0 | Success | - |
| 1001 | Invalid signature | Check AppKey |
| 1002 | Expired timestamp | Sync system clock |
| 2001 | Device not found | Check device ID |
| 2002 | Device offline | Check IR blower |
| 3001 | Invalid IR command | Check AC key format |
| **3002** | **No AC state data** | **Device is stateless (type=0/1)** |
| **3003** | **Failed to read AC** | **Network or API error** |

---

## Feature Matrix

| Feature | Supported | Notes |
|---------|-----------|-------|
| **WRITE: Temperature Control** | ✅ | Via IR commands |
| **WRITE: Mode/Fan Control** | ✅ | Full control |
| **READ: Temperature** | ✅ | Stateful ACs only (type=2) |
| **READ: Mode/Fan** | ✅ | Stateful ACs only |
| **READ: Power State** | ✅ | Stateful ACs only |
| **Auto/Manual Mode** | ✅ | Via msg.payload.auto |
| **Multi-Device** | ✅ | With delays |
| **Retry Logic** | ✅ | Configurable |

---

## Best Practices

### 1. Check Device Type First

```javascript
// Before using READ, verify device is stateful
if (deviceType !== 2) {
  node.warn("Cannot READ from stateless device");
  // Use external sensor instead
}
```

### 2. Handle READ Failures

```javascript
if (!msg.payload.success) {
  if (msg.payload.errorCode === 3002) {
    node.warn("Device is stateless - cannot read temperature");
    // Fallback to external sensor
  }
}
```

### 3. Rate Limiting

Use ≥2000ms delay between READ/WRITE operations:
```javascript
// In node config
requestDelay: 2000
```

### 4. Combine READ + WRITE

```javascript
// READ current state
// → Decision logic
// → WRITE new command
```

---

## Troubleshooting

### READ Returns Error 3002

**Problem:** "No AC state data in response"

**Cause:** Device is stateless (type=0/1)

**Solution:** 
- Use external temperature sensor (MQTT, Modbus)
- Or upgrade to stateful AC controller

### READ Returns Error 3003

**Problem:** "Failed to read AC state"

**Causes:**
- Network issue
- API credentials invalid
- Device offline

**Solutions:**
1. Check device is online
2. Verify Aqara credentials
3. Check system time (NTP)

### WRITE Works but READ Doesn't

**Cause:** Most likely a stateless device

**Solution:** READ only works with stateful ACs (type=2)

---

## API Reference

- **Aqara Open Platform**: https://open.aqara.com/
- **IR Device Management**: https://opendoc.aqara.cn/en/docs/developmanual/apiDocument/IRDeviceManagement.html
- **READ API**: `query.ir.acState`
- **WRITE API**: `write.ir.click`

---

## Version History

- **v1.1.0** (2026-03-23): Added READ support (query.ir.acState)
- **v1.0.0**: Initial WRITE-only release

---

**Last Updated**: 2026-03-23  
**Status**: ✅ Production Ready (READ + WRITE)
