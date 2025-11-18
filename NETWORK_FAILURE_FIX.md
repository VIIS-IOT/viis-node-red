# Network Failure Fix - MQTT Publish Error Handling

## Vấn Đề

Khi máy mất mạng (internet down), các custom nodes gọi MQTT `publish()` không có error handling phù hợp, gây **crash Node-RED** thay vì tiếp tục hoạt động local.

### Triệu chứng quan sát được:
```
[error] [viis-marine-telemetry:xxx] MQTT Connection Error: getaddrinfo EAI_AGAIN iot.viis.tech
Connection timeout
```

Node-RED crash hoặc hang, các service local không thể hoạt động.

---

## Nguyên nhân

### 1. MQTT publish không có try-catch
Các chỗ gọi `publish()` trực tiếp không wrap trong try-catch:
```typescript
// ❌ BAD - Crash khi mất mạng
thingsboardMqtt.publish(topic, JSON.stringify(payload));
```

### 2. Try-catch nhưng vẫn throw error
Một số chỗ có try-catch nhưng vẫn throw error ra ngoài:
```typescript
// ❌ BAD - Vẫn crash vì throw
try {
    await mqttClient.publish(topic, payload);
} catch (error) {
    console.error(error);
    throw error; // <-- Gây crash
}
```

### 3. Async/await không đúng
Một số chỗ gọi async function nhưng không await:
```typescript
// ❌ BAD - Unhandled promise rejection
publishTelemetry({ ... }); // Missing await
```

---

## Giải pháp

### Nguyên tắc xử lý:
✅ **Wrap tất cả MQTT publish trong try-catch**  
✅ **KHÔNG throw error** - log warning và tiếp tục  
✅ **Local services vẫn hoạt động** ngay cả khi MQTT fail  
✅ **Update node status** để user biết MQTT đang lỗi

---

## Files đã sửa

### 1. **viis-marine-telemetry.ts** ✅
**Vị trí:** Line 260-281  
**Vấn đề:** Publish không có try-catch  
**Fix:**
```typescript
// Wrap publish in try-catch to prevent crash when network is down
try {
    await thingsboardMqtt.publish(topic, JSON.stringify(telemetryPayload));
    node.log(`[Marine] Published ${Object.keys(telemetryPayload).length} values to ThingsBoard`);
} catch (publishError) {
    // Log warning but don't crash - local services should continue working
    node.warn(`[Marine] Failed to publish to ThingsBoard (network may be down): ${(publishError as Error).message}`);
    node.status({ fill: "yellow", shape: "ring", text: "MQTT publish failed - continuing locally" });
}

// Send output message regardless of MQTT publish status
node.send({ ... });
```

---

### 2. **viis-telemetry-utils.ts** ✅
**Vị trí:** Line 115-134  
**Vấn đề:** Function không async, không có error handling  
**Fix:**
```typescript
export async function publishTelemetry(params: PublishTelemetryParams): Promise<void> {
  const payload = JSON.stringify(params.data);
  
  // Publish to EMQX (local) with error handling
  try {
    await params.emqxClient.publish(params.emqxTopic, payload);
  } catch (error) {
    // Log but don't crash - local MQTT may be down
    console.warn(`[Telemetry] Failed to publish to EMQX: ${(error as Error).message}`);
  }
  
  // Publish to ThingsBoard with error handling
  try {
    await params.thingsboardClient.publish(params.thingsboardTopic, payload);
  } catch (error) {
    // Log but don't crash - ThingsBoard may be unreachable due to network issues
    console.warn(`[Telemetry] Failed to publish to ThingsBoard: ${(error as Error).message}`);
  }
}
```

---

### 3. **viis-telemetry-processor.ts** ✅
**Vị trí:** Line 185-198  
**Vấn đề:** Có try-catch nhưng throw error  
**Fix:**
```typescript
private async publishTelemetryData(data: TelemetryData): Promise<void> {
  try {
    await publishTelemetry({ ... });
  } catch (error) {
    this.node.error(`Failed to publish telemetry: ${(error as Error).message}`);
    // Don't throw - let the service continue even if MQTT publish fails
    this.node.warn('Continuing local operations despite MQTT publish failure');
  }
}
```

---

