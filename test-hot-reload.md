# Test Hot-Reload cho Standardized Nodes

## Nodes đã chuẩn hóa với Auto Hot-Reload
1. ✅ **viis-rpc-control-from-input** - Auto reconnect Modbus khi config thay đổi
2. ✅ **viis-auto-microclimate-control** - Detect config change và yêu cầu redeploy
3. ✅ **viis-rpc-control** - Full hot-reload với auto reconnect
4. ✅ **viis-modbus-poller, viis-modbus-getter, etc.** - Standardized nodes

## Hot-Reload Mechanism

### viis-rpc-control-from-input
- ✅ Auto-detect config changes every 30 seconds
- ✅ Auto-reconnect Modbus client khi host/port thay đổi
- ✅ Auto-update env variables (deviceId, modbus mappings)
- **Không cần redeploy** - auto reconnect

### viis-auto-microclimate-control
- ✅ Auto-detect config changes every 30 seconds
- ⚠️ Hiển thị warning và yêu cầu redeploy
- **Cần redeploy** vì phức tạp hơn (nhiều services)

## Test Checklist

### 1. Initial Deployment
- [x] Build: `npm run build`
- [ ] Deploy nodes trong Node-RED
- [ ] Kiểm tra nodes khởi động không lỗi
- [ ] Verify nodes đọc được env từ global context

### 2. Test Hot-Reload (viis-rpc-control-from-input)
- [ ] Sửa file `/services/env/common.env` (thay đổi MODBUS_HOST)
- [ ] **KHÔNG restart** container, **KHÔNG redeploy** node
- [ ] Đợi 30 giây (auto-detect interval)
- [ ] Check debug log: `[HOT-RELOAD] Modbus config changed...`
- [ ] Check log: `[HOT-RELOAD] Modbus client reconnected successfully`
- [ ] Node status should show "Reconnected"
- [ ] Verify node hoạt động với config mới

### 3. Test Hot-Reload (viis-auto-microclimate-control)
- [ ] Sửa file `/services/env/common.env` (thay đổi MODBUS_HOST)
- [ ] Đợi 30 giây (auto-detect interval)
- [ ] Check warning: `[HOT-RELOAD] Please redeploy this node`
- [ ] Node status: "Config changed - redeploy needed"
- [ ] Click Deploy trong Node-RED
- [ ] Verify node hoạt động với config mới

### 3. Test Migration
- [ ] Chạy `npm run migration:run` từ host
- [ ] Verify connect được với localhost:3308
- [ ] Kiểm tra migration thành công

### 4. Verify Backward Compatibility
- [ ] Nodes vẫn hoạt động khi chưa có env-loader
- [ ] Fallback về process.env nếu global context trống

## Expected Behavior

### viis-rpc-control-from-input
- Đọc DEVICE_ID, MODBUS_*, EMQX_*, THINGSBOARD_* từ global context
- Có thể hot-reload khi thay đổi env file
- Không cần restart container

### viis-auto-microclimate-control
- Đọc ENV_KEYS.* từ global context
- Modbus config cập nhật từ common.env
- Hot-reload hoạt động với delay 3-4s

## Commands

```bash
# Build
npm run build

# Test migration
npm run migration:run

# Check logs in container
docker logs -f viis-nodered1

# Edit env file
nano /home/phuongtung0801/Documents/WORK/VIIS/viis-local-docker/services/env/common.env
```

## Notes
- File `/services/env/common.env` chứa cả config cho migration (DB_HOST=localhost, DB_PORT=3308)
- Không cần file `.env` riêng lẻ trong source code
- Tất cả config tập trung tại `/services/env/`
