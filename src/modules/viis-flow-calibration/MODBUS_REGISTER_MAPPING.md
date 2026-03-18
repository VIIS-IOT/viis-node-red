# 📋 Modbus Register Mapping Documentation

## Overview

This document describes the Modbus register mappings for the **VIIS Fertigation System** with two control boards:

- **Board1** (`192.168.110.77`): Pump Control & Dosing System
- **Board2** (`192.168.110.98`): Flow Sensor & Measurement System

---

## Board1 - Pump Control Board

**IP Address:** `192.168.110.77`  
**Modbus TCP Port:** `502`  
**Unit ID:** `1`

### Holding Registers (Function Code 03/06)

| Address | Key | Name | Description | Unit | Scale | Range |
|:-------:|-----|------|-------------|------|-------|-------|
| 1-16 | `HOLDING_SETML_BOM_1` → `HOLDING_SETML_BOM_16` | Set Volume Pump 1-16 | Target volume to dispense for each pump | ml | ×1 | 0-65535 |
| 17-32 | `HOLDING_CALIB_BOM_1` → `HOLDING_CALIB_BOM_16` | Calibration Coefficient Pump 1-16 | Pump flow rate calibration (ml/s × 100) | ml/s | ×100 | 0-65535 |
| 33 | `HOLDING_CALIB_FLOW_NUOC_VAO` | Inlet Flow Calibration | Calibration coefficient for inlet flow sensor | - | ×1 | 0-65535 |
| 34 | `HOLDING_LUU_LUONG_DOSING_TOI_DA` | Max Dosing Flow Rate | Maximum allowed dosing flow rate | ml/s | ×1 | 0-65535 |
| 35 | `HOLDING_THOI_GIAN_BAT_VAN_NUOC_VAO_TOI_DA` | Max Inlet Valve Time | Maximum time for inlet valve activation | seconds | ×1 | 0-65535 |
| 36 | `HOLDING_THOI_GIAN_TRON_TOI_DA` | Max Mixing Time | Maximum mixing duration | seconds | ×1 | 0-65535 |
| 37 | `HOLDING_THOI_GIAN_KHUAY_TOI_DA` | Max Stirring Time | Maximum stirring duration | seconds | ×1 | 0-65535 |
| 38 | `HOLDING_NHIET_DO_HEAT_TOI_DA` | Max Heating Temperature | Maximum heating temperature | °C | ×1 | 0-65535 |
| 39 | `HOLDING_THOI_GIAN_HEAT_TOI_DA` | Max Heating Time | Maximum heating duration | seconds | ×1 | 0-65535 |
| 40 | `HOLDING_THOI_GIAN_BAT_VAN_BON_CHIA_NUOC_TOI_DA` | Max Water Division Valve Time | Maximum time for water division valve | seconds | ×1 | 0-65535 |
| 41 | `HOLDING_EC_TOI_THIEU` | Minimum EC | Minimum EC threshold | μS/cm | ×1 | 0-65535 |
| 42 | `HOLDING_EC_TOI_DA` | Maximum EC | Maximum EC threshold | μS/cm | ×1 | 0-65535 |
| 43 | `HOLDING_PH_TOI_THIEU` | Minimum pH | Minimum pH threshold | pH | ×10 | 0-140 |
| 44 | `HOLDING_PH_TOI_DA` | Maximum pH | Maximum pH threshold | pH | ×10 | 0-140 |
| 45-48 | `HOLDING_DU_PHONG_2` → `HOLDING_DU_PHONG_5` | Reserved | Reserved for future use | - | - | - |
| 49 | `HOLDING_AUTO_THOI_GIAN_TRON` | Auto Mixing Time | Automatic mixing duration | seconds | ×1 | 0-65535 |
| 50 | `HOLDING_AUTO_LUU_LUONG_CHIA_NUOC` | Auto Water Division Flow | Automatic water division flow rate | ml/s | ×1 | 0-65535 |
| 51 | `HOLDING_AUTO_THOI_GIAN_KHUAY` | Auto Stirring Time | Automatic stirring duration | seconds | ×1 | 0-65535 |
| 52 | `HOLDING_AUTO_THOI_GIAN_GIA_NHIET` | Auto Heating Time | Automatic heating duration | seconds | ×1 | 0-65535 |
| 53 | `HOLDING_AUTO_NHIET_DO` | Auto Temperature | Automatic temperature setting | °C | ×1 | 0-65535 |
| 54 | `HOLDING_AUTO_LUU_LUONG_CHIET_ROT` | Auto Dispensing Flow | Automatic dispensing flow rate | ml/s | ×1 | 0-65535 |
| 55 | `HOLDING_AUTO_SO_LAN_CHIET_ROT` | Auto Dispensing Cycles | Number of dispensing cycles | cycles | ×1 | 0-65535 |

