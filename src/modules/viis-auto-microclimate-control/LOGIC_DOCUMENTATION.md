# VIIS Auto Microclimate Control Node - Logic Documentation

This document describes the current runtime logic based on the actual TypeScript source.

## Node Runtime Model

Main orchestrator: handlers/autoControlHandler.ts

Execution order in each cycle:

1. Read config via ConfigService
2. Read sensor/device state via SensorService
3. Process water pump (K4 override check first)
4. Process fan control
5. Process curtain control
6. Execute merged Modbus actions

Control loop starts immediately, then runs on interval.

## Node Configuration (Editor)

UI properties:

- name
- pollingInterval (default 10000, min 1000)
- enableFanControl
- enableWaterPumpControl
- enableCurtainControl

Important: the three enable* checkboxes are UI-only and are not used by service logic.
Actual enable/disable comes from configKeyValues (set_mode_* keys).

## Global Context Keys Used

- configKeyValues
- holdingRegisterData
- coilRegisterData
- modbusCoils
- modbusHoldingRegisters

Flow context keys include fan rotation state, transition state, curtain tolerance timers, and last execution timestamp.

## Fan Control Logic

Source: services/fanControlService.ts, utils/groupUtils.ts

Enable and mode:

- set_mode_fan: 0 manual/off, 1 auto/on
- set_auto_mode_fan: 0 threshold mode (theo nhiệt độ), 1 rotation mode (luân phiên)

### Threshold Mode

Required fan count is determined by getRecommendedGroupSize with hysteresis (0.5°C):

- >= k4 => 6 fans
- >= k3 => 4 fans
- >= k2 => 3 fans
- >= k1 => 2 fans
- below k1 => 0

Fan grouping (6-fan symmetric topology):

- 2 fans: (1,4), (2,5), (3,6) — symmetric pairs
- 3 fans: (1,3,5), (2,4,6) — interleaved triples
- 4 fans: (1,2,4,5), (2,3,5,6), (1,3,4,6) — balanced combos
- 6 fans: all

When multiple groups exist for a required size, rotation state for threshold mode is persisted in flow context and rotated by set_time_alternate_fan interval.

### Rotation Mode

Uses set_gr_alternate_fan and set_time_alternate_fan.
Supported group sizes: 1, 2, 3, 4, 5, 6.

### Fan Transition Delay

When transition delays are enabled, group changes use a phased state machine:

- OFF: switch off all fans
- DELAY: wait set_fan_group_off_delay
- ON: turn on target group
- COMPLETE

Transition config keys:

- set_fan_group_transition_delay
- set_fan_group_off_delay

## Fan Dao Logic

Source: services/fanControlService.ts

Enable and mode:

- set_mode_fan_dao: 0 off, 1 on
- set_auto_mode_fan_dao: 1 Synchronization (Đồng bộ), 2 Scrolling (Cuốn chiếu)

Config keys:

- set_time_fan_dao_on: runtime in minutes (default 5)
- set_time_fan_dao_off: rest time in minutes (default 30)
- set_time_alternate_fan_dao: legacy toggle interval (fallback for time_on)

Fan dao runs independently from main fan threshold/rotation path.

### Synchronization Mode (autoMode=1)

All 3 fan dao (quat_dao_1, quat_dao_2, quat_dao_3) turn ON together for T_on, then OFF together for T_off. Cycle repeats.

### Scrolling Mode (autoMode=2)

Sequential operation: at any time at most 1 fan dao is active.

Each fan runs for T_on, then rests for at least T_off. When current fan finishes T_on:
1. Turn off current fan, record its stop time
2. Search for next fan (in order Q1→Q2→Q3→Q1) whose `lastStopTime + T_off <= now`
3. If found → turn it on immediately
4. If not found → **gap** (no fan runs), wait for next polling cycle

With 3 fixed fans:
- If T_off <= 2×T_on → always 1 fan running (no gaps)
- If T_off > 2×T_on → intentional gaps where no fan runs (e.g. T_on=5, T_off=30 → 20 min gap)

Config keys:
- `set_time_fan_dao_on`: T_on in minutes (how long each fan runs)
- `set_time_fan_dao_off`: T_off in minutes (minimum rest per fan)

T_on and T_off are independent parameters. T_off controls per-fan rest duration, not system-level cycle time.

## Water Pump Logic

Source: services/waterPumpControlService.ts

Normal hysteresis behavior:

- humidity <= low threshold => ON
- humidity >= high threshold => OFF
- otherwise hold current state

K4 override check is executed before normal water pump logic inside autoControlHandler.

K4 override activates when:

