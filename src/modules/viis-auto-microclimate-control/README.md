# VIIS Auto Microclimate Control Node

Automatic microclimate control node for greenhouse automation, providing intelligent control of fans, water pumps, and curtains based on sensor data and configurable thresholds.

## Features

### 🌪️ Fan Control
- **Threshold Mode**: Automatic fan activation based on temperature/humidity thresholds (K1-K4)
- **Rotation Mode**: Fan groups rotate at specified intervals for even air distribution
- **Group Management**: Support for 2, 4, or 6 fan configurations with intelligent grouping
- **Priority System**: K4 threshold has highest priority for emergency cooling

### 💧 Water Pump Control
- **Humidity-based Control**: Automatic activation based on indoor humidity levels
- **Hysteresis Logic**: Prevents rapid on/off switching with configurable thresholds
- **K4 Priority Override**: Emergency activation when temperature ≥ K4 OR humidity < 75% (only in threshold mode)
- **Smart Thresholds**: Configurable low/high humidity thresholds

### 🌞 Curtain Control (Lưới)
- **Light-based Automation**: Automatic curtain control based on light intensity
- **Tolerance Timers**: Prevents rapid switching with configurable delay periods
- **Dual-coil Logic**: Special handling for curtain extend/retract operations
- **Multi-curtain Support**: Independent control for multiple curtain systems

### 🌡️ Fan Dao (Reverse Fan) Control
- **Alternating Mode**: Automatic on/off cycling for air circulation
- **Configurable Intervals**: Customizable timing for optimal air movement (default: 5 minutes)
- **Independent Operation**: Operates independently of main fan control logic

## Configuration

The node reads configuration from the global variable `configKeyValues` containing:

### Fan Control Settings
```javascript
{
  "set_mode_fan": 1,                        // Enable fan control (0=off, 1=on)
  "set_auto_mode_fan": 0,                   // Fan mode (0=threshold, 1=rotation)
  "set_k1_fan": 25,                         // K1 temperature threshold (°C)
  "set_k2_fan": 30,                         // K2 temperature threshold (°C)
  "set_k3_fan": 35,                         // K3 temperature threshold (°C)
  "set_k4_fan": 40,                         // K4 temperature threshold (°C)
  "set_gr_alternate_fan": 2,                // Group size for rotation (1, 2, 4, or 6)
  "set_time_alternate_fan": 15,             // Rotation interval (minutes) - used for both rotation mode and threshold mode
  "set_fan_group_transition_delay": 3,      // Delay between fan group transitions (seconds)
  "set_fan_group_off_delay": 3              // Delay after turning off fans before turning on new group (seconds)
}
```

### Fan Dao Control Settings
```javascript
{
  "set_mode_fan_dao": 1,                    // Enable fan dao control (0=off, 1=on)
  "set_time_alternate_fan_dao": 5           // Fan dao alternating interval (minutes, default: 5)
}
```

### Water Pump Settings
```javascript
{
  "set_mode_tuong_nuoc": 1,           // Enable water pump control
  "set_threshold_low_water_bump": 60,  // Low humidity threshold (%)
  "set_threshold_high_water_bump": 80  // High humidity threshold (%)
}
```

### Curtain Settings
```javascript
{
  "set_mode_luoi": 1,                      // Enable curtain control
  "set_light_dai_luoi_1": 50000,          // Outdoor light threshold for extending (lux)
  "set_light_thu_luoi_1": 30000,          // Outdoor light threshold for retracting (lux)
  "set_light_indoor_thu_luoi_1": 15000,   // Indoor light threshold for retracting (lux)
  "set_tolerance_light_luoi_1": 5,        // Tolerance time (minutes)
  "set_light_dai_luoi_2": 50000,          // Luoi 2 outdoor extend threshold
  "set_light_thu_luoi_2": 30000,          // Luoi 2 outdoor retract threshold
  "set_light_indoor_thu_luoi_2": 15000,   // Luoi 2 indoor retract threshold
  "set_tolerance_light_luoi_2": 5         // Luoi 2 tolerance time
}
```

#### Curtain Control Logic
The curtain control uses outdoor light sensors with tolerance timers:

- **Extend curtains (dai)**: When `light_outdoor >= dai_threshold` → Wait tolerance time → Extend curtain
- **Retract curtains (thu)**: When `light_outdoor <= thu_threshold` → Wait tolerance time → Retract curtain

**Note**: Indoor light sensor integration is available in the configuration but currently not actively used in the decision logic. The system primarily relies on outdoor light thresholds for curtain control.

## Input Data

The node reads sensor data from global variables:

### Sensor Data (`holdingRegisterData`)
```javascript
{
  "ts": 1748619947066,
  "temp_outdoor": 20.8,
  "temp_indoor": 23.5,
  "humi_indoor": 85,
  "humi_outdoor": 98.5,
  "light_indoor": 0,
  "light_outdoor": 0  // Used for curtain control
}
```

### Device Status (`coilRegisterData`)
```javascript
{
  "ts": 1748619623060,
  "quat_1": false,
  "quat_2": false,
  // ... other device states
  "bom_nuoc_1": true,
  "luoi_1_thu": false,
  "luoi_1_dai": true
}
```

## Control Logic

### Fan Control Priority System
The system uses **temperature-only thresholds** with hysteresis to prevent oscillation:

1. **K4 Threshold** (Highest): Temperature ≥ K4 → All 6 fans
2. **K3 Threshold**: Temperature ≥ K3 → All 6 fans
3. **K2 Threshold**: Temperature ≥ K2 → 4 fans (rotating)
4. **K1 Threshold**: Temperature ≥ K1 → 2 fans (rotating)

**Note**: Humidity-based fan control is currently **disabled** but can be re-enabled via configuration options.

### Water Pump Control Logic
- **Normal Operation**:
  - Turn ON when humidity ≤ low threshold (default: 60%)
  - Turn OFF when humidity ≥ high threshold (default: 80%)
  - Hysteresis prevents rapid switching between thresholds
- **K4 Priority Override** (only in threshold mode, when `set_auto_mode_fan = 0`):
  - Force water pump ON when temperature ≥ K4 threshold OR humidity < 75%
  - Overrides normal humidity-based control during extreme conditions

### Curtain Control Logic
- **Extend (Dải)**: Light ≥ extend threshold → Wait tolerance time → Extend curtain
- **Retract (Thu)**: Light ≤ retract threshold → Wait tolerance time → Retract curtain
- **Conflict Prevention**: Only one coil (thu or dai) can be active per curtain
- **Tolerance Timers**: Prevent rapid switching with configurable delay periods

### Fan Dao Control Logic
- **Alternating Mode**: Automatically toggles ON/OFF at configured intervals
- **Independent Operation**: Runs independently of main fan control logic
- **Default Interval**: 5 minutes (configurable via `set_time_alternate_fan_dao`)

### Special Features
- **Hysteresis Control**: Temperature thresholds include hysteresis (default: 1°C) to prevent oscillation
- **State Management**: Advanced state machine for fan control with transition management
- **Synchronization**: Thread-safe operations with locking mechanisms
- **Curtain Commands**: Each curtain uses 2 coils (thu/dai) with mutual exclusion
- **Fan Grouping**: Intelligent grouping based on configuration with rotation support
- **Error Recovery**: Retry logic with exponential backoff
- **Anti-oscillation**: Multiple mechanisms to prevent rapid switching

## Environment Variables

Required Modbus configuration:
```bash
MODBUS_TYPE=TCP
MODBUS_HOST=localhost
MODBUS_TCP_PORT=502
MODBUS_COILS='{"quat_1":0,"quat_2":1,...}'
MODBUS_HOLDING_REGISTERS='{"temp_indoor":0,...}'
```

## Usage

### Basic Setup
1. Configure environment variables for Modbus connection
2. Set up global variables `configKeyValues`, `holdingRegisterData`, `coilRegisterData`
3. Deploy the node and configure polling interval

### Input Commands
Send control commands via input messages:
```javascript
{
  "payload": {
    "command": "start|stop|execute|status|updateInterval|emergencyStop",
    "params": { "interval": 5000 },
    "updateConfig": true  // Force configuration cache refresh
  }
}
```

Available commands:
- **start**: Start the control loop
- **stop**: Stop the control loop
- **execute**: Execute one control cycle
- **status**: Get current system status
- **updateInterval**: Update polling interval
- **emergencyStop**: Force emergency stop (all fans off, reset state)

### Output
The node outputs control execution results:
```javascript
{
  "payload": {
    "timestamp": 1234567890,
    "success": true,
    "actionsExecuted": 3,
    "errors": 0,
    "sensorData": { "temp_indoor": 25.5, ... },
    "controlStatus": { "fanControlEnabled": true, ... },
    "actions": [
      { "device": "quat_1", "value": true, "reason": "K2 threshold" }
    ]
  }
}
```

## Architecture

The node follows a clean, modular architecture:

- **Services**:
  - ConfigService, SensorService, ModbusService
  - EnhancedFanControlService (with state machine), WaterPumpControlService, CurtainControlService
  - StateManager, SynchronizationService, MigrationService
- **Handlers**: AutoControlHandler (main orchestrator)
- **Utils**: Logger, TimeUtils, GroupUtils
- **Core Logic**: FanControlCore (centralized business logic)
- **Interfaces**: Comprehensive TypeScript interfaces for type safety

## Error Handling

- **Retry Logic**: Automatic retry for failed Modbus operations
- **Data Validation**: Comprehensive validation of sensor data and configuration
- **Graceful Degradation**: Continues operation even with partial sensor failures
- **Status Monitoring**: Real-time status updates and error reporting

## Performance

- **Configurable Polling**: Adjustable polling interval (default: 10 seconds)
- **Caching**: Intelligent caching of configuration and sensor data (TTL: 15 seconds)
- **Debouncing**: Prevents rapid successive operations
- **Resource Management**: Proper cleanup and resource management
- **Anti-oscillation**: Multiple mechanisms including hysteresis, minimum action intervals, and rate limiting

## Implementation Notes

### Current Status
- **Production Ready**: All core features implemented and tested
- **State Machine**: Advanced fan control with state management and transitions
- **Synchronization**: Thread-safe operations with comprehensive locking
- **Error Handling**: Robust error recovery and graceful degradation

### Feature Availability
- ✅ **Fan Control**: Full implementation with threshold and rotation modes
- ✅ **Water Pump Control**: Complete with K4 priority override
- ✅ **Curtain Control**: Full 2-coil logic with tolerance timers
- ✅ **Fan Dao Control**: Independent alternating mode operation
- ⚠️ **Humidity-based Fan Control**: Available but disabled by default
- ⚠️ **Indoor Light Curtain Logic**: Configured but not actively used

### Configuration Migration
The system includes automatic migration for configuration updates and maintains backward compatibility with existing setups.