### Input Registers (Function Code 04)

| Address | Key | Name | Description | Unit | Scale | Range |
|:-------:|-----|------|-------------|------|-------|-------|
| 1 | `INPUT_EC` | EC Value | Electrical Conductivity reading | μS/cm | ×1 | 0-65535 |
| 2 | `INPUT_PH` | pH Value | pH reading | pH | ×10 | 0-140 |
| 3 | `INPUT_TEMP_BON_TRON` | Mixing Tank Temperature | Temperature in mixing tank | °C | ×1 | 0-65535 |
| 4 | `INPUT_TEMP_BON_KHUAY` | Stirring Tank Temperature | Temperature in stirring tank | °C | ×1 | 0-65535 |
| 5 | `INPUT_FLOW_NUOC_VAO` | Inlet Flow | Inlet water flow rate | ml/s | ×10 | 0-65535 |
| 6 | `INPUT_FLOW_NUOC_TRON` | Mixing Flow | Mixing water flow rate | ml/s | ×10 | 0-65535 |
| 7 | `INPUT_FLOW_CHIA_NUOC` | Water Division Flow | Water division flow rate | ml/s | ×10 | 0-65535 |
| 8 | `INPUT_FLOW_CHIET_ROT` | Dispensing Flow | Dispensing flow rate | ml/s | ×10 | 0-65535 |

### Coils (Function Code 01/05)

#### Valve Control (Address 0-1)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 0 | `COIL_VAN_NUOC_VAO` | Inlet Valve | Controls inlet water valve |
| 1 | `COIL_VAN_CHIA_NUOC` | Water Division Valve | Controls water division valve |

#### Mixing System (Address 1-5)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 1 | `COIL_VAN_TRON` | Mixing Valve | Controls mixing valve |
| 3 | `COIL_BOM_TRON` | Mixing Pump | Controls mixing pump |
| 4 | `COIL_DONGCO_KHUAY` | Stirring Motor | Controls stirring motor |
| 5 | `COIL_HEAT` | Heater | Controls heating element |

#### Dispensing Pump (Address 6)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 6 | `COIL_BOM_CHIET_ROT` | Dispensing Pump | Controls dispensing/rotary pump |

#### Main Pumps (Address 16-31)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 16 | `COIL_BOM_1` | Pump 1 | Controls pump 1 |
| 17 | `COIL_BOM_2` | Pump 2 | Controls pump 2 |
| 18 | `COIL_BOM_3` | Pump 3 | Controls pump 3 |
| 19 | `COIL_BOM_4` | Pump 4 | Controls pump 4 |
| 20 | `COIL_BOM_5` | Pump 5 | Controls pump 5 |
| 21 | `COIL_BOM_6` | Pump 6 | Controls pump 6 |
| 22 | `COIL_BOM_7` | Pump 7 | Controls pump 7 |
| 23 | `COIL_BOM_8` | Pump 8 | Controls pump 8 |
| 24 | `COIL_BOM_9` | Pump 9 | Controls pump 9 |
| 25 | `COIL_BOM_10` | Pump 10 | Controls pump 10 |
| 26 | `COIL_BOM_11` | Pump 11 | Controls pump 11 |
| 27 | `COIL_BOM_12` | Pump 12 | Controls pump 12 |
| 28 | `COIL_BOM_13` | Pump 13 | Controls pump 13 |
| 29 | `COIL_BOM_14` | Pump 14 | Controls pump 14 |
| 30 | `COIL_BOM_15` | Pump 15 | Controls pump 15 |
| 31 | `COIL_BOM_16` | Pump 16 | Controls pump 16 |

