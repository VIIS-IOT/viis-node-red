# Node-RED Crash Fix Documentation

## Vấn Đề Đã Fix

### 1. Race Condition trong DataSource Cleanup ✅

**Triệu chứng:**
```
CannotExecuteNotConnectedError: Cannot execute operation on "default" connection because connection is not yet established.
```

**Nguyên nhân:**
- DataSource là singleton được share giữa nhiều nodes
- Khi Node-RED shutdown, tất cả nodes cleanup đồng thời
- Nhiều nodes cố gắng destroy cùng một DataSource → race condition → crash

**Giải pháp:**
- ✅ **viis-marine-telemetry**: Thêm DataSource cleanup với error handling
- ✅ **viis-flow-accumulation**: Loại bỏ DataSource cleanup  
- ✅ **viis-trip-realtime-telemetry**: Loại bỏ DataSource cleanup
- ✅ **Centralized cleanup**: Chỉ một node (viis-marine-telemetry) cleanup DataSource

**Files đã sửa:**
- `src/modules/viis-marine-telemetry/viis-marine-telemetry.ts`
- `src/modules/viis-flow-accumulation/viis-flow-accumulation.ts`
- `src/modules/viis-trip-realtime-telemetry/viis-trip-realtime-telemetry.ts`

---

### 2. Serial Port Device Mapping Error ✅

**Triệu chứng:**
```
Error response from daemon: error gathering device information while adding custom device "/dev/ttyACM0": no such file or directory
```

**Nguyên nhân:**
- Docker compose map `/dev/ttyACM0` nhưng device không tồn tại trên host
- DH6400 flow sensors chưa được kết nối

**Giải pháp:**
- ✅ Comment device mapping trong `docker-compose.yml`
- User có thể uncomment khi hardware được kết nối

**Files đã sửa:**
- `docker-compose.yml`

---

## Cách Test

### Test 1: Verify Docker Start
```bash
cd /home/phuongtung0801/VIIS/viis-local-docker/services
docker compose down
docker compose up -d --build
docker logs -f nodered1
```

**Expected:** Container start thành công, không có error về `/dev/ttyACM0`

---

### Test 2: Verify Node-RED Deploy & Redeploy

1. Truy cập Node-RED: http://localhost:1880
2. Click **Deploy**
3. Đợi flows deploy thành công
4. Click **Deploy** lại nhiều lần
5. Restart Node-RED container:
   ```bash
   docker restart nodered1
   docker logs -f nodered1
   ```

**Expected:**
- ✅ Không có lỗi `CannotExecuteNotConnectedError`
- ✅ Logs hiển thị cleanup thành công:
  ```
  [Marine] DH6400 polling service cleaned up
  [Marine] Database connection closed
  [Marine] Node closed and cleaned up
  [FlowAccumulation] Node closed and cleaned up
  [TripRealtime] Node closed and cleaned up
  ```

---

### Test 3: Verify DH6400 Disable

Kiểm tra DH6400 polling bị disable khi không có hardware:

```bash
docker logs nodered1 | grep DH6400
```

**Expected:**
```
[Marine] DH6400 serial polling disabled
```

Hoặc nếu enabled trong env nhưng không thể connect:
```
[DH6400Polling] No serial port configured
[DH6400Polling] Cannot start - disabled or not initialized
```

---

## Khi Nào Cần Enable DH6400

Khi đã có hardware DH6400 flow sensors:

### Bước 1: Kiểm tra device
```bash
ls -l /dev/ttyACM* /dev/ttyUSB*
```

### Bước 2: Uncomment device mapping
Trong `docker-compose.yml`:
```yaml
sysctls:
  - net.ipv6.conf.all.disable_ipv6=1
devices:
  - "/dev/ttyACM0:/dev/ttyUSB0"  # Uncomment this
group_add:
  - dialout  # Uncomment this
```

### Bước 3: Enable trong env
Trong `env/device1.env`:
```bash
DH6400_ENABLED=true
DH6400_SERIAL_PORT=/dev/ttyACM0
DH6400_ENABLED_CHANNELS=1,2,3,4,5,6
```

### Bước 4: Restart
```bash
docker compose down
docker compose up -d --build
```

---

## Debug Tips

### Check DataSource Status
```bash
# Xem logs cleanup
docker logs nodered1 | grep "Database connection"

# Xem logs của từng node
docker logs nodered1 | grep "\[Marine\]"
docker logs nodered1 | grep "\[FlowAccumulation\]"
docker logs nodered1 | grep "\[TripRealtime\]"
```

### Check Serial Port
```bash
# Kiểm tra port có tồn tại
ls -l /dev/tty*

# Kiểm tra permissions
groups
# Should include 'dialout'

# Test serial connection (nếu có hardware)
docker exec -it nodered1 ls -l /dev/ttyUSB0
```

### Monitor Crash
```bash
# Theo dõi logs real-time
docker logs -f nodered1 2>&1 | grep -E "(error|Error|crash|Crash|Exception)"

# Kiểm tra container restart count
docker ps -a | grep nodered1
```

---

## Known Issues & Workarounds

### Issue: DH6400 không đọc được dữ liệu
**Workaround:**
1. Kiểm tra baudrate: `DH6400_BAUD_RATE=9600`
2. Kiểm tra slave IDs: `DH6400_ENABLED_CHANNELS=1,2,3,4,5,6`
3. Check logs: `docker logs nodered1 | grep DH6400`

### Issue: Database connection pool exhausted
**Workaround:**
- Tăng `DATABASE_CONNECTION_LIMIT` trong env
- Restart container để reset pool

---

## Rollback

Nếu có vấn đề, rollback về version trước:

```bash
cd /home/phuongtung0801/VIIS/viis-local-docker/services/nodered/custom-nodes/viis-node-red
git log --oneline -5
git checkout <previous-commit-hash>
cd ../../..
docker compose up -d --build
```

---

## Summary

✅ **Fixed:** Race condition trong DataSource cleanup
✅ **Fixed:** Serial port device mapping error  
✅ **Improved:** Centralized cleanup logic
✅ **Added:** Better error handling for DataSource destroy

**Status:** Ready for production testing
