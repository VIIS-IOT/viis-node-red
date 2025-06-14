# Modbus TCP Timeout Fix for ATmega and Other Boards

## Overview

This document describes the fixes implemented to resolve Modbus TCP write command timeout issues, particularly when using ATmega boards instead of STM32 boards.

## Problem Description

The original implementation was hardcoded for STM32 boards with:
- Fixed 3-second timeouts for all operations
- STM32-specific socket optimizations
- Limited retry mechanisms
- Poor error handling leading to uncaught exceptions

When using ATmega boards, these settings caused frequent timeout errors because:
- ATmega boards typically have slower response times than STM32
- Different network stack characteristics
- Different optimal socket configurations

## Root Cause Analysis

1. **Hard-coded STM32 Timeouts**: All operations used 3-second timeouts regardless of board type
2. **Incompatible Socket Options**: STM32-optimized settings (keepAlive=false, noDelay=true) may not be optimal for ATmega
3. **Limited Retry Logic**: Only 2 retries for STM32, insufficient for slower boards
4. **Poor Error Propagation**: Timeout errors caused uncaught exceptions instead of graceful handling

## Solution Implementation

### 1. Board-Specific Configuration

Added support for different board types via environment variables:

```bash
# Board type detection
MODBUS_BOARD_TYPE=ATMEGA  # Options: STM32, ATMEGA, GENERIC

# Board-specific timeouts
MODBUS_WRITE_TIMEOUT=8000      # Write operation timeout (ms)
MODBUS_READ_TIMEOUT=8000       # Read operation timeout (ms)
MODBUS_CONNECTION_TIMEOUT=5000 # Connection establishment timeout (ms)
MODBUS_MAX_RETRIES=3           # Maximum retry attempts
```

### 2. Automatic Board Optimization

The system now automatically applies board-specific optimizations:

#### STM32 Configuration
- Write/Read Timeout: 3000ms
- Connection Timeout: 2000ms
- Max Retries: 2
- Socket Options: keepAlive=false, noDelay=true

#### ATmega Configuration
- Write/Read Timeout: 8000ms
- Connection Timeout: 5000ms
- Max Retries: 3
- Socket Options: keepAlive=true, noDelay=false

#### Generic Configuration
- Write/Read Timeout: 5000ms
- Connection Timeout: 3000ms
- Max Retries: 3
- Socket Options: keepAlive=false, noDelay=true

### 3. Enhanced Error Handling

- Timeout errors are now caught and handled gracefully
- Retry logic with exponential backoff
- Better error messages indicating board type and timeout values
- Error status published via MQTT instead of throwing uncaught exceptions

### 4. Improved Retry Mechanism

- Configurable retry attempts based on board type
- Exponential backoff between retries
- Detailed logging of retry attempts
- Graceful failure after max retries exceeded

## Configuration Examples

### For ATmega Boards

Copy `services/.env.atmega-example` to `services/.env` and modify:

```bash
MODBUS_BOARD_TYPE=ATMEGA
MODBUS_WRITE_TIMEOUT=8000
MODBUS_READ_TIMEOUT=8000
MODBUS_CONNECTION_TIMEOUT=5000
MODBUS_MAX_RETRIES=3
```

### For STM32 Boards

```bash
MODBUS_BOARD_TYPE=STM32
MODBUS_WRITE_TIMEOUT=3000
MODBUS_READ_TIMEOUT=3000
MODBUS_CONNECTION_TIMEOUT=2000
MODBUS_MAX_RETRIES=2
```

### For Generic/Unknown Boards

```bash
MODBUS_BOARD_TYPE=GENERIC
MODBUS_WRITE_TIMEOUT=5000
MODBUS_READ_TIMEOUT=5000
MODBUS_CONNECTION_TIMEOUT=3000
MODBUS_MAX_RETRIES=3
```

## Troubleshooting

### Still Getting Timeouts?

1. **Increase Timeout Values**: Try doubling the timeout values
2. **Check Network Connectivity**: Ensure stable network connection to the board
3. **Verify Board Firmware**: Ensure Modbus implementation is working correctly
4. **Monitor Logs**: Check for specific error patterns in the logs

### Log Messages to Look For

#### Success Messages
```
[ATMEGA-WRITE] Successfully wrote coil 47 = true on attempt 1
[ATMEGA-SUCCESS] Connected to ATMEGA Modbus at 192.168.1.100:502
```

#### Retry Messages
```
[ATMEGA-WRITE] Write coil 47 timeout on attempt 1/3, retrying in 1000ms...
```

#### Error Messages
```
[ATMEGA-WRITE-FAILED] Write coil 47 failed after 3 attempts: timeout
```

## Testing the Fix

1. Set `MODBUS_BOARD_TYPE=ATMEGA` in your `.env` file
2. Try writing to coil address 47: `{"method":"set_state","params":{"COIL_AUTO_TRON":1}}`
3. Monitor logs for timeout and retry behavior
4. Verify that errors are handled gracefully without uncaught exceptions

## Performance Impact

- Longer timeouts may increase response time for successful operations
- Retry logic adds resilience but may increase total operation time on failures
- Board-specific optimizations should improve overall reliability

## Future Improvements

- Auto-detection of board type based on response characteristics
- Dynamic timeout adjustment based on historical performance
- More sophisticated retry strategies (e.g., circuit breaker pattern)
- Board-specific connection pooling strategies
