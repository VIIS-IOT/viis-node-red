# K3/K4 Fan Control No Rotation Fix

## Problem Description

In VIIS fan control thermal mode at K3/K4 thresholds, the system was applying unnecessary group switching logic even when all 6 fans were already active. This caused:

- Unnecessary processing cycles
- Potential for unwanted fan state changes
- Inefficient operation when maximum cooling was already achieved

## Root Cause

The fan control logic was treating K3/K4 thresholds (which require all 6 fans) the same as K1/K2 thresholds (which support rotation between multiple groups). However:

- **K3/K4**: Require 6 fans, only 1 group available: `["quat_1", "quat_2", "quat_3", "quat_4", "quat_5", "quat_6"]`
- **K1/K2**: Require 2/4 fans, multiple groups available for rotation

## Solution Implemented

### 1. Added `supportsRotation()` Function

**File**: `src/modules/viis-auto-microclimate-control/utils/groupUtils.ts`

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

### 2. Updated FanControlService Logic

**File**: `src/modules/viis-auto-microclimate-control/services/fanControlService.ts`

#### Changes in `processThresholdMode()`:

```typescript
// Special logic for K3/K4 thresholds: disable group switching when all 6 fans should be active
if (currentActiveFanCount === requiredGroupSize && requiredGroupSize > 0) {
    // Check if this group size supports rotation (has multiple groups)
    if (!supportsRotation(requiredGroupSize)) {
        // Only one group available for this size (e.g., K3/K4 with 6 fans)
        // Use the single available group directly without rotation logic
        this.logger.debug(`K3/K4 mode: All ${requiredGroupSize} fans already active, skipping group transition logic`);
        return []; // No action needed
    } else {
        // Multiple groups available - continue with rotation logic
        // ... existing rotation logic for K1/K2
    }
}
```

#### Changes in target group selection:

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

### 3. Updated FanControlCore Logic

**File**: `src/modules/viis-auto-microclimate-control/services/fanControlCore.ts`

```typescript
// Special logic for K3/K4 thresholds: disable group switching when all 6 fans should be active
if (requiredGroupSize === 6 && currentActiveFans.length === 6) {
    logger.debug("K3/K4 mode: All 6 fans already active, skipping group transition logic");
    
    // Direct control to ensure all fans stay on
    const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
    const actions = createOptimizedFanGroupActions(targetGroup, true, reason, coilMapping, deviceStatusRecord);

    return {
        actions,
        targetGroup,
        requiredGroupSize,
        requiresTransition: false,
        reason
    };
}
```

### 4. Updated Transition Logic

**File**: `src/modules/viis-auto-microclimate-control/services/fanControlService.ts`

```typescript
// Special handling for K3/K4: disable transitions when all 6 fans should be active
if (requiredGroupSize === 6 && currentActiveFans.length === 6) {
    this.logger.debug(`K3/K4 mode: All 6 fans already active, skipping transition logic`);
    return createOptimizedFanGroupActions(targetGroup, true, reason, coilMapping, deviceStatusRecord);
}
```

## Test Results

### Test 1: supportsRotation() Function
- ✅ 1 fan groups: `true` (6 groups available)
- ✅ 2 fan groups: `true` (3 groups available)  
- ✅ 4 fan groups: `true` (3 groups available)
- ✅ 6 fan groups: `false` (1 group available)

### Test 2: K3/K4 Behavior
- ✅ K3 with 6 fans active: 0 actions (no rotation)
- ✅ K4 with 6 fans active: 0 actions (no rotation)
- ✅ K3 with 4 fans active: 2 actions (activate remaining fans)
- ✅ Multiple K3/K4 calls: No oscillation

### Test 3: K1/K2 Behavior (Unchanged)
- ✅ K2 threshold: Still supports rotation as before
- ✅ K1 threshold: Still supports rotation as before

## Group Configuration Summary

| Mode | Fans Required | Groups Available | Supports Rotation | Behavior |
|------|---------------|------------------|-------------------|----------|
| K1   | 2 fans        | 3 groups         | ✅ Yes            | Rotates between groups |
| K2   | 4 fans        | 3 groups         | ✅ Yes            | Rotates between groups |
| K3   | 6 fans        | 1 group          | ❌ No             | **Fixed**: No rotation, stays on |
| K4   | 6 fans        | 1 group          | ❌ No             | **Fixed**: No rotation, stays on |

## Benefits

1. **Eliminates Unnecessary Processing**: K3/K4 modes no longer waste cycles on rotation logic
2. **Hardware Protection**: Reduces unnecessary fan state changes
3. **Energy Efficiency**: Maintains consistent cooling when maximum cooling is needed
4. **System Stability**: Provides predictable behavior across all temperature thresholds
5. **Backward Compatibility**: K1/K2 modes continue to work exactly as before

## Implementation Status

- ✅ **Code Changes**: Implemented in TypeScript source
- ✅ **Build**: Successfully compiled to JavaScript  
- ✅ **Testing**: Comprehensive test suite validates the fix
- ✅ **Production Ready**: Ready for deployment

## Files Modified

1. `src/modules/viis-auto-microclimate-control/utils/groupUtils.ts`
2. `src/modules/viis-auto-microclimate-control/services/fanControlService.ts`
3. `src/modules/viis-auto-microclimate-control/services/fanControlCore.ts`

## Test Files Created

1. `src/modules/viis-auto-microclimate-control/test-k3-k4-no-rotation-fix.js`
2. `src/modules/viis-auto-microclimate-control/test-fancontrol-service-k3-k4-fix.js`
