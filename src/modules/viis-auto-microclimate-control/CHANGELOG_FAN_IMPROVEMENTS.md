# Fan Control Improvements Changelog

## Version: Latest Updates

### 🎯 Major Improvements

#### 1. **Added Support for 1-Fan Groups**
- **Added**: `ONE_FAN` group configuration in `constants.ts`
- **Updated**: `getFanGroups()` function to support group size = 1
- **Updated**: `isValidFanGroupSize()` to accept [1, 2, 4, 6] instead of [2, 4, 6]
- **Impact**: Now supports all group sizes: 1, 2, 4, 6 fans

**New Group Configuration:**
```typescript
ONE_FAN: [
    ["quat_1"],
    ["quat_2"],
    ["quat_3"],
    ["quat_4"],
    ["quat_5"],
    ["quat_6"]
]
```

#### 2. **Unified Rotation Timing Configuration**
- **Fixed**: Threshold mode now uses `set_time_alternate_fan` instead of hard-coded 15 minutes
- **Updated**: `getRotationTargetGroup()` method signature to accept `config` parameter
- **Improved**: Consistent timing behavior between rotation mode and threshold mode
- **Enhanced**: Better logging with actual interval values

**Before:**
```typescript
// Hard-coded 15 minutes in threshold mode
const rotationInterval = minutesToMs(15);
```

**After:**
```typescript
// Uses same configuration as rotation mode
const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
```

### 📝 Configuration Changes

#### Updated Configuration Options:
- `set_gr_alternate_fan`: Now accepts **1, 2, 4, or 6** (previously 2, 4, 6)
- `set_time_alternate_fan`: Now used for **both rotation mode AND threshold mode** (previously only rotation mode)

#### Example Configuration:
```javascript
{
  "set_mode_fan": 1,              // Enable fan control
  "set_auto_mode_fan": 0,         // 0=threshold, 1=rotation
  "set_gr_alternate_fan": 1,      // NEW: Can now use 1 fan groups
  "set_time_alternate_fan": 10,   // IMPROVED: Used for both modes
  "set_k1_fan": 25,
  "set_k2_fan": 30,
  "set_k3_fan": 35,
  "set_k4_fan": 40
}
```

### 🔧 Technical Changes

#### Files Modified:
1. **`constants.ts`**
   - Added `ONE_FAN` group configuration
   
2. **`utils/groupUtils.ts`**
   - Updated `getFanGroups()` to handle group size = 1
   - Updated `isValidFanGroupSize()` validation
   
3. **`services/fanControlService.ts`**
   - Modified `getRotationTargetGroup()` to accept config parameter
   - Updated method call in `processThresholdMode()`
   - Improved logging with actual interval values
   
4. **Documentation Files**
   - Updated `README.md`
   - Updated `viis-auto-microclimate-control.html`
   - Updated `FAN_CONTROL_IMPROVEMENTS.md`

#### Test Files:
- **Updated**: `test-rotation-mode.js` to include 1-fan group testing
- **Added**: `test-threshold-rotation-timing.js` to verify timing consistency

### 🎯 Behavior Changes

#### Rotation Mode:
- **No change**: Still uses `set_time_alternate_fan` as before
- **Enhanced**: Now supports 1-fan groups

#### Threshold Mode:
- **K1/K2 Thresholds**: Now uses `set_time_alternate_fan` for rotation timing (was hard-coded 15 min)
- **K3/K4 Thresholds**: No change (still uses all 6 fans, no rotation)
- **Enhanced**: Now supports 1-fan groups for K1 threshold

### 📊 Impact Summary

| Feature | Before | After |
|---------|--------|-------|
| **Group Sizes** | 2, 4, 6 | **1, 2, 4, 6** |
| **Rotation Mode Timing** | `set_time_alternate_fan` | `set_time_alternate_fan` (no change) |
| **Threshold Mode Timing** | Hard-coded 15 min | **`set_time_alternate_fan`** |
| **Configuration Consistency** | ❌ Different timing sources | ✅ **Unified timing configuration** |

### ✅ Benefits

1. **More Granular Control**: 1-fan groups allow for minimal power consumption scenarios
2. **Consistent Configuration**: Single parameter controls timing for both modes
3. **Better Flexibility**: Users can configure rotation timing for all scenarios
4. **Improved Maintainability**: Reduced hard-coded values
5. **Enhanced Logging**: Better visibility into actual timing configurations

### 🧪 Testing

- **Unit Tests**: Updated existing rotation tests
- **Integration Tests**: Added threshold timing verification
- **Backward Compatibility**: All existing configurations continue to work
- **Default Behavior**: 15-minute default maintained when not configured

### 📋 Migration Notes

**For Existing Users:**
- **No breaking changes**: Existing configurations continue to work
- **New capability**: Can now set `set_gr_alternate_fan: 1` for single-fan rotation
- **Improved behavior**: Threshold mode now respects `set_time_alternate_fan` setting

**For New Users:**
- Use `set_gr_alternate_fan` values: 1, 2, 4, or 6
- `set_time_alternate_fan` controls timing for both rotation and threshold modes
- Default timing remains 15 minutes if not specified
