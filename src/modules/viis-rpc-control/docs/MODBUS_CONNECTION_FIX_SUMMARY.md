# Modbus Connection Error Fix Summary

## Problem Description

The VIIS RPC Control module was experiencing intermittent Modbus connection errors, specifically:

```
7 Jul 01:44:11 - [error] [viis-rpc-control:b5672718988de763] [MODBUS-SERVICE] Modbus connection check failed: this.modbusClient.reconnect is not a function
7 Jul 01:44:11 - [error] [viis-rpc-control:b5672718988de763] [STM32-WRITE] Failed to write register 40 after 2 attempts: Port Not Open
```

### Root Cause Analysis

1. **Missing Reconnect Method**: The `ModbusClientCore` class did not have a public `reconnect()` method, but the `ModbusService` was trying to call `this.modbusClient.reconnect()`.

2. **Poor Error Handling**: When connection errors occurred, the system didn't have proper retry logic with reconnection attempts.

3. **Insufficient Connection Recovery**: The existing connection check logic was not robust enough to handle intermittent connection losses.

## Implemented Fixes

### 1. Added Public Reconnect Method to ModbusClientCore

**File**: `src/core/modbus-client.ts`

```typescript
// Public method to manually trigger reconnection
public async reconnect(): Promise<void> {
    this.node.warn("[MODBUS-RECONNECT] Manual reconnection requested");
    
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }
    
    // Mark as disconnected
    this.isConnected = false;
    
    // Close existing connection
    try {
        if (this.client.isOpen) {
            this.client.close();
        }
    } catch (closeErr) {
        // Ignore close errors
    }
    
    // Create new client instance
    this.client = new ModbusRTU();
    
    // Attempt to reconnect
    await this.initializeClient();
}
```

### 2. Enhanced Error Handling in RpcHandler

**File**: `src/modules/viis-rpc-control/handlers/rpcHandler.ts`

Added retry logic with automatic reconnection for both read and write operations:

- `writeToModbusWithRetry()`: Handles write operations with connection error detection and retry
- `readFromModbusWithRetry()`: Handles read operations with connection error detection and retry
- `isConnectionError()`: Detects connection-related errors vs other types of errors

### 3. Improved ModbusService Connection Handling

**File**: `src/modules/viis-rpc-control/services/modbusService.ts`

- Enhanced `checkConnection()` method with proper error handling
- Added connection error detection in `writeToModbus()` method
- Improved error messages with more context

## Key Features of the Fix

### 1. Connection Error Detection

The system now detects various types of connection errors:
- "Port Not Open"
- "Timed out" / "TIMEOUT"
- "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"
- "EPIPE", "EHOSTUNREACH", "ENETUNREACH"
- "socket hang up", "socket closed"
- "Connection lost"

### 2. Automatic Retry Logic

- **Maximum Retries**: 2 attempts by default
- **Exponential Backoff**: Wait time increases with each retry (1s, 2s, etc.)
- **Smart Reconnection**: Only attempts reconnection for connection-related errors
- **Stabilization Time**: Waits 1 second after reconnection for connection to stabilize

### 3. Better Error Messages

Improved error messages provide more context:
```
[RPC-HANDLER] Modbus connection error: Port Not Open. Please check device connection and configuration.
```

### 4. Graceful Degradation

- Non-connection errors are not retried (e.g., invalid register addresses)
- Connection errors trigger reconnection attempts
- Clear logging at each step for debugging

## Usage and Monitoring

### Log Messages to Watch For

**Successful Operation**:
```
[MODBUS-SERVICE] Reconnection successful
[RPC-HANDLER] Reconnection successful, retrying operation...
```

**Connection Issues**:
```
[RPC-HANDLER] Modbus connection lost: Port Not Open
[RPC-HANDLER] Attempting reconnection (1/2)...
```

**Final Failure**:
```
[RPC-HANDLER] Modbus connection error: Port Not Open. Please check device connection and configuration.
```

### Troubleshooting Steps

1. **Check Physical Connection**: Ensure STM32/device is properly connected
2. **Verify Network Settings**: Check IP address and port configuration
3. **Monitor Logs**: Look for connection patterns and retry attempts
4. **Device Reset**: If issues persist, consider restarting the target device

## Testing Recommendations

1. **Simulate Connection Loss**: Temporarily disconnect the device to test reconnection
2. **Monitor Performance**: Check if retry logic affects response times
3. **Load Testing**: Test with multiple concurrent RPC requests
4. **Long-term Stability**: Monitor for connection stability over extended periods

## Future Improvements

1. **Configurable Retry Settings**: Make retry count and delays configurable
2. **Connection Health Monitoring**: Add periodic connection health checks
3. **Circuit Breaker Pattern**: Implement circuit breaker for repeated failures
4. **Metrics Collection**: Add metrics for connection success/failure rates

## Files Modified

1. `src/core/modbus-client.ts` - Added public reconnect method
2. `src/modules/viis-rpc-control/handlers/rpcHandler.ts` - Enhanced error handling and retry logic
3. `src/modules/viis-rpc-control/services/modbusService.ts` - Improved connection checking and error detection

This fix should significantly reduce the occurrence of "Port Not Open" and "reconnect is not a function" errors by providing robust connection recovery mechanisms.