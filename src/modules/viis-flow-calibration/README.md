# viis-flow-calibration Node

A custom Node-RED node for calibrating flow sensors and pumps. This node monitors global context for calibration flags and performs calibration calculations for both:

- **Board1 (Pump Control)**: Updates `HOLDING_CALIB_BOM_{i}`
- **Board2 (Flow Sensor)**: Updates K-Factor and Expected Pump Flowrate

## Features

- Periodic calibration check (configurable interval)
- Dual-board calibration support (board1 and board2)
- Manual calibration trigger via input message
- Unified trigger: Single input action calibrates both boards
- MQTT telemetry publishing for calibration flag resets
- Volume counter reset support

## Installation

This node is part of the `viis-node-red` package. Build with:

```bash
npm run build
```

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | "" | Node display name |
| `checkInterval` | number | 2000 | Calibration check interval in milliseconds |
| `enableLogging` | boolean | false | Enable detailed debug logging |
| `calibrateBoard1` | boolean | true | Enable pump control board calibration |
| `calibrateBoard2` | boolean | true | Enable flow sensor board calibration |

## Global Context Requirements

This node reads configuration from Node-RED global context. The following structure is expected:

```javascript
global.set("modbusMappings", {
    board1: {
        holdingRegisters: { /* Board1 holding registers */ },
        inputRegisters: { /* Board1 input registers */ },
        coils: { /* Board1 coils */ }
    },
    board2: {
        holdingRegisters: {
            HOLDING_K_FACTOR_BOM_1: 0,
            HOLDING_K_FACTOR_BOM_2: 1,
            // ... more pumps
            HOLDING_FLOWRATE_BOM_1: 20,
            HOLDING_FLOWRATE_BOM_2: 21,
            // ... more pumps
        },
        inputRegisters: {
            INPUT_TOTAL_FLOW_BOM_1: 20,
            INPUT_TOTAL_FLOW_BOM_2: 21,
            // ... more pumps
        },
        coils: {
            RESET_TOTAL_VOLUME_BOM_1: 201,
            RESET_TOTAL_VOLUME_BOM_2: 202,
            // ... more pumps
        }
    }
});

global.set("configKeyValues", {
    CALCULATE_CALIB_BOM_1: true,  // Calibration trigger
    CALIB_ACTUAL_ML_BOM_1: 950    // User measured volume
});

global.set("holdingRegisterData", {
    HOLDING_SETML_BOM_1: 1000,    // Target volume
    HOLDING_CALIB_BOM_1: 1000,    // Current calibration (×100)
    // ... more registers
});
```

**Note**: The node supports both nested structure (`modbusMappings.boardX.holdingRegisters`) and flat structure (`modbus_boardX_holding_registers`) for backward compatibility.

## Calibration Algorithm

### Overview

