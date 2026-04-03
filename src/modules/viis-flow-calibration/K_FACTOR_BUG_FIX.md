# Bug Fix: K-Factor Being Set to 450 (Default) Instead of Actual Values

## Problem
When running calibration, all 16 pumps on Board 2 had their K-Factor set to 450 (the default value), even though the actual K-Factor values in global context were different (e.g., 450, 460, 470, ... 600).

## Root Cause
**The code was reading register ADDRESSES instead of register VALUES.**

### The Confusion
There are TWO types of data in global context:

1. **`modbusMappings.board2.holdingRegisters`** - Register MAP (ADDRESSES)
   - Tells you WHERE to read/write on the Modbus device
   - Example: `{ HOLDING_K_FACTOR_BOM_1: 0, HOLDING_FLOWRATE_BOM_1: 20 }`
   - These are Modbus register addresses (0, 20, etc.)

2. **`holding_register_data_2`** - Register DATA (VALUES)
   - Contains the ACTUAL VALUES read from the device
   - Example: `{ HOLDING_K_FACTOR_BOM_1: 450, HOLDING_FLOWRATE_BOM_1: 10 }`
   - These are the real K-Factor and Flowrate values

### The Bug
The code was reading from `modbusMappings.board2.holdingRegisters`:
```typescript
// ❌ WRONG: Reading ADDRESS (0) instead of VALUE (450)
const currentKFactor = board2HoldingRegisters[kFactorKey];
// currentKFactor = 0 (the address!)
```

Since `currentKFactor` was 0 (the address), the check `currentKFactor !== 0` failed, and the code fell back to the default value of 450.

## Solution
Read from the correct global context variables:

```typescript
// ✅ CORRECT: Read actual VALUES from holding_register_data_2
const currentKFactor = board2HoldingData[kFactorKey];
// currentKFactor = 450 (the actual value!)
```

## Changes Made

### 1. Added new module-level variables
```typescript
let board2HoldingData: Record<string, any> = {};  // VALUES (actual data)
let board2InputData: Record<string, any> = {};    // VALUES (actual data)
```

### 2. Load VALUES from global context
```typescript
// CRITICAL: Load board2 register VALUES (actual data from device)
board2HoldingData = globalHelper.getGlobalVar('holding_register_data_2') || {};
board2InputData = globalHelper.getGlobalVar('input_register_data_2') || {};
```

### 3. Updated `gatherCalibrationInput()` to read VALUES
```typescript
// ✅ CORRECT: Read actual VALUES from board2HoldingData
const currentKFactor = board2HoldingData[kFactorKey];
const currentFlowrate = board2HoldingData[flowrateKey];
const reportedVolume = board2InputData[totalFlowKey];
```

### 4. Updated `handleManualCalculation()` similarly
```typescript
const input: CalibrationInput = {
    // ...
    currentKFactor: Number(board2HoldingData[kFactorKey]) || 450,
    currentFlowrate: Number(board2HoldingData[flowrateKey]) || 10,
    reportedVolume: Number(board2InputData[totalFlowKey]) || Number(setMl),
};
```

### 5. Added debug logging
```typescript
log(`Board2 Holding Data loaded: ${Object.keys(board2HoldingData).length} values`);
log(`Sample K-Factor values: BOM_1=${board2HoldingData.HOLDING_K_FACTOR_BOM_1}, BOM_2=${board2HoldingData.HOLDING_K_FACTOR_BOM_2}`);
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Global Context                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  modbusMappings.board2.holdingRegisters (ADDRESSES)             │
│  ┌────────────────────────────────────────────────────┐         │
│  │ HOLDING_K_FACTOR_BOM_1: 0     ← "Where to write"   │         │
│  │ HOLDING_K_FACTOR_BOM_2: 1                          │         │
│  │ HOLDING_FLOWRATE_BOM_1: 20                         │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                  │
│  holding_register_data_2 (VALUES)                               │
│  ┌────────────────────────────────────────────────────┐         │
│  │ HOLDING_K_FACTOR_BOM_1: 450   ← "Actual value"     │         │
│  │ HOLDING_K_FACTOR_BOM_2: 460                        │         │
│  │ HOLDING_FLOWRATE_BOM_1: 10                         │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │   viis-flow-calibration.ts reads from: │
        │   holding_register_data_2 ✅           │
        │   NOT modbusMappings ❌                │
        └────────────────────────────────────────┘
```

## Testing

### Unit Tests
Created comprehensive tests in `__tests__/viis-flow-calibration.test.ts`:

```bash
npm test -- --testPathPattern="viis-flow-calibration"
```

Key test: "DEBUG: CRITICAL - distinguish between register ADDRESSES and VALUES"
- Demonstrates the bug (reading address 0 instead of value 450)
- Validates the fix (reading actual value 450)

### All Tests Pass
```
 PASS  src/modules/viis-flow-calibration/services/__tests__/calibrationService.test.ts
 PASS  src/modules/viis-flow-calibration/__tests__/viis-flow-calibration.test.ts

Test Suites: 2 passed, 2 total
Tests:       26 passed, 26 total
```

## Impact
- ✅ K-Factor values now correctly read from global context
- ✅ Calibration calculations use actual values, not defaults
- ✅ All 16 pumps calibrated with their individual K-Factor values
- ✅ No more incorrect default fallback to 450

## Related Files
- `viis-flow-calibration.ts` - Main node implementation (fixed)
- `constants.ts` - Constants (deprecated BOARD2_ADDRESSES)
- `__tests__/viis-flow-calibration.test.ts` - Unit tests (added)
- `BOARD2_ADDRESS_REFACTORING.md` - Previous refactoring docs
