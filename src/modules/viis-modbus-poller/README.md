# VIIS Modbus Poller Node

A custom Node-RED node for polling Modbus data (coils, input registers, holding registers) and publishing telemetry to MQTT brokers and MySQL database with threshold-based and periodic snapshot capabilities.

## Features

- **Multi-Register Polling**: Supports coils, input registers, and holding registers
- **Threshold-Based Publishing**: Only publishes data when values change beyond configured thresholds
- **Periodic Snapshots**: Configurable periodic publishing regardless of threshold changes
- **Dual MQTT Publishing**: Publishes to both Thingsboard and EMQX brokers
- **MySQL Storage**: Saves telemetry data to MySQL database using DatabaseService with TypeORM
- **Shared Resources**: Uses ClientRegistry for MQTT and Modbus clients, DatabaseService for MySQL operations
- **Debug Logging**: Configurable debug logging for troubleshooting
- **Error Handling**: Robust error handling with automatic retry and failure limits

## Installation

This node is part of the VIIS Node-RED custom nodes package. It will be automatically available when the package is installed.

## Configuration

### Polling Intervals
- **Coil Polling Interval**: Time interval in milliseconds for polling coils (minimum: 100ms)
- **Input Polling Interval**: Time interval in milliseconds for polling input registers (minimum: 100ms)
- **Holding Polling Interval**: Time interval in milliseconds for polling holding registers (minimum: 100ms)

### Polling Quantities
- **Coil Quantity**: Number of coils to read in each polling cycle (1-2000)
- **Input Quantity**: Number of input registers to read in each polling cycle (1-125)
- **Holding Quantity**: Number of holding registers to read in each polling cycle (1-125)

### Configuration Options
- **Enable Debug Log**: Enable detailed debug logging for troubleshooting
- **Periodic Snapshot Interval**: Time interval in milliseconds for periodic snapshots (0 = disabled)
- **Threshold Configuration**: JSON object defining threshold values for change detection

### Threshold Configuration Format

```json
{
  "temperature": 0.5,
  "pressure": 1.0,
  "humidity": 2.0,
  "status": 0
}
```

- For numeric values: Only publish if the change exceeds the threshold
- For boolean/string values: Any change triggers publishing
- If a key is not specified, the default threshold (0.1) is used

## Environment Variables

The node uses shared connections configured through environment variables:

### Device Configuration
- `DEVICE_ID`: Device identifier for MQTT topics

### Modbus Configuration
- `MODBUS_TYPE`: Connection type (TCP or RTU)
- `MODBUS_HOST`: Host address for TCP connection
- `MODBUS_TCP_PORT`: Port for TCP connection (default: 502)
- `MODBUS_SERIAL_PORT`: Serial port for RTU connection
- `MODBUS_BAUD_RATE`: Baud rate for RTU connection
- `MODBUS_PARITY`: Parity for RTU connection (none, even, odd)
- `MODBUS_UNIT_ID`: Default unit ID (default: 1)
- `MODBUS_TIMEOUT`: Connection timeout in ms (default: 5000)
- `MODBUS_RECONNECT_INTERVAL`: Reconnection interval in ms (default: 5000)

### Modbus Register Mappings
- `MODBUS_COILS`: JSON mapping of coil names to addresses
- `MODBUS_INPUT_REGISTERS`: JSON mapping of input register names to addresses
- `MODBUS_HOLDING_REGISTERS`: JSON mapping of holding register names to addresses

Example:
```json
{
  "pump_1": 0,
  "pump_2": 1,
  "valve_1": 2,
  "alarm": 3
}
```

### MQTT Configuration
- `THINGSBOARD_HOST`: Thingsboard MQTT broker host
- `THINGSBOARD_PORT`: Thingsboard MQTT broker port
- `DEVICE_ACCESS_TOKEN`: Device access token for Thingsboard
- `THINGSBOARD_PASSWORD`: Password for Thingsboard (optional)
- `EMQX_HOST`: EMQX MQTT broker host
- `EMQX_PORT`: EMQX MQTT broker port
- `EMQX_USERNAME`: Username for EMQX (optional)
- `EMQX_PASSWORD`: Password for EMQX (optional)

## MQTT Topics

### Thingsboard
- **Topic**: `v1/devices/me/telemetry`
- **Format**: JSON object with key-value pairs

### EMQX
- **Topic**: `viis/things/v2/${deviceId}/telemetry`
- **Format**: JSON object with key-value pairs

## Data Processing Flow

1. **Polling**: Continuously polls Modbus data at configured intervals
2. **Mapping**: Maps register addresses to meaningful key names using environment variables
3. **Threshold Check**: Compares current values with previous values using configured thresholds
4. **Publishing Decision**: Publishes data if:
   - Values change beyond their thresholds, OR
   - Periodic snapshot interval has elapsed
5. **MQTT Publishing**: Publishes to both Thingsboard and EMQX brokers
6. **Database Storage**: Saves telemetry data to MySQL using TabiotDeviceTelemetry entity
7. **Global Context**: Updates Node-RED global context with current data

## Database Schema

The node saves data to the `tabiot_device_telemetry` table with the following structure:

- `device_id`: Device identifier
- `timestamp`: Unix timestamp in milliseconds
- `key_name`: Data key name
- `value_type`: Type of value (int, float, string, boolean, json)
- `int_value`, `float_value`, `string_value`, `boolean_value`, `json_value`: Value fields

## Error Handling

- **Connection Failures**: Automatic retry with exponential backoff
- **Polling Failures**: Tracks consecutive failures and stops polling after maximum attempts
- **MQTT Failures**: Graceful degradation when brokers are unavailable
- **Database Failures**: Continues operation even if database is unavailable
- **Configuration Errors**: Validates configuration and provides meaningful error messages

## Status Indicators

The node provides visual status indicators:
- **Green dot**: Ready and operating normally
- **Blue dot**: Currently polling data
- **Yellow dot**: Publishing telemetry data
- **Yellow ring**: Recoverable errors (with retry count)
- **Red ring**: Critical errors or maximum failures reached

## Performance Considerations

- Uses shared client connections for efficient resource utilization
- Implements threshold-based publishing to reduce unnecessary network traffic
- Supports configurable polling intervals to balance responsiveness and system load
- Includes circuit breaker patterns for resilient operation

## Troubleshooting

1. **Enable Debug Logging**: Check the "Enable Debug Log" option for detailed operation logs
2. **Check Environment Variables**: Ensure all required environment variables are set
3. **Verify Connections**: Check Modbus, MQTT, and MySQL connection status
4. **Review Thresholds**: Adjust threshold values if data is not being published as expected
5. **Monitor Status**: Watch the node status indicator for error conditions

## Dependencies

- Node-RED
- TypeORM for database operations via DatabaseService
- MQTT client for broker communication
- Modbus client for device communication
- Shared ClientRegistry for MQTT and Modbus resource management
- DatabaseService for MySQL database operations