This node implements **simultaneous calibration** for both pump control (Board1) and flow sensor (Board2) with a **single user input**.

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User triggers calibration (UI or global flag)              │
│     - Sets CALCULATE_CALIB_BOM_{i} = true                      │
│     - Sets CALIB_ACTUAL_ML_BOM_{i} = measured volume           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. Node reads current state from global context               │
│     - setMl from HOLDING_SETML_BOM_{i} (Board1)                │
│     - currentCalib from HOLDING_CALIB_BOM_{i} (Board1)         │
│     - currentKFactor from HOLDING_K_FACTOR_BOM_{i} (Board2)    │
│     - reportedVolume from INPUT_TOTAL_FLOW_BOM_{i} (Board2)    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. Calculate calibration values                                │
│     Board1: runTime = setMl / (currentCalib/100)               │
│             newCalib = (actualMl / runTime) × 100              │
│                                                                │
│     Board2: K_new = K_old × (reportedVolume / actualMl)        │
│             Q_new = (actualMl / runTime) × 100                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. Write to Modbus registers                                   │
│     Board1: HOLDING_CALIB_BOM_{i} ← newCalibValue              │
│     Board2: HOLDING_K_FACTOR_BOM_{i} ← newKFactor              │
│             HOLDING_FLOWRATE_BOM_{i} ← newFlowrate             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  5. Reset calibration flags                                     │
│     - Set CALCULATE_CALIB_BOM_{i} = false                      │
│     - Publish to MQTT for cloud sync                           │
└─────────────────────────────────────────────────────────────────┘
```

### Board1 (Pump Control) - Port 502

| Register | Address | Formula |
|----------|---------|---------|
| `HOLDING_SETML_BOM_{i}` | i | Target volume (mL) |
| `HOLDING_CALIB_BOM_{i}` | 16 + i | Calibration value (×100) |

**Calculation:**
```
runTime = setMl / (currentCalib / 100)     // seconds
newCalibValue = (actualMl / runTime) × 100  // scaled by 100
```

### Board2 (Flow Sensor) - Port 503

| Register | Address | Formula |
|----------|---------|---------|
| `HOLDING_K_FACTOR_BOM_{i}` | i - 1 | K-Factor (pulses/L) |
| `HOLDING_FLOWRATE_BOM_{i}` | 19 + i | Expected flowrate (mL/s × 100) |
| `INPUT_TOTAL_FLOW_BOM_{i}` | 19 + i | Reported volume (mL) |

**Calculation:**
```
K_new = K_old × (V_reported / V_real)
Q_new = (V_real / runTime) × 100  // scaled by 100
```

Where:
- `V_real` = User measured volume (`actualMl`)
- `V_reported` = Sensor reported volume (`INPUT_TOTAL_FLOW_BOM_{i}`)
- `K_old` = Current K-Factor from holding register
- `Q_new` = New expected pump flowrate

## Global Context Keys

| Key | Type | Description |
|-----|------|-------------|
| `CALCULATE_CALIB_BOM_{i}` | boolean | Set to true to trigger calibration for pump i |
| `CALIB_ACTUAL_ML_BOM_{i}` | number | User measured volume in mL for pump i |

## Input Messages

### Trigger Manual Calibration

```json
{
  "topic": "calculate",
  "payload": {
    "pumpIndex": 1,
    "actualMl": 950,
    "setMl": 1000
  }
}
```

### Reset Volume Counter

Resets the volume counter for a specific pump on Board2. Should be called before starting calibration workflow.

```json
{
  "topic": "reset-volume",
  "payload": {
    "pumpIndex": 1
  }
}
```

**Response**:
```json
{
  "topic": "reset-volume-complete",
  "payload": {
    "pumpIndex": 1,
    "success": true
  }
}
```

### Get Status

```json
{
  "topic": "status"
}
```

### Force Check

```json
{
  "topic": "check"
}
```

## Output Messages

### Automatic Calibration Complete

```json
{
  "topic": "calibration_complete",
  "payload": {
    "flagUpdates": {
      "CALCULATE_CALIB_BOM_1": false
    },
    "stats": {
      "lastCheck": 1703678400000,
      "lastCalibration": 1703678400000,
      "totalCalibrations": 5,
      "failedCalibrations": 0,
      "pendingCalibrations": []
    }
  }
}
```

### Manual Calibration Complete

```json
{
  "topic": "manual_calibration_complete",
  "payload": {
    "pumpIndex": 1,
    "board1": {
      "newCalibValue": 950,
      "address": 17,
      "registerKey": "HOLDING_CALIB_BOM_1"
    },
    "board2": {
      "newKFactor": 474,
      "kFactorAddress": 0,
      "kFactorKey": "HOLDING_K_FACTOR_BOM_1",
      "newFlowrate": 950,
      "flowrateAddress": 20,
      "flowrateKey": "HOLDING_FLOWRATE_BOM_1"
    },
    "runTime": 100,
    "success": true
  }
}
```

## Modbus Register Mapping

### Board1 (Pump Control - Port 502, Unit ID 1)

| Register Type | Address Formula | Key Pattern | Description |
|----------|-----------------|-------------|-------------|
| Holding | `i` | `HOLDING_SETML_BOM_{i}` | Target volume (mL) |
| Holding | `16 + i` | `HOLDING_CALIB_BOM_{i}` | Calibration value (×100) |

### Board2 (Flow Sensor - Port 503, Unit ID 1)

| Register Type | Address Formula | Key Pattern | Description |
|----------|-----------------|-------------|-------------|
| Holding | `i - 1` | `HOLDING_K_FACTOR_BOM_{i}` | K-Factor (pulses/L) |
| Holding | `19 + i` | `HOLDING_FLOWRATE_BOM_{i}` | Expected flowrate (mL/s × 100) |
| Input | `i - 1` | `INPUT_CURRENT_FLOW_BOM_{i}` | Current flow rate (mL/s) |
| Input | `19 + i` | `INPUT_TOTAL_FLOW_BOM_{i}` | Total volume (mL) |
| Coil | `160 + i` | `PUMP_STATUS_BOM_{i}` | Pump running status |
| Coil | `200 + i` | `RESET_TOTAL_VOLUME_BOM_{i}` | Reset volume counter |

**Note:** `i` is pump index (1-16)

## Usage Example

1. Add the `viis-flow-calibration` node to your flow
2. Connect an inject node for manual triggers
3. Connect a debug node to see calibration results
4. Set global context values to trigger automatic calibration:

```javascript
global.set("configKeyValues", {
    "CALCULATE_CALIB_BOM_1": true,
    "CALIB_ACTUAL_ML_BOM_1": 950
});
```

## Testing

Run unit tests:

```bash
npm test -- --testPathPattern="calibrationService"
```

## Integration with Existing Flow

### Migration from Legacy Flow

**Legacy Flow (Old):**
- Used function node "Pump Calibration Calculator"
- Only calibrated Board1 (pump control)
- Required separate flow for Board2 calibration

**New Flow (Recommended):**
- Use `viis-flow-calibration` custom node
- Calibrates **both Board1 and Board2 simultaneously**
- Single user input triggers both calibrations

### Migration Steps

1. **Remove old function nodes:**
   - Delete "Pump Calibration Calculator" function node
   - Delete associated modbus-flex-write nodes for Board1 only

2. **Add viis-flow-calibration node:**
   - Drag from node palette (under "viis-iot" category)
   - Configure:
     - `checkInterval`: 2000 (default)
     - `enableLogging`: false (or true for debugging)
     - `calibrateBoard1`: true
     - `calibrateBoard2`: true

3. **Connect input trigger:**
   - Use inject node or UI button to set global flags

4. **Connect output (optional):**
   - Debug node to monitor calibration results
   - MQTT node for cloud telemetry

### Example Flow Configuration

```json
[
    {
        "id": "calib-trigger",
        "type": "inject",
        "name": "Trigger Calibration",
        "payload": "",
        "payloadType": "date",
        "x": 150,
        "y": 100,
        "wires": [["flow-calibration-node"]]
    },
    {
        "id": "flow-calibration-node",
        "type": "viis-flow-calibration",
        "name": "Flow & Pump Calibration",
        "checkInterval": 2000,
        "enableLogging": false,
        "calibrateBoard1": true,
        "calibrateBoard2": true,
        "x": 400,
        "y": 100,
        "wires": [["debug-output"]]
    },
    {
        "id": "debug-output",
        "type": "debug",
        "name": "Calibration Result",
        "active": true,
        "tosidebar": true,
        "console": false,
        "complete": "payload",
        "x": 650,
        "y": 100,
        "wires": []
    }
]
```

### User Input Workflow (Single Action)

```javascript
// Frontend/UI sets these values when user clicks "Calibrate":
global.set("configKeyValues", {
    "CALCULATE_CALIB_BOM_1": true,      // Trigger flag
    "CALIB_ACTUAL_ML_BOM_1": 950        // User measured volume
});

// Node automatically:
// 1. Detects the trigger flag
// 2. Reads setMl from Board1 (HOLDING_SETML_BOM_1)
// 3. Reads reportedVolume from Board2 (INPUT_TOTAL_FLOW_BOM_1)
// 4. Calculates calibration for BOTH boards
// 5. Writes new values to BOTH boards
// 6. Resets the trigger flag
```

## License

Proprietary - VIIS Tech
