# VIIS Auto Microclimate Control - Implementation Summary

Updated: 2026-04-18

This summary reflects the current code in this module and replaces older milestone-style progress notes.

## Current Architecture

- Entry point: viis-auto-microclimate-control.ts
- Main loop orchestrator: handlers/autoControlHandler.ts
- Core services:
	- services/configService.ts
	- services/sensorService.ts
	- services/modbusService.ts
	- services/fanControlService.ts
	- services/waterPumpControlService.ts
	- services/curtainControlService.ts
- Utility layer:
	- utils/groupUtils.ts
	- utils/timeUtils.ts
	- utils/logger.ts

Additional service files exist for extended/refactor paths (enhancedFanControlService.ts, fanControlCore.ts, stateManager.ts, synchronizationService.ts, migrationService.ts).

## Control Capabilities In Production Path

### Fan

- Threshold mode and rotation mode are implemented in fanControlService.
- Mode behavior:
	- set_auto_mode_fan = 2: rotation mode
	- otherwise: threshold mode
- Threshold fan counts currently implemented:
	- K1 => 1 fan
	- K2 => 2 fans
	- K3 => 6 fans
	- K4 => 6 fans
- Fan group transition delay state machine is implemented and used when transition delay config is enabled.

### Fan Dao

- Alternating on/off behavior by interval (set_time_alternate_fan_dao).
- Independent of main fan mode branch.

### Water Pump

- Humidity hysteresis control with low/high thresholds.
- K4 override check executes before normal water-pump rule in control cycle.

### Curtain

- luoi_1, luoi_2, luoi_3 control implemented.
- Each luoi uses dual coils with mutual exclusion (thu/dai).
- Outdoor light thresholds and tolerance timers drive action execution.

## Runtime Data And Context

Global context read:

- configKeyValues
- holdingRegisterData
- coilRegisterData
- modbusCoils

Flow context state:

- fan rotation state
- fan transition state
- curtain tolerance timers
- last control execution timestamp

## Multi-Board Support

- Auto-detects MODBUS_BOARDS.
- Initializes and reloads client configuration through ClientRegistry.
- Hot-reload check interval: 30 seconds.

## Timing Defaults

- Polling interval default: 10000 ms
- Sensor/device cache TTL: 15000 ms
- Config cache TTL: 30000 ms

## Known Documentation-Related Clarifications

- Node UI checkboxes enableFanControl/enableWaterPumpControl/enableCurtainControl are not wired into runtime control decisions.
- emergencyStop command is not implemented in node command handler.
- Indoor-light retract threshold keys are present in config but current curtain decision branch is primarily based on outdoor threshold checks.

## Recommended Source Of Truth

- README.md for operator-facing behavior
- LOGIC_DOCUMENTATION.md for developer logic details

Historical bug/audit markdown files are archived to keep the module root focused on current behavior.