### 4. **viis-schedule-executor-service.ts** ✅
**Vị trí:** Line 661-669, 1320-1326  
**Vấn đề:** Có try-catch nhưng throw error  
**Fix:**
```typescript
} catch (error) {
    // CRITICAL LOG: MQTT error
    if (this.node) {
        this.node.warn(`❌ MQTT ERROR: ${schedule.name} | ${(error as Error).message}`);
        this.node.warn(`⚠️  Continuing local operations despite MQTT publish failure`);
    }
    console.error(`Error publishing MQTT for ${schedule.name}: ${(error as Error).message}`);
    // Don't throw - let local services continue even if MQTT fails
}
```

---

### 5. **viis-rpc-control/mqttService.ts** ✅
**Vị trí:** Line 76-82, 110-116, 139-145, 158-164  
**Vấn đề:** Có try-catch nhưng throw error  
**Fix:** (4 methods: publishResult, publishConfigUpdate, publishMultipleValues, publishCustomPayload)
```typescript
} catch (error) {
    const errorMessage = `Failed to publish ${key}: ${(error as Error).message}`;
    this.logger.error(errorMessage);
    this.node.status({ fill: "yellow", shape: "ring", text: "MQTT failed - continuing locally" });
    this.logger.warn(`⚠️  Continuing local operations despite MQTT publish failure`);
    // Don't throw - let local services continue even if MQTT fails
}
```

---

## Các chỗ đã OK (không cần fix)

### ✅ **viis-rpc-control-from-input.ts**
Đã có try-catch đúng, không throw:
```typescript
try {
    await mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
    node.log(`Published to MQTT: ${key}=${value}`);
} catch (error) {
    node.error(`MQTT publish error for ${key}: ${(error as Error).message}`);
}
```

### ✅ **viis-flow-accumulation.ts**
MQTT publish đã bị comment out (disabled)

---

## Testing

### Test Case 1: Simulate network failure
```bash
# Disconnect network
sudo ip link set eth0 down

# Check Node-RED logs
docker logs -f nodered1

# Expected: Warning logs, không crash
# ⚠️  MQTT publish failed - continuing locally
# ✅ Local services vẫn hoạt động
```

### Test Case 2: Reconnect network
```bash
# Reconnect network
sudo ip link set eth0 up

# Expected: MQTT tự động reconnect
# ✅ Published to ThingsBoard
```

### Test Case 3: Deploy/Redeploy
```bash
# Open Node-RED UI
# Click Deploy nhiều lần

# Expected: Không có crash
# ✅ Flows deploy thành công
```

---

## Impact Analysis

### ✅ **Positive Changes:**
1. **Node-RED stability** - Không crash khi mất mạng
2. **Local resilience** - Services local tiếp tục hoạt động
3. **Better UX** - Node status hiển thị MQTT error thay vì crash
4. **Auto-recovery** - MQTT tự động reconnect khi có mạng trở lại

### ⚠️ **Tradeoffs:**
1. **Data loss** - Telemetry data có thể bị mất khi offline (không có queueing)
2. **Silent failures** - User cần check logs để biết MQTT lỗi

### 🔮 **Future Improvements:**
1. Implement message queue để cache data khi offline
2. Add retry mechanism với exponential backoff
3. Persist queued messages to disk
4. Add health check endpoint

---

## Verification Checklist

- [x] Build thành công (TypeScript compilation OK)
- [x] Không còn unhandled promise rejection
- [x] Tất cả MQTT publish có error handling
- [x] Không có throw error sau catch (chỉ log)
- [x] Node status update khi MQTT fail
- [ ] Test thực tế với network down
- [ ] Test reconnection tự động
- [ ] Verify data integrity sau reconnect

---

## Related Documentation

- `CRASH_FIX_README.md` - DataSource race condition fix
- `DH6400_MIGRATION.md` - DH6400 serial polling migration
- `IMPLEMENTATION_SUMMARY.md` - Overall implementation notes

---

## Summary

✅ **Fixed:** MQTT publish crash khi mất mạng  
✅ **Impact:** 5 files, ~15 chỗ cần fix  
✅ **Approach:** Wrap publish trong try-catch, KHÔNG throw error  
✅ **Result:** Local services tiếp tục hoạt động ngay cả khi MQTT broker unreachable  

**Status:** ✅ Ready for testing

**Build:** ✅ Successful (no TypeScript errors)

---

**Last Updated:** 2025-11-18  
**Author:** Cascade AI Assistant  
**Version:** 1.0.0