#### Reserved Coils (Address 7-15, 30-38)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 7-15 | `COIL_DU_PHONG_7` → `COIL_DU_PHONG_15` | Reserved 7-15 | Reserved for future use |
| 30-38 | `COIL_DU_PHONG_30` → `COIL_DU_PHONG_38` | Reserved 30-38 | Reserved for future use |

#### Safety & Protection (Address 39)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 39 | `COIL_NGO_RA_BAO_VE_KHOA_GIA_NHIET` | Overheat Protection Output | Safety output for overheat protection |

#### Status Feedback (Address 40-43)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 40 | `COIL_TRANG_THAI_BOM_TRON` | Mixing Pump Status | Feedback status of mixing pump |
| 41 | `COIL_TRANG_THAI_DONGCO_KHUAY` | Stirring Motor Status | Feedback status of stirring motor |
| 42 | `COIL_CAM_BIEN_MUC_NUOC_BON_PHA` | Mixing Tank Level Sensor | Water level sensor in mixing tank |
| 43 | `COIL_CAM_BIEN_MUC_NUOC_BON_KHUAY` | Stirring Tank Level Sensor | Water level sensor in stirring tank |

#### Auto Mode Controls (Address 44-49)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 44 | `COIL_AUTO_PH` | Auto pH Mode | Enable automatic pH control |
| 45 | `COIL_AUTO_DOSING` | Auto Dosing Mode | Enable automatic dosing |
| 46 | `COIL_AUTO_BOM_NUOC_VAO` | Auto Inlet Pump Mode | Enable automatic inlet pump |
| 47 | `COIL_AUTO_TRON` | Auto Mixing Mode | Enable automatic mixing |
| 48 | `COIL_ATUO_KHUAY_VA_HEAT` | Auto Stir & Heat Mode | Enable automatic stirring and heating |
| 49 | `COIL_AUTO_TU_DONG_CHIET_ROT` | Auto Dispensing Mode | Enable automatic dispensing |

#### Calibration Mode Controls (Address 50-53)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 50 | `COIL_BAT_CALIB_BOM` | Start Pump Calibration | Trigger pump calibration mode |
| 51 | `COIL_BAT_CALIB_LUU_LUONG` | Start Flow Calibration | Trigger flow calibration mode |
| 52 | `COIL_BAT_CALIB_EC` | Start EC Calibration | Trigger EC sensor calibration |
| 53 | `COIL_BAT_CALIB_PH` | Start pH Calibration | Trigger pH sensor calibration |

#### System Protection (Address 54-55)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 54 | `COIL_TAT_CAC_CHUC_NANG_BAO_VE` | Disable All Protection | Disable all protection functions |
| 55 | `COIL_KHOA_DIEU_KHIEN_TAY` | Lock Manual Control | Lock manual control mode |

#### Reserved Coils (Address 56-59)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 56-59 | `COIL_DU_PHONG_56` → `COIL_DU_PHONG_59` | Reserved 56-59 | Reserved for future use |

#### Error Alarms (Address 60-66)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 60 | `COIL_BAO_LOI_CAM_BIEN_EC_PH` | EC/pH Sensor Error | Alarm for EC/pH sensor error |
| 61 | `COIL_BAO_LOI_PHAO` | Float Sensor Error | Alarm for float sensor error |
| 62 | `COIL_BAO_LOI_LUU_LUONG` | Flow Sensor Error | Alarm for flow sensor error |
| 63 | `COIL_BAO_LOI_BOM_TRON` | Mixing Pump Error | Alarm for mixing pump error |
| 64 | `COIL_BAO_LOI_DIEN_TRO_HEAT` | Heating Resistor Error | Alarm for heating resistor error |
| 65 | `COIL_BAO_LOI_VAN_CAP_NUOC` | Inlet Valve Error | Alarm for inlet valve error |
| 66 | `COIL_BAO_LOI_DONGCO_KHUAY` | Stirring Motor Error | Alarm for stirring motor error |

---

## Board2 - Flow Sensor Board

**IP Address:** `192.168.110.98`  
**Modbus TCP Port:** `502`  
**Unit ID:** `1`

### Holding Registers (Function Code 03/06)

**Purpose:** Configuration and calibration parameters for flow sensors

