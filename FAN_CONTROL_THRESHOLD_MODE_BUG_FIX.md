# Fan Control Threshold Mode Bug Fix

## Problem Description

The temperature threshold mode in the fan control module had a critical bug where fan rotation was not working properly. While the automatic rotation mode worked correctly, the threshold mode would get stuck on one fan group and fail to rotate to other groups at the configured intervals.

## Root Cause Analysis

### Working Automatic Rotation Mode
- Uses context key: `"fanRotationState"`
- Simple rotation logic: checks time interval → rotates to next group → saves state
- Maintains consistent group size throughout operation

### Buggy Threshold Mode (Before Fix)
1. **Infinite Recursion**: The `getStableRotationTargetGroup` method always called `getRotationTargetGroup`, creating potential infinite loops
2. **Early Return Logic**: The system would return early if fan count matched required count, preventing rotation within the same group size
3. **State Management Issues**: When group size changed (K1→K2), rotation state was improperly reinitialized, losing rotation timing
4. **Context Key Confusion**: Used different context keys that caused state fragmentation

## Business Logic Requirements

### Temperature Thresholds
- **K1**: 2 fans (rotate between groups: [quat_1,quat_2], [quat_3,quat_4], [quat_5,quat_6])
- **K2**: 4 fans (rotate between groups: [quat_1,quat_2,quat_3,quat_4], [quat_5,quat_6,quat_1,quat_2])
- **K3/K4**: 6 fans (all fans active, no rotation needed)

### Expected Behavior
- At each threshold level, fans should rotate in groups at `set_time_alternate_fan` intervals (default: 15 minutes)
- When temperature changes threshold levels (e.g., K1→K2), the system should smoothly transition to the new group size while maintaining rotation timing
- Rotation should work identically to automatic rotation mode but with temperature-based group size determination

## Implemented Fixes

### 1. Fixed `getStableRotationTargetGroup` Method
**Before**: Infinite recursion calling `getRotationTargetGroup`
```javascript
// Buggy code that caused infinite recursion
return this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
```

**After**: Proper rotation logic implementation
```javascript
// Check if it's time to rotate using the same logic as automatic rotation mode
const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
const timeSinceLastRotation = getCurrentTimestamp() - rotationState.lastRotationTime;
const shouldRotate = hasTimeElapsed(rotationState.lastRotationTime, rotationInterval);

if (shouldRotate) {
    // Move to next group in sequence (same logic as automatic rotation mode)
    rotationState.currentGroupIndex = getNextGroupIndex(
        rotationState.currentGroupIndex,
        fanGroups.length
    );
    rotationState.lastRotationTime = getCurrentTimestamp();
    rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
    // Save updated state and log rotation
}
```

### 2. Improved Early Return Logic
**Before**: Prevented rotation when fan count matched
```javascript
if (currentActiveFanCount === requiredGroupSize) {
    return []; // This prevented rotation within same group size
}
```

**After**: Allow rotation within same group size
```javascript
if (currentActiveFanCount === requiredGroupSize && requiredGroupSize > 0) {
    // Check if we need to rotate within the same group size
    const fanGroups = this.getFanGroups(requiredGroupSize);
    if (fanGroups.length > 1) {
        // Multiple groups available - check if rotation is due
        const rotationState = this.flowContext.get(contextKey);
        const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
        
        if (rotationState && hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
            // Continue with rotation logic
        } else {
            return []; // No rotation due yet
        }
    }
}
```

### 3. Enhanced State Management for Group Size Transitions
**Before**: Lost rotation timing when group size changed
```javascript
if (rotationState.requiredGroupSize !== requiredGroupSize) {
    // Completely reinitialize, losing timing
    rotationState = { currentGroupIndex: 0, lastRotationTime: getCurrentTimestamp(), ... };
}
```

**After**: Preserve rotation timing during transitions
```javascript
if (rotationState.requiredGroupSize !== requiredGroupSize) {
    // Preserve rotation timing but update to new group size
    const newFanGroups = this.getFanGroups(requiredGroupSize);
    const newGroupIndex = Math.min(rotationState.currentGroupIndex, newFanGroups.length - 1);
    
    rotationState = {
        currentGroupIndex: newGroupIndex,
        lastRotationTime: rotationState.lastRotationTime, // Preserve timing!
        activeGroup: newFanGroups[newGroupIndex] || [],
        requiredGroupSize: requiredGroupSize
    };
}
```

### 4. Unified Context Key Management
**Before**: Multiple fragmented context keys
- `fanRotationState_threshold_1`
- `fanRotationState_threshold_2` 
- `fanRotationState_threshold_4`
- etc.

**After**: Single unified context key with migration
- `fanRotationState_threshold_mode` (unified key)
- Automatic migration from old keys to prevent state loss

## Testing Recommendations

### Manual Testing Steps
1. **Set up threshold mode** with K1=25°C, K2=30°C, set_time_alternate_fan=1 (for quick testing)
2. **Test K1 rotation**: Set temperature to 26°C, verify 2-fan groups rotate every minute
3. **Test K1→K2 transition**: Increase temperature to 31°C, verify smooth transition to 4-fan groups
4. **Test K2 rotation**: Verify 4-fan groups continue rotating at intervals
5. **Test K2→K1 transition**: Decrease temperature to 26°C, verify transition back to 2-fan groups

### Expected Log Output
```
🔄 Threshold rotation (size 2): [quat_1,quat_2] → [quat_3,quat_4]
Current group: 2/3 (interval: 1min)
🔄 Group size transition detected: 2 → 4
Updated rotation state for new group size 4: group 1/2 [quat_1,quat_2,quat_3,quat_4]
🔄 [STABLE] Threshold rotation (size 4): [quat_1,quat_2,quat_3,quat_4] → [quat_5,quat_6,quat_1,quat_2]
```

## Files Modified
- `src/modules/viis-auto-microclimate-control/services/fanControlService.ts`
- `dist/modules/viis-auto-microclimate-control/services/fanControlService.js` (compiled)

## Backward Compatibility
- All existing configurations continue to work
- Automatic migration from old context keys
- No breaking changes to the API
