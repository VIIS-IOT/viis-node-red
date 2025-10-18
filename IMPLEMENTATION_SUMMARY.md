# Default Admin User - Implementation Summary

## ✅ Đã Hoàn Thành

### 1. Tạo Default User Seed Service
**File**: `src/modules/viis-rest-api/services/default-user-seed.service.ts`

**Chức năng**:
- Tự động kiểm tra và tạo user mặc định khi hệ thống khởi động
- User mặc định:
  - Email: `fueliot@gmail.com`
  - Password: `admin123` (hashed bằng bcrypt)
  - Full admin permissions (is_admin = 1)
  - Có thể call mọi API endpoint

**Features**:
- ✅ Idempotent: Chỉ tạo nếu user chưa tồn tại
- ✅ Secure: Password được hash bằng bcrypt (salt rounds: 10)
- ✅ Safe: Không throw error nếu seed fail, system tiếp tục chạy
- ✅ Logging: Chi tiết logs cho debugging

### 2. Tích Hợp vào System Initialization
**File**: `src/modules/viis-rest-api/viis-rest-api.ts`

**Changes**:
```typescript
// Import service
import { DefaultUserSeedService } from "./services/default-user-seed.service";

// Gọi seed trong initialization
try {
    const seedService = new DefaultUserSeedService(databaseService, node);
    await seedService.seedDefaultUser();
} catch (error) {
    logger.warn(node, `Failed to seed default user: ${(error as Error).message}`);
    // Continue execution even if seeding fails
}
```

### 3. Documentation
**File**: `DEFAULT_USER_GUIDE.md`

Hướng dẫn chi tiết:
- Thông tin đăng nhập
- Cách sử dụng
- Testing
- Troubleshooting
- Security best practices

## 🔑 Thông Tin Đăng Nhập

```
Email:    fueliot@gmail.com
Password: admin123
Role:     Full Admin
```

## 🚀 Cách Sử Dụng

### 1. Build Code
```bash
cd /home/phuongtung0801/Documents/WORK/VIIS/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm run build
```

### 2. Deploy Node-RED
- Deploy hoặc restart Node-RED
- VIIS REST API node sẽ tự động seed user

### 3. Login qua API
```bash
curl -X POST http://localhost:1880/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "usr": "fueliot@gmail.com",
    "pwd": "admin123"
  }'
```

### 4. Sử dụng Token
```bash
# Lưu token từ response
TOKEN="eyJhbGciOiJIUzUxMiIs..."

# Call bất kỳ API nào
curl -X GET http://localhost:1880/api/v2/users \
  -H "Authorization: Bearer $TOKEN"
```

## 📋 APIs Có Thể Call

### Public APIs (Không cần token)
- ❌ Không có - Hầu hết APIs đều cần authentication

### Authenticated APIs (Cần token)
- ✅ `/api/v2/auth/verify` - Verify token
- ✅ `/api/v2/auth/logout` - Logout
- ✅ `/api/v2/auth/me` - Current user info
- ✅ `/api/v2/users/me` - Get current user
- ✅ `/api/v2/users/:userId` - Get user by ID
- ✅ `/api/v2/users/:userId` (PUT) - Update user
- ✅ `/api/v2/thingsboard/rpc/oneway/:id` - ThingsBoard RPC
- ✅ `/api/v2/schedule-monitor/*` - Schedule monitoring
- ✅ `/api/v2/web-notification/*` - Notifications
- ✅ `/api/v2/scheduleLog/*` - Schedule logs
- ✅ `/api/v2/error-notifications/*` - Error notifications
- ✅ `/api/v2/customerUser/:name` (GET/PUT/DELETE) - Customer user operations

### Admin-Only APIs (Cần token + is_admin = 1)
- 🔒 `/api/v2/users` (GET) - List all users
- 🔒 `/api/v2/users` (POST) - Create user
- 🔒 `/api/v2/users/:userId` (DELETE) - Delete user
- 🔒 `/api/v2/users/bulk` - Bulk operations
- 🔒 `/api/v2/health/detailed` - Detailed health check

## 🔐 Security Notes

### ⚠️ QUAN TRỌNG
1. **Đây là user mặc định cho development/testing**
2. **Trong production, phải:**
   - Đổi password ngay sau lần login đầu tiên
   - Hoặc disable/deactivate user này
   - Tạo user riêng với credential mạnh hơn

### Password Security
- ✅ Password được hash bằng bcrypt (salt rounds: 10)
- ✅ KHÔNG lưu plain text trong database
- ✅ AuthService hỗ trợ backward compatibility với nhiều hash methods

## 📦 Files Changed

```
✅ src/modules/viis-rest-api/services/default-user-seed.service.ts (NEW)
✅ src/modules/viis-rest-api/viis-rest-api.ts (UPDATED)
✅ DEFAULT_USER_GUIDE.md (NEW)
✅ IMPLEMENTATION_SUMMARY.md (NEW - this file)
```

## ✅ Build Status
```
✓ npm run build - SUCCESS
✓ No compilation errors
✓ Ready to deploy
```

## 🧪 Testing Checklist

- [ ] Deploy Node-RED
- [ ] Kiểm tra logs có message seed user
- [ ] Test login với email/password mặc định
- [ ] Test token có hoạt động
- [ ] Test call admin API (GET /users)
- [ ] Test call regular API
- [ ] Verify user trong database

## 📝 Next Steps

1. **Deploy và test**:
   ```bash
   # Build
   npm run build
   
   # Restart Node-RED để apply changes
   ```

2. **Kiểm tra logs**:
   - Tìm message "🌱 Checking for default admin user..."
   - Xem có "🎉 Default admin user created successfully!" không

3. **Test login**:
   ```bash
   curl -X POST http://localhost:1880/api/v2/auth/login \
     -H "Content-Type: application/json" \
     -d '{"usr": "fueliot@gmail.com", "pwd": "admin123"}'
   ```

4. **Production deployment**:
   - Đổi password ngay
   - Tạo users khác
   - Consider deactivating default user

## 💡 Tips

- User chỉ được tạo 1 lần (idempotent)
- Restart Node-RED không tạo duplicate
- Nếu muốn reset, xóa record trong database và restart
- Check database với:
  ```sql
  SELECT * FROM tabiot_customer_user WHERE email = 'fueliot@gmail.com';
  ```