| Address | Key | Name | Description | Unit | Scale | Range |
|:-------:|-----|------|-------------|------|-------|-------|
| 0-15 | `HOLDING_K_FACTOR_BOM_1` → `HOLDING_K_FACTOR_BOM_16` | K-Factor Pump 1-16 | Flow sensor K-Factor (Pulses per Liter) | P/L | ×1 | 100-2000 |
| 20-35 | `HOLDING_FLOWRATE_BOM_1` → `HOLDING_FLOWRATE_BOM_16` | Expected Flowrate Pump 1-16 | Expected pump flow rate | ml/s | ×100 | 0-65535 |

**Notes:**
- **K-Factor**: Number of pulses generated per liter of fluid passing through the sensor
  - Typical value for YF-S401: ~450 pulses/L
  - Used to convert pulse count to volume: `Volume(L) = Pulses / K-Factor`
- **Flowrate**: Expected/designed flow rate for each pump
  - Scaled by 100 for precision (e.g., 10.50 ml/s stored as 1050)
  - Used for time-based dosing: `Time(s) = Target_Volume(ml) / Flowrate(ml/s)`

### Input Registers (Function Code 04)

**Purpose:** Real-time flow measurements from sensors

#### Current Flow Rate (Address 0-15)

| Address | Key | Name | Description | Unit | Scale | Range |
|:-------:|-----|------|-------------|------|-------|-------|
| 0 | `INPUT_CURRENT_FLOW_BOM_1` | Current Flow Pump 1 | Instantaneous flow rate for pump 1 | ml/s | ×1 | 0-65535 |
| 1 | `INPUT_CURRENT_FLOW_BOM_2` | Current Flow Pump 2 | Instantaneous flow rate for pump 2 | ml/s | ×1 | 0-65535 |
| 2 | `INPUT_CURRENT_FLOW_BOM_3` | Current Flow Pump 3 | Instantaneous flow rate for pump 3 | ml/s | ×1 | 0-65535 |
| 3 | `INPUT_CURRENT_FLOW_BOM_4` | Current Flow Pump 4 | Instantaneous flow rate for pump 4 | ml/s | ×1 | 0-65535 |
| 4 | `INPUT_CURRENT_FLOW_BOM_5` | Current Flow Pump 5 | Instantaneous flow rate for pump 5 | ml/s | ×1 | 0-65535 |
| 5 | `INPUT_CURRENT_FLOW_BOM_6` | Current Flow Pump 6 | Instantaneous flow rate for pump 6 | ml/s | ×1 | 0-65535 |
| 6 | `INPUT_CURRENT_FLOW_BOM_7` | Current Flow Pump 7 | Instantaneous flow rate for pump 7 | ml/s | ×1 | 0-65535 |
| 7 | `INPUT_CURRENT_FLOW_BOM_8` | Current Flow Pump 8 | Instantaneous flow rate for pump 8 | ml/s | ×1 | 0-65535 |
| 8 | `INPUT_CURRENT_FLOW_BOM_9` | Current Flow Pump 9 | Instantaneous flow rate for pump 9 | ml/s | ×1 | 0-65535 |
| 9 | `INPUT_CURRENT_FLOW_BOM_10` | Current Flow Pump 10 | Instantaneous flow rate for pump 10 | ml/s | ×1 | 0-65535 |
| 10 | `INPUT_CURRENT_FLOW_BOM_11` | Current Flow Pump 11 | Instantaneous flow rate for pump 11 | ml/s | ×1 | 0-65535 |
| 11 | `INPUT_CURRENT_FLOW_BOM_12` | Current Flow Pump 12 | Instantaneous flow rate for pump 12 | ml/s | ×1 | 0-65535 |
| 12 | `INPUT_CURRENT_FLOW_BOM_13` | Current Flow Pump 13 | Instantaneous flow rate for pump 13 | ml/s | ×1 | 0-65535 |
| 13 | `INPUT_CURRENT_FLOW_BOM_14` | Current Flow Pump 14 | Instantaneous flow rate for pump 14 | ml/s | ×1 | 0-65535 |
| 14 | `INPUT_CURRENT_FLOW_BOM_15` | Current Flow Pump 15 | Instantaneous flow rate for pump 15 | ml/s | ×1 | 0-65535 |
| 15 | `INPUT_CURRENT_FLOW_BOM_16` | Current Flow Pump 16 | Instantaneous flow rate for pump 16 | ml/s | ×1 | 0-65535 |

#### Total Volume (Address 20-35)

