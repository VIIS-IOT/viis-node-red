# VIIS Schedule Executor - Unmapped Keys Enhancement

## Overview

The VIIS Schedule Executor has been enhanced to handle unmapped keys (schedule action parameters that don't have Modbus mapping) as configuration parameters, similar to the implementation in viis-rpc-control. This enhancement provides greater flexibility and transparency in schedule management while maintaining full backward compatibility.

## Key Features

### 1. Unmapped Key Processing
- **Automatic Detection**: Keys in schedule actions that don't exist in `MODBUS_COILS` or `MODBUS_HOLDING_REGISTERS` are automatically identified as unmapped keys
- **Configuration Storage**: Unmapped keys are stored as configuration parameters in the global context
- **Type Conversion**: Automatic type detection and conversion for numbers, booleans, and strings
- **MQTT Publishing**: All configuration updates are published via both ThingsBoard and EMQX MQTT clients

### 2. Enhanced Return Structure

The `mapScheduleToModbus()` function now returns an enhanced structure:

```typescript
{
    holdingCommands: ModbusCmd[],     // Existing: Modbus holding register commands
    coilCommands: ModbusCmd[],        // Existing: Modbus coil commands
    configParameters: ConfigParameter[] // New: Configuration parameters for unmapped keys
}
```

### 3. Configuration Parameter Structure

```typescript
interface ConfigParameter {
    key: string;           // Parameter name
    value: any;           // Parameter value (converted)
    type: 'number' | 'boolean' | 'string'; // Detected type
    timestamp: number;    // Creation timestamp
    scheduleId: string;   // Associated schedule ID
}
```

## Usage Examples

### Example 1: Mixed Mapped and Unmapped Keys

```json
{
    "name": "irrigation-schedule-001",
    "action": {
        "main_pump": true,              // Mapped to MODBUS_COILS -> Modbus command
        "valve_A1": true,               // Mapped to MODBUS_COILS -> Modbus command
        "iri_time": 1800,               // Mapped to MODBUS_HOLDING_REGISTERS -> Modbus command
        "irrigation_mode": "automatic", // Unmapped -> Config parameter (string)
        "user_id": "farmer_001",        // Unmapped -> Config parameter (string)
        "weather_compensation": true,   // Unmapped -> Config parameter (boolean)
        "max_duration": 3600,           // Unmapped -> Config parameter (number)
        "priority_level": 2             // Unmapped -> Config parameter (number)
    }
}
```

**Result:**
- **Modbus Commands**: `main_pump`, `valve_A1`, `iri_time` are processed as Modbus commands
- **Config Parameters**: `irrigation_mode`, `user_id`, `weather_compensation`, `max_duration`, `priority_level` are stored as configuration parameters
- **MQTT Publishing**: All config parameters are published to both ThingsBoard and EMQX

### Example 2: Type Conversion Examples

```json
{
    "action": {
        "numeric_string": "123",        // Converted to number: 123
        "decimal_string": "45.67",      // Converted to number: 45.67
        "comma_number": "1,234.56",     // Converted to number: 1234.56
        "bool_true": "true",            // Converted to boolean: true
        "bool_false": "FALSE",          // Converted to boolean: false
        "regular_string": "hello",      // Remains string: "hello"
        "null_value": null,             // Remains null: null
        "zero_value": 0                 // Remains number: 0
    }
}
```

## Implementation Details

### 1. Configuration Storage

Unmapped keys are stored in the global context under the key `configKeyValues`:

```typescript
// Global context structure
{
    "configKeyValues": {
        "irrigation_mode": "automatic",
        "user_id": "farmer_001",
        "weather_compensation": true,
        "max_duration": 3600,
        "priority_level": 2
    }
}
```

### 2. MQTT Publishing

Configuration updates are published to both MQTT clients with the following payload structure:

```json
{
    "ts": 1640995200000,
    "parameter_name": "parameter_value",
    "note": "Config parameter updated (no Modbus mapping) for schedule schedule-001",
    "type": "string",
    "source": "schedule-executor"
}
```

**Topics:**
- **ThingsBoard**: `v1/devices/me/telemetry`
- **EMQX Local**: `viis/things/v2/{DEVICE_ID}/telemetry`

### 3. Validation and Type Detection

The system automatically validates and converts values:

```typescript
// String to number conversion
"123" -> 123 (number)
"45.67" -> 45.67 (number)
"1,234.56" -> 1234.56 (number)

// String to boolean conversion
"true" -> true (boolean)
"false" -> false (boolean)
"TRUE" -> true (boolean)

// Default to string
"hello" -> "hello" (string)
```

## Backward Compatibility

### Existing Functionality Preserved
- All existing Modbus mapping and execution logic remains unchanged
- Schedules with only mapped keys work exactly as before
- The original warning log format is maintained
- Return structure includes new `configParameters` field but preserves existing fields

### Migration Path
- **No changes required** for existing schedules with only mapped keys
- **Automatic enhancement** for schedules with unmapped keys
- **Gradual adoption** - unmapped keys can be added to existing schedules without breaking functionality

## Error Handling

### Graceful Degradation
- **Invalid JSON**: Logged as error, processing continues with empty results
- **Type conversion errors**: Individual parameter failures don't stop processing
- **MQTT publish errors**: Logged as errors but don't break schedule execution
- **Missing environment variables**: Default values used, processing continues

### Logging
- **Info logs**: Successful config parameter storage and MQTT publishing
- **Warning logs**: Unmapped keys detected (existing behavior preserved)
- **Error logs**: JSON parsing errors, MQTT publish failures, validation errors

## Testing

### Test Coverage
- **Unit tests**: Type conversion, validation, storage mechanisms
- **Integration tests**: MQTT publishing, global context storage
- **End-to-end tests**: Complete schedule processing flow
- **Backward compatibility tests**: Existing functionality verification
- **Error handling tests**: Graceful failure scenarios

### Test Files
- `schedule-executor-unmapped-keys.test.ts`: Core functionality tests
- `schedule-executor-mqtt-integration.test.ts`: MQTT publishing tests
- `schedule-executor-e2e.test.ts`: End-to-end integration tests

## Performance Considerations

### Optimizations
- **Efficient type detection**: Minimal overhead for type conversion
- **Batch processing**: Multiple config parameters processed efficiently
- **Memory management**: Global context storage optimized for frequent updates
- **MQTT debouncing**: Prevents excessive MQTT traffic (inherited from existing implementation)

### Scalability
- **Large schedules**: Tested with 100+ unmapped keys
- **Concurrent schedules**: Multiple schedules can have unmapped keys simultaneously
- **Memory usage**: Minimal additional memory footprint

## Configuration

### Environment Variables
No new environment variables required. The enhancement uses existing:
- `MODBUS_COILS`: For identifying mapped coil keys
- `MODBUS_HOLDING_REGISTERS`: For identifying mapped holding register keys
- `DEVICE_ID`: For EMQX MQTT topic construction

### Global Context Keys
- `configKeyValues`: Stores all configuration parameter values
- Existing keys remain unchanged

## Monitoring and Debugging

### Log Messages
```
// Successful config parameter storage
"Stored config parameter: irrigation_mode=automatic (type: string) for schedule irrigation-001"

// MQTT publishing success
"Published config update to ThingsBoard: irrigation_mode=automatic"
"Published config update to EMQX local: irrigation_mode=automatic"

// Unmapped key detection (existing)
"No modbus mapping found for key: irrigation_mode in schedule irrigation-001, storing as config parameter"
```

### MQTT Monitoring
Monitor the following topics for config parameter updates:
- ThingsBoard: `v1/devices/me/telemetry`
- EMQX Local: `viis/things/v2/{DEVICE_ID}/telemetry`

Look for messages with `"source": "schedule-executor"` and `"note"` containing "Config parameter updated".

## Future Enhancements

### Potential Improvements
1. **Config parameter history**: Track changes over time
2. **Validation rules**: Custom validation for specific parameter types
3. **Parameter templates**: Predefined parameter schemas
4. **Web UI integration**: Management interface for config parameters
5. **Export/import**: Backup and restore config parameters

### API Extensions
1. **Query endpoints**: Retrieve config parameters via REST API
2. **Bulk operations**: Update multiple parameters at once
3. **Parameter search**: Find schedules by config parameter values
