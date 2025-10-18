# Default Admin User Guide

## 📋 Thông Tin User Mặc Định

Hệ thống sẽ tự động tạo một admin user mặc định khi khởi động lần đầu:

### Thông Tin Đăng Nhập
- **Email**: `fueliot@gmail.com`
- **Password**: `admin123`
- **Quyền**: Full Admin (có thể call mọi API)

## 🚀 Cách Hoạt Động

### 1. Tự Động Seed
Khi VIIS REST API node khởi động, hệ thống sẽ:
- Kiểm tra xem user `fueliot@gmail.com` đã tồn tại chưa
- Nếu chưa tồn tại, tạo mới user với:
  - Customer User record trong bảng `tabiot_customer_user`
  - Credentials record trong bảng `tabiot_customer_user_credentials`
  - Password được hash bằng bcrypt (salt rounds: 10)
  - is_admin = 1 (full admin permissions)

### 2. Log Messages
Khi seed user thành công, bạn sẽ thấy logs:
```
🌱 Checking for default admin user...
🔧 Creating default admin user: fueliot@gmail.com
✅ Created customer user: user-{uuid}
✅ Created user credentials for: user-{uuid}
🎉 Default admin user created successfully!
   📧 Email: fueliot@gmail.com
   🔑 Password: admin123
   👤 User ID: user-{uuid}
⚠️  Please change the default password after first login!
```

Nếu user đã tồn tại:
```
✅ Default admin user already exists: fueliot@gmail.com
```

## 🔐 Sử Dụng User

### 1. Login via API
```bash
curl -X POST http://localhost:1880/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "usr": "fueliot@gmail.com",
    "pwd": "admin123"
  }'
```

Response:
```json
{
  "result": {
    "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "user_id": "user-xxx-xxx-xxx",
      "email": "fueliot@gmail.com",
      "first_name": "FuelIoT",
      "last_name": "Admin",
      "is_admin": 1,
      ...
    }
  }
}
```

### 2. Sử Dụng Token
Sau khi login, sử dụng token trong header:
```bash
curl -X GET http://localhost:1880/api/v2/users \
  -H "Authorization: Bearer {token}"
```

### 3. Access Control
User này có full admin permissions, có thể:
- ✅ Call tất cả API endpoints
- ✅ Tạo, sửa, xóa users
- ✅ Tạo, sửa, xóa devices
- ✅ Access admin-only endpoints như `/health/detailed`
- ✅ Thực hiện bulk operations
- ✅ Quản lý schedules, notifications, errors

## 📁 File Implementation

### 1. Default User Seed Service
**File**: `src/modules/viis-rest-api/services/default-user-seed.service.ts`

Chức năng:
- Kiểm tra user tồn tại
- Tạo customer user với is_admin = 1
- Hash password bằng bcrypt
- Tạo credentials record

### 2. Integration
**File**: `src/modules/viis-rest-api/viis-rest-api.ts`

Seed service được gọi tự động trong quá trình initialization:
```typescript
// Seed default admin user if not exists
try {
    const seedService = new DefaultUserSeedService(databaseService, node);
    await seedService.seedDefaultUser();
} catch (error) {
    logger.warn(node, `Failed to seed default user: ${(error as Error).message}`);
    // Continue execution even if seeding fails
}
```

## 🔒 Bảo Mật

### ⚠️ QUAN TRỌNG
1. **Đổi password ngay sau lần đăng nhập đầu tiên**
2. Password mặc định chỉ dùng cho development/testing
3. Trong production, nên:
   - Disable auto-seed hoặc
   - Đổi password ngay lập tức
   - Tạo user riêng và deactivate user mặc định

### Password Storage
- Password được hash bằng **bcrypt** với salt rounds = 10
- **KHÔNG lưu plain text**
- AuthService hỗ trợ nhiều hash methods (bcrypt, MD5, SHA256) để backward compatibility

## 🧪 Testing

### Test Login
```bash
# Test login
curl -X POST http://localhost:1880/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "usr": "fueliot@gmail.com",
    "pwd": "admin123"
  }'
```

### Test Admin Access
```bash
# Get all users (admin only)
curl -X GET http://localhost:1880/api/v2/users \
  -H "Authorization: Bearer {token}"

# Get detailed health (admin only)
curl -X GET http://localhost:1880/api/v2/health/detailed \
  -H "Authorization: Bearer {token}"
```

## 🛠️ Troubleshooting

### User không được tạo
1. Kiểm tra database connection
2. Xem logs trong Node-RED debug
3. Kiểm tra permissions trên database

### Không login được
1. Kiểm tra email/password đúng chưa
2. Xem user có is_deactivated = 0
3. Xem credentials có enable = 1
4. Kiểm tra JWT secret trong config

### Database Schema
```sql
-- Customer User
SELECT * FROM tabiot_customer_user WHERE email = 'fueliot@gmail.com';

-- Credentials
SELECT tcu.email, tcuc.enable, tcuc.user_id 
FROM tabiot_customer_user_credentials tcuc
JOIN tabiot_customer_user tcu ON tcuc.user_id = tcu.name
WHERE tcu.email = 'fueliot@gmail.com';
```

## 📝 Notes

- User chỉ được tạo nếu chưa tồn tại (idempotent)
- Seed process không throw error nếu fail (system continues)
- User ID được generate bằng UUID v4
- Credential ID cũng được generate bằng UUID v4
