# Fan Group Transition Delay Implementation

## Overview

This document describes the implementation of a configurable delay mechanism for fan group switching in the VIIS Auto Microclimate Control Node. The solution addresses hardware-related problems caused by immediate fan group transitions by introducing a two-phase switching process with configurable delays.

## Problem Statement

The original fan group switching mechanism was switching between fan groups immediately without any delay, causing hardware-related problems. The instant switching between fan groups could overwhelm the hardware and cause operational issues.

## Solution

### Key Features

1. **Configurable Delays**: Two types of delays can be configured:
   - `set_fan_group_transition_delay`: Total transition delay (default: 2 seconds)
   - `set_fan_group_off_delay`: Delay after turning off fans before turning on new group (default: 1 second)

2. **Two-Phase Switching Process**:
   - **Phase 1 (OFF)**: Turn off the current fan group
   - **Phase 2 (DELAY)**: Wait for the configured off delay
   - **Phase 3 (ON)**: Turn on the new fan group
   - **Phase 4 (COMPLETE)**: Wait for the total transition delay before allowing new transitions

3. **State Management**: Comprehensive transition state tracking to handle ongoing transitions across multiple control cycles

4. **Non-Blocking Operation**: Other control operations (water pump, curtains) continue to work during fan transitions

## Implementation Details

### New Configuration Options

```typescript
interface AutoControlConfig {
    // Existing fan control options...
    set_fan_group_transition_delay?: number; // Total transition delay in seconds
    set_fan_group_off_delay?: number; // Delay after turning off fans (seconds)
}
```

### New Constants

```typescript
export const CONTROL_CONFIG = {
    // Existing constants...
    FAN_GROUP_TRANSITION_DELAY_MS: 2000, // 2 seconds default
    FAN_GROUP_OFF_DELAY_MS: 1000, // 1 second default
} as const;

export const CONTEXT_KEYS = {
    // Existing keys...
    FAN_GROUP_TRANSITION_STATE: "fanGroupTransitionState",
    FAN_GROUP_TRANSITION_TIMER: "fanGroupTransitionTimer",
} as const;
```

### New Interface

```typescript
interface FanGroupTransitionState {
    isTransitioning: boolean;
    phase: 'off' | 'delay' | 'on' | 'complete';
    previousGroup: string[];
    nextGroup: string[];
    transitionStartTime: number;
    offDelayStartTime: number;
    reason: string;
}
```

### Modified Fan Control Flow

1. **Check for Ongoing Transitions**: Before processing new fan control logic, check if a transition is in progress
2. **Process Transitions**: Handle ongoing transitions based on their current phase
3. **Initiate New Transitions**: When a group change is needed, initiate a new transition instead of immediate switching
4. **Group Comparison**: Smart comparison to determine if a transition is actually needed

### Key Methods Added

- `processFanGroupTransition()`: Handles ongoing transitions
- `initiateFanGroupTransition()`: Starts a new transition
- `requiresGroupTransition()`: Determines if a transition is needed
- `isTransitionInProgress()`: Checks if a transition is active
- `processRotationModeWithTransition()`: Rotation mode with transition support
- `processThresholdModeWithTransition()`: Threshold mode with transition support

## Usage Examples

### Configuration

```javascript
const config = {
    set_mode_fan: 1,
    set_auto_mode_fan: 1, // Rotation mode
    set_gr_alternate_fan: 2,
    set_time_alternate_fan: 15,
    set_fan_group_transition_delay: 3, // 3 seconds total transition time
    set_fan_group_off_delay: 1.5 // 1.5 seconds delay after turning off fans
};
```

### Transition Timeline Example

```
T+0ms:    [OFF] Turn off previous group [quat_1, quat_2]
T+0ms:    [DELAY] Start off delay timer
T+1500ms: [ON] Turn on next group [quat_3, quat_4]
T+1500ms: [COMPLETE] Start transition cooldown
T+3000ms: [READY] Transition complete, ready for next
```

## Benefits

1. **Hardware Protection**: Prevents hardware issues by introducing delays between fan group switches
2. **Configurable**: Delays can be adjusted based on hardware requirements
3. **Non-Blocking**: Other control operations continue during transitions
4. **Robust State Management**: Handles complex transition scenarios reliably
5. **Backward Compatible**: Works with existing rotation and threshold modes

## Testing

The implementation includes comprehensive tests:

- **Unit Tests**: Test individual transition logic components
- **Integration Tests**: Test complete fan control service with transitions
- **Configuration Tests**: Validate different delay configurations
- **State Management Tests**: Verify transition state handling

### Test Results

```
✓ Fan control service instantiated successfully
✓ Rotation mode with transition delay working
✓ Threshold mode with transition delay working
✓ Transition state management functional
✓ Configuration handling working
✓ Multiple processing cycles handled correctly
```

## Files Modified

1. **constants.ts**: Added new configuration constants and context keys
2. **interfaces/types.ts**: Added new configuration options and transition state interface
3. **services/fanControlService.ts**: Implemented transition logic and modified control flow
4. **Test files**: Created comprehensive tests for the new functionality

## Configuration Recommendations

- **Standard Hardware**: Use default values (2s transition, 1s off delay)
- **Sensitive Hardware**: Increase delays (5s transition, 2s off delay)
- **Fast Hardware**: Reduce delays (1s transition, 0.5s off delay)

## Conclusion

The fan group transition delay mechanism successfully addresses the hardware issues caused by immediate fan group switching. The implementation is robust, configurable, and maintains compatibility with existing functionality while providing the necessary protection for hardware components.