| Address | Key | Name | Description | Unit | Scale | Range |
|:-------:|-----|------|-------------|------|-------|-------|
| 20 | `INPUT_TOTAL_FLOW_BOM_1` | Total Volume Pump 1 | Cumulative volume dispensed by pump 1 | ml | ×1 | 0-65535 |
| 21 | `INPUT_TOTAL_FLOW_BOM_2` | Total Volume Pump 2 | Cumulative volume dispensed by pump 2 | ml | ×1 | 0-65535 |
| 22 | `INPUT_TOTAL_FLOW_BOM_3` | Total Volume Pump 3 | Cumulative volume dispensed by pump 3 | ml | ×1 | 0-65535 |
| 23 | `INPUT_TOTAL_FLOW_BOM_4` | Total Volume Pump 4 | Cumulative volume dispensed by pump 4 | ml | ×1 | 0-65535 |
| 24 | `INPUT_TOTAL_FLOW_BOM_5` | Total Volume Pump 5 | Cumulative volume dispensed by pump 5 | ml | ×1 | 0-65535 |
| 25 | `INPUT_TOTAL_FLOW_BOM_6` | Total Volume Pump 6 | Cumulative volume dispensed by pump 6 | ml | ×1 | 0-65535 |
| 26 | `INPUT_TOTAL_FLOW_BOM_7` | Total Volume Pump 7 | Cumulative volume dispensed by pump 7 | ml | ×1 | 0-65535 |
| 27 | `INPUT_TOTAL_FLOW_BOM_8` | Total Volume Pump 8 | Cumulative volume dispensed by pump 8 | ml | ×1 | 0-65535 |
| 28 | `INPUT_TOTAL_FLOW_BOM_9` | Total Volume Pump 9 | Cumulative volume dispensed by pump 9 | ml | ×1 | 0-65535 |
| 29 | `INPUT_TOTAL_FLOW_BOM_10` | Total Volume Pump 10 | Cumulative volume dispensed by pump 10 | ml | ×1 | 0-65535 |
| 30 | `INPUT_TOTAL_FLOW_BOM_11` | Total Volume Pump 11 | Cumulative volume dispensed by pump 11 | ml | ×1 | 0-65535 |
| 31 | `INPUT_TOTAL_FLOW_BOM_12` | Total Volume Pump 12 | Cumulative volume dispensed by pump 12 | ml | ×1 | 0-65535 |
| 32 | `INPUT_TOTAL_FLOW_BOM_13` | Total Volume Pump 13 | Cumulative volume dispensed by pump 13 | ml | ×1 | 0-65535 |
| 33 | `INPUT_TOTAL_FLOW_BOM_14` | Total Volume Pump 14 | Cumulative volume dispensed by pump 14 | ml | ×1 | 0-65535 |
| 34 | `INPUT_TOTAL_FLOW_BOM_15` | Total Volume Pump 15 | Cumulative volume dispensed by pump 15 | ml | ×1 | 0-65535 |
| 35 | `INPUT_TOTAL_FLOW_BOM_16` | Total Volume Pump 16 | Cumulative volume dispensed by pump 16 | ml | ×1 | 0-65535 |

**Notes:**
- **Current Flow**: Real-time flow rate reading from the sensor
- **Total Volume**: Accumulated volume since last reset (reset via coil)

### Coils (Function Code 01/05)

