# HOLDING_SETML_BOM Offset Feature - Test Examples

## Test Cases

### Test Case 1: Basic Offset Application

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 100
    }
}
```

**Expected Behavior:**
1. Original value: 100
2. Offset applied: 100 + 34 = 134
3. Value written to Modbus: 134
4. Log message: `[OFFSET] Applied offset to HOLDING_SETML_BOM_1: 100 + 34 = 134`

### Test Case 2: Multiple Keys with Different Offsets

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 50,
        "HOLDING_SETML_BOM_2": 75,
        "HOLDING_SETML_BOM_14": 200
    }
}
```

**Expected Results:**
- HOLDING_SETML_BOM_1: 50 + 34 = 84
- HOLDING_SETML_BOM_2: 75 + 55 = 130
- HOLDING_SETML_BOM_14: 200 + 56 = 256

### Test Case 3: Mixed Keys (With and Without Offset)

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 100,
        "HOLDING_TEMP_SETPOINT": 25,
        "COIL_AUTO_MODE": true
    }
}
```

**Expected Behavior:**
- HOLDING_SETML_BOM_1: 100 + 34 = 134 (offset applied)
- HOLDING_TEMP_SETPOINT: 25 (no offset, normal processing)
- COIL_AUTO_MODE: true (boolean, no offset)

### Test Case 4: Feature Disabled

**Configuration:**
```typescript
HOLDING_SETML_BOM_OFFSETS.ENABLED = false;
```

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 100
    }
}
```

**Expected Behavior:**
- Value written to Modbus: 100 (no offset applied)
- No offset log messages

### Test Case 5: Non-numeric Values

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": "invalid"
    }
}
```

**Expected Behavior:**
- Validation should catch the invalid type
- No offset applied to non-numeric values
- Error handling as per normal validation flow

### Test Case 6: Zero and Negative Values

**Input RPC:**
```json
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 0,
        "HOLDING_SETML_BOM_2": -10
    }
}
```

**Expected Results:**
- HOLDING_SETML_BOM_1: 0 + 34 = 34
- HOLDING_SETML_BOM_2: -10 + 55 = 45

## Manual Testing Steps

### Step 1: Verify Feature is Enabled

```javascript
// In Node-RED function node or debug
const modbusService = /* get modbus service instance */;
const isEnabled = modbusService.isHoldingSetmlBomOffsetEnabled();
console.log("Offset feature enabled:", isEnabled);
```

### Step 2: Check Offset Values

```javascript
// Check specific offset
const offset1 = modbusService.getHoldingSetmlBomOffset("HOLDING_SETML_BOM_1");
console.log("Offset for BOM_1:", offset1); // Should be 34

// Check all offsets
const config = modbusService.getHoldingSetmlBomOffsetConfig();
console.log("All offset config:", config);
```

### Step 3: Send Test RPC

```javascript
// Send via MQTT or direct input
const testRpc = {
    method: "set_state",
    params: {
        "HOLDING_SETML_BOM_1": 100
    }
};

// Monitor logs for offset application
// Expected log: [OFFSET] Applied offset to HOLDING_SETML_BOM_1: 100 + 34 = 134
```

### Step 4: Verify Modbus Write

```javascript
// Check what value was actually written to Modbus
// Should be 134, not 100
```

## Debugging Checklist

### ✅ Configuration Check
- [ ] `HOLDING_SETML_BOM_OFFSETS.ENABLED` is `true`
- [ ] Key exists in `HOLDING_SETML_BOM_OFFSETS.OFFSETS`
- [ ] Offset value is a valid number

### ✅ Runtime Check
- [ ] Input value is a number (not string or boolean)
- [ ] Key matches exactly (case-sensitive)
- [ ] ModbusService is properly initialized

### ✅ Log Verification
- [ ] `[OFFSET]` log message appears
- [ ] Offset calculation is correct
- [ ] Final Modbus write value includes offset

### ✅ Integration Check
- [ ] Scaling is applied after offset (if configured)
- [ ] Other keys work normally (no side effects)
- [ ] Error handling works for invalid inputs

## Performance Considerations

### Minimal Overhead
- Offset check is O(1) lookup
- Only applies to specific keys
- No impact on non-offset keys

### Memory Usage
- Offset configuration is loaded once at startup
- No additional memory allocation during runtime

## Edge Cases

### Case 1: Very Large Numbers
```javascript
// Test with large numbers
{
    "HOLDING_SETML_BOM_1": 999999
}
// Result: 999999 + 34 = 1000033
```

### Case 2: Floating Point Numbers
```javascript
// Test with decimals
{
    "HOLDING_SETML_BOM_1": 100.5
}
// Result: 100.5 + 34 = 134.5
```

### Case 3: Key Not in Offset List
```javascript
// Test with non-existent key
{
    "HOLDING_SETML_BOM_999": 100
}
// Result: 100 (no offset applied)
```

## Rollback Plan

If issues occur, quickly disable the feature:

```typescript
// In constants.ts
export const HOLDING_SETML_BOM_OFFSETS = {
    ENABLED: false, // Quick disable
    OFFSETS: {
        // Keep configuration for re-enabling
    }
};
```

This will immediately disable all offset processing while maintaining the configuration for future use.