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
- **K4 Priority Override**: Emergency activation during extreme conditions
- **Smart Thresholds**: Configurable low/high humidity thresholds

### 🌞 Curtain Control (Lưới)
- **Light-based Automation**: Automatic curtain control based on light intensity
- **Tolerance Timers**: Prevents rapid switching with configurable delay periods
- **Dual-coil Logic**: Special handling for curtain extend/retract operations
- **Multi-curtain Support**: Independent control for multiple curtain systems

### 🌡️ Fan Dao (Reverse Fan) Control
- **Alternating Mode**: Automatic on/off cycling for air circulation
- **Configurable Intervals**: Customizable timing for optimal air movement

## Configuration

The node reads configuration from the global variable `configKeyValues` containing:

### Fan Control Settings
```javascript
{
  "set_mode_fan": 1,              // Enable fan control (0=off, 1=on)
  "set_auto_mode_fan": 0,         // Fan mode (0=threshold, 1=rotation)
  "set_k1_fan": 25,               // K1 temperature threshold (°C)
  "set_k2_fan": 30,               // K2 temperature threshold (°C)
  "set_k3_fan": 35,               // K3 temperature threshold (°C)
  "set_k4_fan": 40,               // K4 temperature threshold (°C)
  "set_gr_alternate_fan": 2,      // Group size for rotation (1, 2, 4, or 6)
  "set_time_alternate_fan": 15    // Rotation interval (minutes) - used for both rotation mode and threshold mode
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
The curtain control now uses both outdoor and indoor light sensors for better automation:

- **Extend curtains (dai)**: When `light_outdoor >= dai_threshold`
- **Retract curtains (thu)**: When either:
  - `light_outdoor <= thu_threshold` (original logic), OR
  - `light_indoor <= indoor_thu_threshold` (new logic - prevents over-darkening)

This dual-sensor approach solves the problem where curtains would stay closed even when indoor light becomes too low, because outdoor light doesn't change when curtains are closed.

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
1. **K4 Threshold** (Highest): Temperature ≥ K4 OR humidity < 75% → All 6 fans + water pump
2. **K3 Threshold**: Temperature ≥ K3 OR humidity < 55% → All 6 fans
3. **K2 Threshold**: Temperature ≥ K2 OR humidity < 65% → 4 fans (rotating)
4. **K1 Threshold**: Temperature ≥ K1 → 2 fans (rotating)

### Curtain Control Logic
- **Extend (Dải)**: Light ≥ extend threshold → Wait tolerance time → Extend curtain
- **Retract (Thu)**: Light ≤ retract threshold → Wait tolerance time → Retract curtain
- **Conflict Prevention**: Only one coil (thu or dai) can be active per curtain

### Special Modbus Handling
- **Curtain Commands**: Each curtain uses 2 coils (thu/dai) with mutual exclusion
- **Fan Grouping**: Intelligent grouping based on configuration
- **Error Recovery**: Retry logic with exponential backoff

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
    "command": "start|stop|execute|status|updateInterval",
    "params": { "interval": 5000 }
  }
}
```

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

- **Services**: ConfigService, SensorService, ModbusService, FanControlService, WaterPumpControlService, CurtainControlService
- **Handlers**: AutoControlHandler (main orchestrator)
- **Utils**: Logger, TimeUtils, GroupUtils
- **Interfaces**: Comprehensive TypeScript interfaces for type safety

## Error Handling

- **Retry Logic**: Automatic retry for failed Modbus operations
- **Data Validation**: Comprehensive validation of sensor data and configuration
- **Graceful Degradation**: Continues operation even with partial sensor failures
- **Status Monitoring**: Real-time status updates and error reporting

## Performance

- **Configurable Polling**: Adjustable polling interval (default: 10 seconds)
- **Caching**: Intelligent caching of configuration and sensor data
- **Debouncing**: Prevents rapid successive operations
- **Resource Management**: Proper cleanup and resource management