#### Pump Status Feedback (Address 161-176)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 161 | `PUMP_STATUS_BOM_1` | Pump 1 Status | Feedback: Pump 1 is running |
| 162 | `PUMP_STATUS_BOM_2` | Pump 2 Status | Feedback: Pump 2 is running |
| 163 | `PUMP_STATUS_BOM_3` | Pump 3 Status | Feedback: Pump 3 is running |
| 164 | `PUMP_STATUS_BOM_4` | Pump 4 Status | Feedback: Pump 4 is running |
| 165 | `PUMP_STATUS_BOM_5` | Pump 5 Status | Feedback: Pump 5 is running |
| 166 | `PUMP_STATUS_BOM_6` | Pump 6 Status | Feedback: Pump 6 is running |
| 167 | `PUMP_STATUS_BOM_7` | Pump 7 Status | Feedback: Pump 7 is running |
| 168 | `PUMP_STATUS_BOM_8` | Pump 8 Status | Feedback: Pump 8 is running |
| 169 | `PUMP_STATUS_BOM_9` | Pump 9 Status | Feedback: Pump 9 is running |
| 170 | `PUMP_STATUS_BOM_10` | Pump 10 Status | Feedback: Pump 10 is running |
| 171 | `PUMP_STATUS_BOM_11` | Pump 11 Status | Feedback: Pump 11 is running |
| 172 | `PUMP_STATUS_BOM_12` | Pump 12 Status | Feedback: Pump 12 is running |
| 173 | `PUMP_STATUS_BOM_13` | Pump 13 Status | Feedback: Pump 13 is running |
| 174 | `PUMP_STATUS_BOM_14` | Pump 14 Status | Feedback: Pump 14 is running |
| 175 | `PUMP_STATUS_BOM_15` | Pump 15 Status | Feedback: Pump 15 is running |
| 176 | `PUMP_STATUS_BOM_16` | Pump 16 Status | Feedback: Pump 16 is running |

#### Reset Total Volume (Address 201-216)

| Address | Key | Name | Description |
|:-------:|-----|------|-------------|
| 201 | `RESET_TOTAL_VOLUME_BOM_1` | Reset Volume Pump 1 | Set to 1 to reset total volume counter for pump 1 |
| 202 | `RESET_TOTAL_VOLUME_BOM_2` | Reset Volume Pump 2 | Set to 1 to reset total volume counter for pump 2 |
| 203 | `RESET_TOTAL_VOLUME_BOM_3` | Reset Volume Pump 3 | Set to 1 to reset total volume counter for pump 3 |
| 204 | `RESET_TOTAL_VOLUME_BOM_4` | Reset Volume Pump 4 | Set to 1 to reset total volume counter for pump 4 |
| 205 | `RESET_TOTAL_VOLUME_BOM_5` | Reset Volume Pump 5 | Set to 1 to reset total volume counter for pump 5 |
| 206 | `RESET_TOTAL_VOLUME_BOM_6` | Reset Volume Pump 6 | Set to 1 to reset total volume counter for pump 6 |
| 207 | `RESET_TOTAL_VOLUME_BOM_7` | Reset Volume Pump 7 | Set to 1 to reset total volume counter for pump 7 |
| 208 | `RESET_TOTAL_VOLUME_BOM_8` | Reset Volume Pump 8 | Set to 1 to reset total volume counter for pump 8 |
| 209 | `RESET_TOTAL_VOLUME_BOM_9` | Reset Volume Pump 9 | Set to 1 to reset total volume counter for pump 9 |
| 210 | `RESET_TOTAL_VOLUME_BOM_10` | Reset Volume Pump 10 | Set to 1 to reset total volume counter for pump 10 |
| 211 | `RESET_TOTAL_VOLUME_BOM_11` | Reset Volume Pump 11 | Set to 1 to reset total volume counter for pump 11 |
| 212 | `RESET_TOTAL_VOLUME_BOM_12` | Reset Volume Pump 12 | Set to 1 to reset total volume counter for pump 12 |
| 213 | `RESET_TOTAL_VOLUME_BOM_13` | Reset Volume Pump 13 | Set to 1 to reset total volume counter for pump 13 |
| 214 | `RESET_TOTAL_VOLUME_BOM_14` | Reset Volume Pump 14 | Set to 1 to reset total volume counter for pump 14 |
| 215 | `RESET_TOTAL_VOLUME_BOM_15` | Reset Volume Pump 15 | Set to 1 to reset total volume counter for pump 15 |
| 216 | `RESET_TOTAL_VOLUME_BOM_16` | Reset Volume Pump 16 | Set to 1 to reset total volume counter for pump 16 |

**Notes:**
- **PUMP_STATUS**: Read-only feedback from Board2 indicating pump operation status
- **RESET_TOTAL_VOLUME**: Write-only coil, auto-clears after reset
  - Write `1` to reset the corresponding total volume counter
  - Automatically clears to `0` after ~500ms

---

## Scale Factor Reference

### Board1 Scaling

| Key Pattern | Scale Direction | Factor | Example |
|-------------|-----------------|--------|---------|
| `HOLDING_PH_*` | Write | ×10 | pH 7.5 → 75 |
| `HOLDING_PH_*` | Read | ÷10 | 75 → pH 7.5 |
| `HOLDING_CALIB_BOM_*` | Write | ×100 | 10.50 ml/s → 1050 |
| `HOLDING_CALIB_BOM_*` | Read | ÷100 | 1050 → 10.50 ml/s |

