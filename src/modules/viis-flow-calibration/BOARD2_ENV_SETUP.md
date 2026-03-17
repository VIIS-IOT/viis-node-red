# Board2 Modbus Register Mapping Configuration

## Problem
The current `MODBUS_BOARD2_HOLDING_REGISTERS` is empty, which prevents the `viis-flow-calibration` node from writing calibration values to the flow sensor board.

## Solution
Add the following holding register mappings for Board2 (Flow Sensor):

### Required Environment Variables

Add to your `.env` file (or device configuration):

```bash
# ========================================
# Board2 (Flow Sensor) - Port 503
# ========================================

# Holding Registers (Writable - for calibration)
# K-Factor: addresses 0-15 (pump 1-16)
# Flowrate: addresses 20-35 (pump 1-16)
MODBUS_BOARD2_HOLDING_REGISTERS={
  "HOLDING_K_FACTOR_BOM_1":0,
  "HOLDING_K_FACTOR_BOM_2":1,
  "HOLDING_K_FACTOR_BOM_3":2,
  "HOLDING_K_FACTOR_BOM_4":3,
  "HOLDING_K_FACTOR_BOM_5":4,
  "HOLDING_K_FACTOR_BOM_6":5,
  "HOLDING_K_FACTOR_BOM_7":6,
  "HOLDING_K_FACTOR_BOM_8":7,
  "HOLDING_K_FACTOR_BOM_9":8,
  "HOLDING_K_FACTOR_BOM_10":9,
  "HOLDING_K_FACTOR_BOM_11":10,
  "HOLDING_K_FACTOR_BOM_12":11,
  "HOLDING_K_FACTOR_BOM_13":12,
  "HOLDING_K_FACTOR_BOM_14":13,
  "HOLDING_K_FACTOR_BOM_15":14,
  "HOLDING_K_FACTOR_BOM_16":15,
  "HOLDING_FLOWRATE_BOM_1":20,
  "HOLDING_FLOWRATE_BOM_2":21,
  "HOLDING_FLOWRATE_BOM_3":22,
  "HOLDING_FLOWRATE_BOM_4":23,
  "HOLDING_FLOWRATE_BOM_5":24,
  "HOLDING_FLOWRATE_BOM_6":25,
  "HOLDING_FLOWRATE_BOM_7":26,
  "HOLDING_FLOWRATE_BOM_8":27,
  "HOLDING_FLOWRATE_BOM_9":28,
  "HOLDING_FLOWRATE_BOM_10":29,
  "HOLDING_FLOWRATE_BOM_11":30,
  "HOLDING_FLOWRATE_BOM_12":31,
  "HOLDING_FLOWRATE_BOM_13":32,
  "HOLDING_FLOWRATE_BOM_14":33,
  "HOLDING_FLOWRATE_BOM_15":34,
  "HOLDING_FLOWRATE_BOM_16":35
}

# Input Registers (Read-only - sensor data)
# Already configured, keeping for reference:
# Current Flow: addresses 0-15 (pump 1-16)
# Total Flow: addresses 20-35 (pump 1-16)
MODBUS_BOARD2_INPUT_REGISTERS={
  "INPUT_CURRENT_FLOW_BOM_1":0,
  "INPUT_CURRENT_FLOW_BOM_2":1,
  "INPUT_CURRENT_FLOW_BOM_3":2,
  "INPUT_CURRENT_FLOW_BOM_4":3,
  "INPUT_CURRENT_FLOW_BOM_5":4,
  "INPUT_CURRENT_FLOW_BOM_6":5,
  "INPUT_CURRENT_FLOW_BOM_7":6,
  "INPUT_CURRENT_FLOW_BOM_8":7,
  "INPUT_CURRENT_FLOW_BOM_9":8,
  "INPUT_CURRENT_FLOW_BOM_10":9,
  "INPUT_CURRENT_FLOW_BOM_11":10,
  "INPUT_CURRENT_FLOW_BOM_12":11,
  "INPUT_CURRENT_FLOW_BOM_13":12,
  "INPUT_CURRENT_FLOW_BOM_14":13,
  "INPUT_CURRENT_FLOW_BOM_15":14,
  "INPUT_CURRENT_FLOW_BOM_16":15,
  "INPUT_TOTAL_FLOW_BOM_1":20,
  "INPUT_TOTAL_FLOW_BOM_2":21,
  "INPUT_TOTAL_FLOW_BOM_3":22,
  "INPUT_TOTAL_FLOW_BOM_4":23,
  "INPUT_TOTAL_FLOW_BOM_5":24,
  "INPUT_TOTAL_FLOW_BOM_6":25,
  "INPUT_TOTAL_FLOW_BOM_7":26,
  "INPUT_TOTAL_FLOW_BOM_8":27,
  "INPUT_TOTAL_FLOW_BOM_9":28,
  "INPUT_TOTAL_FLOW_BOM_10":29,
  "INPUT_TOTAL_FLOW_BOM_11":30,
  "INPUT_TOTAL_FLOW_BOM_12":31,
  "INPUT_TOTAL_FLOW_BOM_13":32,
  "INPUT_TOTAL_FLOW_BOM_14":33,
  "INPUT_TOTAL_FLOW_BOM_15":34,
  "INPUT_TOTAL_FLOW_BOM_16":35
}

# Coils (Control and Status)
# Already configured, keeping for reference:
# Pump Status: 161-176 (pump 1-16)
# Reset Volume: 201-216 (pump 1-16)
MODBUS_BOARD2_COILS={
  "PUMP_STATUS_BOM_1": 161,
  "PUMP_STATUS_BOM_2": 162,
  "PUMP_STATUS_BOM_3": 163,
  "PUMP_STATUS_BOM_4": 164,
  "PUMP_STATUS_BOM_5": 165,
  "PUMP_STATUS_BOM_6": 166,
  "PUMP_STATUS_BOM_7": 167,
  "PUMP_STATUS_BOM_8": 168,
  "PUMP_STATUS_BOM_9": 169,
  "PUMP_STATUS_BOM_10": 170,
  "PUMP_STATUS_BOM_11": 171,
  "PUMP_STATUS_BOM_12": 172,
  "PUMP_STATUS_BOM_13": 173,
  "PUMP_STATUS_BOM_14": 174,
  "PUMP_STATUS_BOM_15": 175,
  "PUMP_STATUS_BOM_16": 176,
  "RESET_TOTAL_VOLUME_BOM_1": 201,
  "RESET_TOTAL_VOLUME_BOM_2": 202,
  "RESET_TOTAL_VOLUME_BOM_3": 203,
  "RESET_TOTAL_VOLUME_BOM_4": 204,
  "RESET_TOTAL_VOLUME_BOM_5": 205,
  "RESET_TOTAL_VOLUME_BOM_6": 206,
  "RESET_TOTAL_VOLUME_BOM_7": 207,
  "RESET_TOTAL_VOLUME_BOM_8": 208,
  "RESET_TOTAL_VOLUME_BOM_9": 209,
  "RESET_TOTAL_VOLUME_BOM_10": 210,
  "RESET_TOTAL_VOLUME_BOM_11": 211,
  "RESET_TOTAL_VOLUME_BOM_12": 212,
  "RESET_TOTAL_VOLUME_BOM_13": 213,
  "RESET_TOTAL_VOLUME_BOM_14": 214,
  "RESET_TOTAL_VOLUME_BOM_15": 215,
  "RESET_TOTAL_VOLUME_BOM_16": 216
}
```

