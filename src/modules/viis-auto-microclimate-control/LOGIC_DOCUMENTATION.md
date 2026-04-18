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

- set_mode_fan: 0 off, 1 on
- set_auto_mode_fan: 2 rotation mode, otherwise threshold mode

### Threshold Mode

Required fan count is determined by getRecommendedGroupSize with hysteresis:

- >= k4 => 6
- >= k3 => 6
- >= k2 => 2
- >= k1 => 1
- below k1 => 0

When multiple groups exist for a required size, rotation state for threshold mode is persisted in flow context and rotated by set_time_alternate_fan interval.

### Rotation Mode

Uses set_gr_alternate_fan and set_time_alternate_fan.
Supported group sizes in utility code: 1, 2, 4, 5, 6.

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

- set_mode_fan_dao: enable/disable
- set_time_alternate_fan_dao: toggle interval (minutes)

Fan dao runs independently from main fan threshold/rotation path.

## Water Pump Logic

Source: services/waterPumpControlService.ts

Normal hysteresis behavior:

- humidity <= low threshold => ON
- humidity >= high threshold => OFF
- otherwise hold current state

K4 override check is executed before normal water pump logic inside autoControlHandler.

## Curtain Logic

Source: services/curtainControlService.ts

Curtains handled: luoi_1, luoi_2, luoi_3

Decision branch per curtain:

- light_outdoor >= dai threshold => target action dai
- else if light_outdoor <= thu threshold => target action thu

Tolerance timer is required before action execution.

Each curtain action writes two coils with mutual exclusion:

- dai: thu OFF, dai ON
- thu: dai OFF, thu ON

Indoor light thresholds are read from config and passed through function parameters, but current branch condition is dominated by outdoor light checks.

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

*Last updated: 2026-04-09*