### Board2 Scaling

| Key Pattern | Scale Direction | Factor | Example |
|-------------|-----------------|--------|---------|
| `HOLDING_K_FACTOR_BOM_*` | Write | ×1 | 450 → 450 |
| `HOLDING_K_FACTOR_BOM_*` | Read | ÷1 | 450 → 450 |
| `HOLDING_FLOWRATE_BOM_*` | Write | ×100 | 9.50 ml/s → 950 |
| `HOLDING_FLOWRATE_BOM_*` | Read | ÷100 | 950 → 9.50 ml/s |
| `INPUT_*_FLOW_BOM_*` | Read | ÷1 | 1000 → 1000 ml/s |
| `INPUT_TOTAL_FLOW_BOM_*` | Read | ÷1 | 1000 → 1000 ml |

---

## Calibration Formulas

### Pump Calibration (Board1)

```
Run Time (s) = Target Volume (ml) / Current Calibration (ml/s)
New Calibration (ml/s) = Actual Volume (ml) / Run Time (s)
```

**Example:**
- Target: 1000 ml
- Current Calib: 10.00 ml/s (stored as 1000)
- Run Time: 1000 / 10.00 = 100 s
- Actual measured: 950 ml
- New Calib: 950 / 100 = 9.50 ml/s (store as 950)

### Flow Sensor Calibration (Board2)

**K-Factor:**
```
K_new = K_old × (V_reported / V_actual)
```

**Example:**
- K_old: 450 pulses/L
- V_reported: 1000 ml (sensor reading)
- V_actual: 950 ml (measured)
- K_new: 450 × (1000 / 950) = 474 pulses/L

**Flowrate:**
```
Q_new (ml/s) = V_actual (ml) / Run Time (s)
```

**Example:**
- V_actual: 950 ml
- Run Time: 100 s
- Q_new: 950 / 100 = 9.50 ml/s (store as 950)

---

## Usage Examples

### Example 1: Dispense 500ml from Pump 1

```
1. Set target volume:
   WRITE Holding Register 1 (HOLDING_SETML_BOM_1) = 500

2. Start pump:
   WRITE Coil 16 (COIL_BOM_1) = 1

3. Monitor volume:
   READ Input Register 20 (INPUT_TOTAL_FLOW_BOM_1)
   Wait until value >= 500

4. Stop pump:
   WRITE Coil 16 (COIL_BOM_1) = 0
```

### Example 2: Reset Flow Counter for Pump 2

```
1. Reset volume counter:
   WRITE Coil 202 (RESET_TOTAL_VOLUME_BOM_2) = 1

2. Wait 500ms for auto-clear

3. Verify reset:
   READ Input Register 21 (INPUT_TOTAL_FLOW_BOM_2)
   Should read 0
```

### Example 3: Read Current pH and EC

```
1. Read pH:
   READ Input Register 2 (INPUT_PH)
   Example: 72 → pH = 72 / 10 = 7.2

2. Read EC:
   READ Input Register 1 (INPUT_EC)
   Example: 1500 → EC = 1500 μS/cm
```

---

## Error Handling

### Common Error Codes

| Error | Coil Address | Description |
|-------|--------------|-------------|
| EC/pH Sensor Error | 60 | Invalid reading from EC or pH sensor |
| Float Sensor Error | 61 | Water level sensor malfunction |
| Flow Sensor Error | 62 | No flow detected or invalid flow reading |
| Mixing Pump Error | 63 | Mixing pump failure or overload |
| Heating Resistor Error | 64 | Heating element failure |
| Inlet Valve Error | 65 | Inlet valve stuck or timeout |
| Stirring Motor Error | 66 | Stirring motor failure |

### Recovery Procedure

1. Identify error from alarm coil
2. Check physical device/sensor
3. Clear error condition
4. Reset protection if needed:
   ```
   WRITE Coil 54 (COIL_TAT_CAC_CHUC_NANG_BAO_VE) = 1
   Wait 1 second
   WRITE Coil 54 = 0
   ```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-18 | VIIS Team | Initial release |