## Register Address Reference

### Board2 (Flow Sensor - Arduino with Modbus TCP, Port 503)

| Register Type | Address Range | Pump Index | Description |
|--------------|---------------|------------|-------------|
| **Holding** (Write) | 0-15 | 1-16 | K-Factor (pulses/L) |
| **Holding** (Write) | 20-35 | 1-16 | Expected Flowrate (mL/s × 100) |
| **Input** (Read) | 0-15 | 1-16 | Current Flow Rate (mL/s) |
| **Input** (Read) | 20-35 | 1-16 | Total Volume (mL) |
| **Coil** (Status) | 161-176 | 1-16 | Pump Running Status |
| **Coil** (Control) | 201-216 | 1-16 | Reset Total Volume Counter |

## Verification Steps

After updating the environment:

1. **Restart Node-RED** to load new configuration:
   ```bash
   docker-compose restart nodered
   ```

2. **Verify registers are loaded**:
   - Open Node-RED Debug panel
   - Trigger a flow that reads `global.get("modbus_board2_holding_registers")`
   - Confirm all 32 registers (16 K-Factor + 16 Flowrate) are present

3. **Test calibration**:
   - Set `CALCULATE_CALIB_BOM_1 = true`
   - Set `CALIB_ACTUAL_ML_BOM_1 = 950`
   - Monitor debug output for calibration results
   - Verify both Board1 and Board2 values are updated

## Troubleshooting

### Issue: "Board2 Modbus client not available"
- Check that `MODBUS_BOARDS` includes board2 with correct port (503)
- Verify board2 device is online and responding to Modbus requests

### Issue: "Register HOLDING_K_FACTOR_BOM_1 not found in mapping"
- Confirm `MODBUS_BOARD2_HOLDING_REGISTERS` is properly formatted JSON
- Check for typos in register keys
- Restart Node-RED after env changes

### Issue: Calibration writes wrong address
- Verify address formula: K-Factor = pump_index - 1
- Example: Pump 1 → address 0, Pump 2 → address 1

## Notes

- All holding register values are **uint16** (0-65535)
- K-Factor typical range: 100-2000 pulses/L (YF-S401: ~450)
- Flowrate is stored **scaled by 100** (e.g., 10.5 mL/s = 1050)
- Calibration values are **scaled by 100** for precision