- temp_indoor >= k4 threshold
- set_mode_fan = 1 (fan control enabled)
- set_auto_mode_fan != 1 (threshold mode, not rotation)

K4 override turns on water pump regardless of humidity. No humidity condition is checked for K4.

## Curtain Logic

Source: services/curtainControlService.ts

Curtains handled: luoi_1, luoi_2, luoi_3, luoi_4

Each curtain has independent light thresholds:

- set_light_dai_luoi_N: outdoor light threshold to extend (default 50000 lux)
- set_light_thu_luoi_N: outdoor light threshold to retract (default 30000 lux)
- set_light_indoor_thu_luoi_N: indoor light threshold (passed through, outdoor dominates)
- set_tolerance_light_luoi_N: tolerance timer in minutes (default 5)

Decision branch per curtain:

- light_outdoor >= dai threshold => target action dai
- else if light_outdoor <= thu threshold => target action thu

Tolerance timer is required before action execution. Timer resets if condition changes during waiting period.

Each curtain action writes two coils with mutual exclusion:

- dai: thu OFF, dai ON
- thu: dai OFF, thu ON

Coil mapping (addresses are device-specific, configured in constants.ts):

- luoi_1: thu=16, dai=17
- luoi_2: thu=12, dai=13
- luoi_3: thu=placeholder, dai=placeholder
- luoi_4: thu=placeholder, dai=placeholder

COIL_PAIRS defines conflict prevention pairs to ensure mutual exclusion per curtain.

## Input Commands

Supported payload.command values:

- start
- stop
- execute
- status
- updateInterval

Unsupported command examples in old docs (such as emergencyStop) are not present in current switch-case.

## Multi-Board And Hot Reload

Source: viis-auto-microclimate-control.ts

- Detects MODBUS_BOARDS for multi-board mode
- Initializes ClientRegistry with default board
- Polls configuration every 30 seconds for hot-reload
- Reloads Modbus client when board list or connection config changes

## Timing And Cache

- default polling interval: 10000 ms
- sensor/device cache TTL: 15000 ms
- config cache TTL: 30000 ms
- hot-reload check: 30000 ms

## Notes For Maintainers

- Keep this document aligned with fanControlService threshold mapping and mode values.
- If set_auto_mode_fan semantics change, update this doc and README together.
- If indoor-light curtain trigger is re-enabled, update the curtain section accordingly.

- Set low/high thresholds with 10-20% gap to prevent rapid cycling
- Example: Low=60%, High=80%

### 3. Curtain Tolerance

- Use 5-15 minute tolerance to handle cloud cover fluctuations
- Higher tolerance = more stable but slower response

### 4. Polling Interval

- Shorter intervals = faster response but more Modbus traffic
- Longer intervals = more stable but slower response
- Recommended: 10-15 seconds for most applications

---

## Example Flow

```json
[
    {
        "id": "798a8e7d096714a6",
        "type": "viis-auto-microclimate-control",
        "z": "547ba825d69085e6",
        "name": "Greenhouse Auto Control",
        "pollingInterval": 10000,
        "enableFanControl": true,
        "enableWaterPumpControl": true,
        "enableCurtainControl": true,
        "x": 290,
        "y": 720,
        "wires": [
            [
                "804a567bc109bcfa"
            ]
        ]
    },
    {
        "id": "804a567bc109bcfa",
        "type": "debug",
        "z": "547ba825d69085e6",
        "name": "Control Output",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "payload",
        "x": 520,
        "y": 720,
        "wires": []
    }
]
```

---

## Testing & Debugging

### Enable Debug Logging

The node uses internal logging. Check Node-RED debug panel for:
- `[AUTO-CONTROL-INIT]` - Initialization messages
- `[HOT-RELOAD]` - Configuration change messages
- `[CLEANUP]` - Shutdown messages

### Manual Control Cycle

Send this message to trigger immediate execution:

```javascript
{
    "payload": {
        "command": "execute"
    }
}
```

### Check Status

```javascript
{
    "payload": {
        "command": "status"
    }
}
```

---

## Related Documentation

- [Multi-Board Support Guide](../../../docs/multi-board-support/README.md)
- [Modbus RTU Setup Guide](../../../docs/MODBUS_RTU_SETUP_GUIDE.md)
- [Error & Warning Management Architecture](../docs/ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)

---

## Version Information

- **Module Path**: `services/nodered/custom-nodes/viis-node-red/src/modules/viis-auto-microclimate-control/`
- **Node Type**: `viis-auto-microclimate-control`
- **Category**: VIIS
- **Color**: `#BBD8A3` (Light Green)

---

*Last updated: 2026-06-04*
