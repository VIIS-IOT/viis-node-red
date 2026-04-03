# Archived Documentation

**Archived Date**: 2025-01-28  
**Reason**: Outdated - Pre-TFS Implementation

## Why These Files Were Archived

These documentation files describe the **OLD flow-rate based accumulation logic** which has been replaced by the **TFS delta-based system**.

### Major Changes (Old → New)

| Aspect | Old Logic | New Logic |
|--------|-----------|-----------|
| **Data Source** | Flow rate sensors (fs01-fs06) | Total Flow Sensors (tfs01-tfs06) |
| **Calculation** | `accumulated = avg_flow * time` | `accumulated = last_tfs - first_tfs` |
| **Reset Detection** | Not implemented | Delta < 0 triggers reset |
| **Precision** | Variable | 3 decimal places (modulo 1000) |

### Archived Files

1. **MARINE_IOT_README.md**
   - Old documentation index
   - Referenced flow-rate logic

2. **MARINE_IOT_SUMMARY.md**
   - Summary of old implementation
   - Multi-machine support (still valid architecture)

3. **MARINE_IOT_OVERVIEW.md**
   - Complete overview of old system
   - Flow rate accumulation methods

4. **MARINE_IOT_SYSTEM_ANALYSIS.md**
   - Analysis of old implementation
   - Profile management (still valid)

5. **MARINE_IOT_TESTING.md**
   - Testing guide for old logic
   - Flow rate test scenarios

6. **MARINE_IOT_USAGE_GUIDE.md**
   - Usage guide for old system
   - Flow rate calculations

## Current Documentation

For current TFS-based system, see:
- [TFS Testing Guide](../TFS_TESTING_GUIDE.md)
- [TFS Test Summary](../TFS_TEST_SUMMARY.md)
- [TFS Formula Fix](../TFS_FORMULA_FIX.md)
- [Integration Test Results](../INTEGRATION_TEST_RESULTS.md)

## Still Valid Information

Some concepts from archived docs are still relevant:
- **Multi-machine architecture** (Generator, Main Engine, Boiler)
- **Oil profile management** (independent profiles per machine)
- **Density-based conversion** (m³ → tons using kg/m³)
- **Database schema** (tables structure unchanged)

These concepts are now documented in:
- [Multi-Machine Implementation](../MARINE_IOT_MULTI_MACHINE_IMPLEMENTATION.md)
- [kg/m³ Standard](../MARINE_IOT_KG_M3_STANDARD.md)

## Timeline

- **Before 2025-01-28**: Flow rate based system
- **2025-01-28**: Migrated to TFS delta-based system
- **Test Results**: 51/51 tests passing with new implementation

## Reference

These files are kept for historical reference and migration understanding. Do not use for implementation guidance.
