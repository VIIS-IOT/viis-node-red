# VIIS Auto Microclimate Control Node

Automatic greenhouse control node for fans, water pump, and curtains.

This document is aligned with the current implementation in:
- viis-auto-microclimate-control.ts
- handlers/autoControlHandler.ts
- services/fanControlService.ts
- services/waterPumpControlService.ts
- services/curtainControlService.ts

## What This Node Controls

- Fan control (threshold mode and rotation mode)
- Fan dao alternating control
- Water pump humidity control with K4 override path
- Curtain control (luoi_1, luoi_2, luoi_3) with tolerance timers

## Runtime Inputs

The node reads these global context keys:

- configKeyValues
- holdingRegisterData
- coilRegisterData
- modbusCoils (optional mapping override)

## Fan Control

### Enable And Mode

- set_mode_fan: 0 = off, 1 = on
- set_auto_mode_fan: 1 = threshold mode, 2 = rotation mode

If mode value is not 2, the code falls back to threshold mode.

### Threshold Behavior (Current)

Required active fan count from temperature thresholds:

- temp >= K4: 6 fans
- temp >= K3: 6 fans
- temp >= K2: 2 fans (rotating group)
- temp >= K1: 1 fan (rotating group)
- below K1: 0 fan

Hysteresis is applied via CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS.

Notes:
- Humidity-driven fan threshold logic exists as optional code path in groupUtils but is disabled by default.
- Fan-group transition state machine is used when transition delays are enabled.

### Rotation Behavior

Rotation settings:

- set_gr_alternate_fan: supported values in code include 1, 2, 4, 5, 6
- set_time_alternate_fan: minutes

Rotation state is persisted in flow context.

### Transition Delays

Fan transitions can use two timing controls:

- set_fan_group_transition_delay (seconds)
- set_fan_group_off_delay (seconds)

Transition phases: off -> delay -> on -> complete.

## Fan Dao Control

- set_mode_fan_dao: 0 = off, 1 = on
- set_time_alternate_fan_dao: minutes

When enabled, fan dao coils are toggled on interval.

## Water Pump Control

Settings:

- set_mode_tuong_nuoc: 0 = off, 1 = on
- set_threshold_low_water_bump
- set_threshold_high_water_bump

Behavior:

- humidity <= low threshold: ON
- humidity >= high threshold: OFF
- otherwise: keep state

K4 override is handled before normal pump logic in the control cycle.

## Curtain Control

Settings per curtain:

- set_light_dai_luoi_X
- set_light_thu_luoi_X
- set_light_indoor_thu_luoi_X
- set_tolerance_light_luoi_X

Current code behavior in curtain service:

- dai when light_outdoor >= dai threshold
- thu when light_outdoor <= thu threshold

Indoor-light threshold is read from config but is not currently a standalone trigger condition in the decision branch.

Supported curtain IDs in logic:

- luoi_1
- luoi_2
- luoi_3

Each luoi uses two mutually exclusive coils: thu and dai.

## Node Commands (msg.payload.command)

Implemented commands:

- start
- stop
- execute
- status
- updateInterval

There is no emergencyStop command in current implementation.

## Polling And Cache

- pollingInterval default: 10000 ms
- minimum accepted update interval: 1000 ms
- sensor cache TTL: 15000 ms
- config cache TTL: 30000 ms
- hot-reload check interval: 30000 ms

## Multi-Board Support

The node auto-detects MODBUS_BOARDS and initializes ClientRegistry in multi-board mode.
If MODBUS_BOARDS is absent, it uses single-board Modbus config.

## Practical Config Example

```json
{
  "set_mode_fan": 1,
  "set_auto_mode_fan": 1,
  "set_k1_fan": 25,
  "set_k2_fan": 30,
  "set_k3_fan": 35,
  "set_k4_fan": 40,
  "set_gr_alternate_fan": 2,
  "set_time_alternate_fan": 15,
  "set_fan_group_transition_delay": 3,
  "set_fan_group_off_delay": 3,
  "set_mode_fan_dao": 1,
  "set_time_alternate_fan_dao": 5,
  "set_mode_tuong_nuoc": 1,
  "set_threshold_low_water_bump": 60,
  "set_threshold_high_water_bump": 80,
  "set_mode_luoi": 1,
  "set_light_dai_luoi_1": 50000,
  "set_light_thu_luoi_1": 30000,
  "set_light_indoor_thu_luoi_1": 15000,
  "set_tolerance_light_luoi_1": 5
}
```

## Maintenance Note

Historical bug-analysis and audit markdown files were moved to archive/ to keep this folder focused on current behavior docs.
