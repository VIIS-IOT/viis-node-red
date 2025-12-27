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

## Calibration Algorithm

### Board1 (Pump Control)

```
runTime = setMl / currentCalib
newCalib = actualMl / runTime
```

### Board2 (Flow Sensor)

```
K_new = K_old × (V_reported / V_real)
Q_new = V_real / runTime
```

Where:
- `V_real` = User measured volume (actualMl)
- `V_reported` = Sensor reported volume
- `K_old` = Current K-Factor
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

### Board1 (Pump Control - Port 502)

| Register | Address Formula | Description |
|----------|-----------------|-------------|
| `HOLDING_SETML_BOM_{i}` | i | Target volume in mL |
| `HOLDING_CALIB_BOM_{i}` | 16 + i | Calibration value (×100) |

### Board2 (Flow Sensor - Port 503)

| Register | Address Formula | Description |
|----------|-----------------|-------------|
| `HOLDING_K_FACTOR_BOM_{i}` | i - 1 | K-Factor (0-15) |
| `HOLDING_FLOWRATE_BOM_{i}` | 19 + i | Expected flowrate (×100) |
| `INPUT_TOTAL_FLOW_BOM_{i}` | 19 + i | Reported total volume |

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

This node is designed to work alongside the existing pump calibration flow:

1. User inputs actual measured volume
2. Set `CALIB_ACTUAL_ML_BOM_{i}` and `CALCULATE_CALIB_BOM_{i}` in global context
3. Both the existing pump calibration flow (board1) and this node (board1 + board2) will process
4. Calibration flags are reset after processing

## License

Proprietary - VIIS Tech
