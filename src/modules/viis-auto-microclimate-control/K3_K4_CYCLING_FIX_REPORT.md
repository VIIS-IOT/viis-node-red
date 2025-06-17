# K3/K4 Fan Cycling Fix Report

## Problem Description

The VIIS auto microclimate control system was experiencing an unwanted 20-second on/off cycling behavior specifically with K3 and K4 fan groups:

- **K1 and K2 fan groups**: Working correctly
- **K3 and K4 groups**: Control 6 fans each
- **Issue**: When operating in K3-K4 mode, the group of 6 fans was cycling on for 20 seconds, then off for 20 seconds, repeating continuously

## Root Cause Analysis

The issue was caused by the system incorrectly applying rotation logic to K3/K4 modes, which use 6 fans (all available fans). The problem occurred because:

1. **Single Group Configuration**: K3 and K4 both require 6 fans, but there's only one group of 6 fans available: `["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]`

2. **Incorrect Rotation Logic**: The system was trying to apply rotation logic even when only one group was available, causing unnecessary state changes

3. **20-Second Pattern**: The cycling occurred every 2 polling cycles (2 × 10-second polling interval = 20 seconds)

## Solution Implemented

### 1. Added `supportsRotation()` Function

```typescript
/**
 * Check if a group size supports rotation (has multiple groups)
 * This is critical for K3/K4 modes which use 6 fans but should not rotate
 */
export function supportsRotation(groupSize: number): boolean {
    const groups = getFanGroups(groupSize);
    return groups.length > 1;
}
```

### 2. Fixed Threshold Mode Logic

Updated the threshold mode to check if rotation is supported before applying rotation logic:

```typescript
// Check if this group size supports rotation (has multiple groups)
if (!supportsRotation(requiredGroupSize)) {
    // Only one group available for this size (e.g., K3/K4 with 6 fans)
    // Use the single available group directly without rotation logic
    targetGroup = fanGroups[0];
    this.logger.debug(`Single group mode for size ${requiredGroupSize}: using [${targetGroup.join(', ')}] - no rotation needed`);
} else {
    // Multiple groups available - use rotation logic
    // ... existing rotation logic for K1/K2 modes
}
```

### 3. Fixed Rotation Mode Logic

Updated rotation mode to handle single-group scenarios:

```typescript
// Check if rotation is supported for this group size
if (!supportsRotation(groupSize)) {
    // Only one group available - no rotation needed, just keep fans on
    const targetGroup = fanGroups[0];
    
    // Use optimized function to avoid unnecessary actions
    return createOptimizedFanGroupActions(
        targetGroup,
        true,
        `Single group mode: no rotation needed`,
        coilMapping,
        currentDeviceStatus
    );
}
```

### 4. Enhanced Early Return Logic

Improved the early return condition to prevent unnecessary processing:

```typescript
if (currentActiveFanCount === requiredGroupSize && requiredGroupSize > 0) {
    if (supportsRotation(requiredGroupSize)) {
        // Multiple groups available - check if rotation is needed
        // ... existing rotation logic
    } else {
        // Only one group available for this size (e.g., K3/K4 with 6 fans)
        this.logger.debug(`No change needed: current fan count matches required and only one group available (K3/K4 mode)`);
        return []; // No action needed
    }
}
```

## Test Results

The fix was validated with comprehensive tests:

### K3 Mode (35°C threshold)
- ✅ First execution: 6 actions generated (turns on all fans)
- ✅ Second execution: 0 actions generated (no cycling)

### K4 Mode (40°C threshold)
- ✅ First execution: 6 actions generated (turns on all fans)
- ✅ Second execution: 0 actions generated (no cycling)

### Rotation Mode with 6 fans
- ✅ Without device status: 6 actions generated (correctly turns on fans)
- ✅ With fans already on: 0 actions generated (no unnecessary cycling)

## Group Configuration Summary

| Mode | Fans Required | Groups Available | Supports Rotation | Behavior |
|------|---------------|------------------|-------------------|----------|
| K1   | 2 fans        | 3 groups         | ✅ Yes            | Rotates between groups |
| K2   | 4 fans        | 3 groups         | ✅ Yes            | Rotates between groups |
| K3   | 6 fans        | 1 group          | ❌ No             | **Fixed**: No rotation, stays on |
| K4   | 6 fans        | 1 group          | ❌ No             | **Fixed**: No rotation, stays on |

## Benefits of the Fix

1. **Eliminates 20-Second Cycling**: K3/K4 modes now operate consistently without unwanted on/off cycling
2. **Hardware Protection**: Reduces unnecessary fan switching, extending equipment lifespan
3. **Energy Efficiency**: Maintains consistent cooling when needed instead of cycling
4. **System Stability**: Provides predictable behavior across all temperature thresholds
5. **Backward Compatibility**: K1/K2 modes continue to work exactly as before

## Implementation Status

- ✅ **Code Changes**: Implemented in TypeScript source
- ✅ **Build**: Successfully compiled to JavaScript
- ✅ **Testing**: Comprehensive test suite validates the fix
- ✅ **Production Ready**: Ready for deployment

## Conclusion

The K3/K4 fan cycling issue has been completely resolved. The system now correctly identifies when only one fan group is available and avoids unnecessary rotation logic, ensuring stable operation for all temperature threshold modes while maintaining the existing functionality for K1/K2 modes that benefit from rotation.
