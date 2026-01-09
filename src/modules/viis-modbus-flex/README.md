# VIIS Modbus Getter Node

A custom Node-RED node for reading data from Modbus devices using shared connection resources. This node provides a simple interface similar to the standard modbus-flex-getter but uses the VIIS shared modbus client for efficient resource management.

## Features

- **Shared Modbus Connection**: Uses ClientRegistry for efficient resource sharing
- **Multiple Function Codes**: Supports all standard Modbus read operations
- **Input Validation**: Comprehensive validation of all input parameters
- **Error Handling**: Detailed error messages and status reporting
- **Clean Architecture**: Modular design with separated concerns

## Installation

This node is part of the VIIS Node-RED package. It will be automatically available after building the project.

## Configuration

The node uses environment variables for Modbus connection configuration:

```bash
# Required
MODBUS_TYPE=TCP                    # Connection type (TCP or RTU)
MODBUS_HOST=192.168.1.51          # Host address for TCP
MODBUS_TCP_PORT=502               # TCP port (default: 502)

# Optional
MODBUS_UNIT_ID=1                  # Default unit ID (default: 1)
MODBUS_TIMEOUT=5000               # Connection timeout in ms (default: 5000)
MODBUS_RECONNECT_INTERVAL=5000    # Reconnect interval in ms (default: 5000)

# For RTU connections
MODBUS_SERIAL_PORT=/dev/ttyUSB0   # Serial port for RTU
MODBUS_BAUD_RATE=9600             # Baud rate for RTU (default: 9600)
MODBUS_PARITY=none                # Parity for RTU (none/even/odd, default: none)
```

## Usage

### Input Format

The node expects a message with a payload containing the Modbus request parameters:

```javascript
msg.payload = {
    fc: 3,          // Function code (1, 2, 3, or 4)
    unitid: 1,      // Unit ID
    address: 0,     // Starting address
    quantity: 10    // Number of registers/coils to read
};
```

### Function Codes

- **1**: Read Coils (returns boolean array)
- **2**: Read Discrete Inputs (returns boolean array) *
- **3**: Read Holding Registers (returns number array)
- **4**: Read Input Registers (returns number array)

*Note: Function code 2 (Read Discrete Inputs) uses the same implementation as Read Coils due to ModbusClientCore limitations.

### Output Format

#### Success Response

```javascript
{
    success: true,
    data: [1, 2, 3, 4, 5],        // Array of values read
    address: 0,                    // Starting address
    quantity: 5,                   // Number of values read
    functionCode: 3,               // Function code used
    timestamp: 1640995200000       // Timestamp of operation
}
```

#### Error Response

```javascript
{
    error: "Error message",        // Error description
    timestamp: 1640995200000       // Timestamp of error
}
```

## Example Flow

```javascript
// Inject node
msg.payload = {
    fc: 3,
    unitid: 1,
    address: 0,
    quantity: 20
};
return msg;

// VIIS Modbus Getter node processes the request

// Debug node shows result
// Success: { success: true, data: [...], ... }
// Error: { error: "...", timestamp: ... }
```

## Validation

The node performs comprehensive validation:

- **Payload Structure**: Checks for required fields and correct types
- **Function Code**: Must be 1, 2, 3, or 4
- **Address**: Must be between 0 and 65535
- **Quantity**: Must be positive and within limits:
  - Coils/Discrete Inputs: 1-2000
  - Registers: 1-125

## Error Handling

Common error scenarios:

1. **Invalid Payload**: Missing or incorrect payload format
2. **Connection Issues**: Modbus client not connected
3. **Validation Errors**: Invalid parameters
4. **Modbus Errors**: Communication failures

## Status Indicators

- **Green Dot**: Ready and connected
- **Blue Dot**: Reading data
- **Yellow Ring**: Initializing
- **Red Ring**: Error or disconnected

## Architecture

```
viis-modbus-flex/
├── constants.ts              # Configuration constants
├── interfaces/
│   └── types.ts             # TypeScript interfaces
├── services/
│   └── modbusGetterService.ts # Core business logic
├── utils/
│   └── logger.ts            # Logging utilities
├── icons/
│   └── logo.png             # Node icon
├── viis-modbus-flex.html  # UI definition
└── viis-modbus-flex.ts    # Main node implementation
```

## Development

To modify or extend the node:

1. Edit the appropriate service or utility files
2. Run `npm run build` to compile TypeScript
3. Restart Node-RED to load changes

## Troubleshooting

1. **Node shows "Error" status**: Check Modbus connection configuration
2. **"Modbus client not connected"**: Verify MODBUS_HOST and MODBUS_TCP_PORT
3. **Validation errors**: Check input payload format and values
4. **No response**: Ensure target Modbus device is accessible

## Related Nodes

- **viis-rpc-control**: For writing to Modbus devices
- **viis-telemetry**: For continuous data polling
- **viis-auto-microclimate-control**: For automated control logic
