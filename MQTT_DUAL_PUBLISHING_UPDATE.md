# MQTT Dual Publishing Update for viis-schedule-executor

## 📋 Overview
Updated `viis-schedule-executor` node to publish MQTT messages to both ThingsBoard and EMQX local brokers, similar to the `viis-telemetry` node implementation.

## 🔄 Changes Made

### 1. Service Layer Updates (`viis-schedule-executor-service.ts`)

**Modified `publishMqttNotification` function:**
- **Before:** Only published to ThingsBoard
- **After:** Publishes to both ThingsBoard and EMQX local brokers

```typescript
// OLD
async publishMqttNotification(mqttClient: MqttClientCore, schedule: TabiotSchedule, success: boolean)

// NEW  
async publishMqttNotification(
    thingsboardClient: MqttClientCore, 
    emqxClient: MqttClientCore, 
    schedule: TabiotSchedule, 
    success: boolean
)
```

### 2. Main Node Updates (`viis-schedule-executor.ts`)

**Updated all function calls:**
- Added `emqxClient` parameter to all `publishMqttNotification` calls
- Updated client cleanup in `close` event handler

**Locations updated:**
- Line 146: RPC disable schedule
- Line 253: Schedule start execution
- Line 261: Re-execute after power loss  
- Line 295: Schedule finish execution
- Line 331: Added EMQX client cleanup

### 3. UI Updates (`viis-schedule-executor.html`)

**Removed MQTT Broker selection:**
- Removed dropdown for choosing between ThingsBoard/EMQX
- Added informational text about dual publishing
- Updated help documentation

### 4. Type Definition Updates (`type.ts`)

**Cleaned up interface:**
- Removed `mqttBroker` field from `ScheduleExecutorNodeDef`
- Removed duplicate `ModbusCmd` interface

## 📡 MQTT Publishing Details

### Topics:
- **ThingsBoard:** `v1/devices/me/telemetry`
- **EMQX Local:** `viis/things/v2/${deviceId}/telemetry`

### Message Format:
```json
{
  "active_schedule": "{\"scheduleId\":\"schedule_name\",\"label\":\"schedule_label\",\"device_label\":\"device_label\",\"status\":\"running|finished\",\"timestamp\":1234567890}"
}
```

### Publishing Events:
1. **Schedule Start:** When schedule changes from not running to "running"
2. **Schedule Finish:** When schedule changes from "running" to "finished"  
3. **Re-execution:** When schedule re-executes after power loss
4. **RPC Disable:** When schedule is disabled via RPC command

## 🔧 Environment Variables Used

- `DEVICE_ID`: Used for EMQX topic construction
- `EMQX_HOST`: EMQX broker hostname (default: "emqx")
- `EMQX_PORT`: EMQX broker port (default: "1883")
- `EMQX_USERNAME`: EMQX authentication username
- `EMQX_PASSWORD`: EMQX authentication password
- `THINGSBOARD_HOST`: ThingsBoard broker hostname (default: "mqtt.viis.tech")
- `THINGSBOARD_PORT`: ThingsBoard broker port (default: "1883")
- `DEVICE_ACCESS_TOKEN`: ThingsBoard device access token

## ✅ Benefits

1. **Dual Redundancy:** Messages published to both local and cloud brokers
2. **Local Processing:** EMQX local broker enables local automation
3. **Cloud Integration:** ThingsBoard maintains cloud connectivity
4. **Consistent Pattern:** Matches viis-telemetry implementation
5. **No Breaking Changes:** Existing functionality preserved

## 🚀 Usage

The node now automatically publishes to both brokers without any configuration changes needed. Simply deploy the updated node and it will start dual publishing immediately.

## 📝 Notes

- Both MQTT clients must be connected for publishing to work
- If one broker fails, the other will continue to receive messages
- Error handling ensures robust operation even with connection issues
- Memory from previous interactions shows user preference for this dual publishing pattern
