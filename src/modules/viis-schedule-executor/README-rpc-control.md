# RPC Control Commands Logic

## Overview

The VIIS Schedule Executor now supports RPC control commands with fallback logic. When RPC control commands are received, the system follows this business logic:

1. **Check Modbus Mapping**: First, check if the command key exists in `MODBUS_COILS` or `MODBUS_HOLDING_REGISTERS`
2. **Modbus Execution**: If found in mapping, the command should be handled by modbus logic
3. **Fallback to Config**: If NOT found in mapping, write the command to global variable `configKeyValues`

## Business Logic Flow

```
RPC Control Command Received
         ↓
Check if key exists in modbus mapping
         ↓
    ┌─────────┐         ┌─────────────┐
    │ Found   │         │ Not Found   │
    │         │         │             │
    ▼         │         ▼             │
Handle via    │    Write to           │
Modbus        │    configKeyValues    │
              │                       │
              └───────────────────────┘
```

## Implementation

### RPC Message Format

Send RPC control commands using this format:

```javascript
{
  "payload": {
    "method": "control",
    "params": {
      "pump_1": true,           // Will be handled by modbus (if mapped)
      "custom_setting": 42,     // Will be written to configKeyValues (if not mapped)
      "debug_mode": true,       // Will be written to configKeyValues (if not mapped)
      "valve_A1": false         // Will be handled by modbus (if mapped)
    }
  }
}
```

### Response Format

The system responds with detailed results:

```javascript
{
  "payload": {
    "method": "control",
    "results": [
      {
        "key": "pump_1",
        "success": true,
        "action": "modbus",
        "result": { "address": 0, "type": "coil" }
      },
      {
        "key": "custom_setting",
        "success": true,
        "action": "config",
        "result": { "key": "custom_setting", "value": 42 }
      }
    ],
    "timestamp": 1640995200000
  }
}
```

## Global Variables

### configKeyValues Structure

Commands not found in modbus mapping are stored in:

```javascript
// Global context: configKeyValues
{
  "custom_setting": 42,
  "debug_mode": true,
  "user_preference": "high",
  "irrigation_mode": "automatic"
}
```

### configKeyValues Structure

Schedule execution unmapped keys are still stored separately in:

```javascript
// Global context: configKeyValues  
{
  "iri_time": 1800,
  "schedule_priority": 1
}
```

## Key Differences

| Source | Unmapped Keys Storage | Purpose |
|--------|----------------------|---------|
| **RPC Control Commands** | `configKeyValues` | Real-time control parameters |
| **Schedule Execution** | `configKeyValues` | Schedule-specific parameters |

## Usage Examples

### Example 1: Mixed Commands

```javascript
// Input RPC message
{
  "payload": {
    "method": "control", 
    "params": {
      "pump_1": true,              // Mapped to modbus coil 0
      "set_flow_A1": 150,          // Mapped to modbus holding register 10
      "irrigation_mode": "auto",   // Not mapped → goes to configKeyValues
      "debug_level": 2             // Not mapped → goes to configKeyValues
    }
  }
}

// Result:
// - pump_1 and set_flow_A1: Handled by modbus
// - irrigation_mode and debug_level: Written to configKeyValues
```

### Example 2: All Unmapped Commands

```javascript
// Input RPC message
{
  "payload": {
    "method": "control",
    "params": {
      "weather_compensation": true,
      "max_duration": 3600,
      "priority_level": 2
    }
  }
}

// Result: All parameters written to configKeyValues
```

## Monitoring

### Log Messages

- **Modbus Action**: `RPC control: pump_1=true should be handled by modbus (address: 0)`
- **Config Action**: `RPC control: custom_setting=42 stored in configKeyValues`
- **Error**: `RPC control failed for invalid_key=value`

### Global Context Inspection

Check the current state:

```javascript
// In Node-RED function node
const configKeyValues = global.get('configKeyValues');
const configKeyValues = global.get('configKeyValues');

msg.payload = {
  configKeyValues,
  configKeyValues
};
return msg;
```

## Testing

Run the test suite to verify the logic:

```bash
npm test -- rpc-control-commands.test.ts
```

The test covers:
- ✅ Unmapped keys → configKeyValues
- ✅ Mapped keys → modbus action
- ✅ Mixed scenarios
- ✅ Data type handling (string, number, boolean)
- ✅ Multiple commands in single RPC call

## Migration Notes

- **Backward Compatibility**: Existing schedule execution logic unchanged
- **New Feature**: RPC control commands now supported
- **Separation**: Clear separation between RPC control and schedule config storage
- **Fallback Logic**: Robust fallback when modbus mapping is not available
