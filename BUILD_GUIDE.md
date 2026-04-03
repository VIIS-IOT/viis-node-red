# Build Guide - VIIS Node-RED Custom Nodes

## Cross-Platform Build Setup

Dự án này đã được cấu hình để hỗ trợ build trên cả Windows và Linux/macOS.

### Yêu cầu
- Node.js >= 14
- npm >= 6

### Cài đặt Dependencies
```bash
npm install
```

### Build Commands

#### Build (Cross-platform)
```bash
npm run build
```

Script này sử dụng:
- `rimraf`: Xóa thư mục dist (thay thế cho `rm -rf`)
- `copyfiles`: Copy files cross-platform (thay thế cho `cp` và `find`)
- `tsc`: TypeScript compiler

**Lưu ý**: Script này hoạt động trên cả Windows, Linux và macOS.

### Cấu trúc sau khi build
```
dist/
├── configs/
├── core/
├── modules/
│   ├── viis-modbus-flex/
│   │   ├── viis-modbus-flex.js
│   │   ├── viis-modbus-flex.html
│   │   └── ...
│   └── ...
├── icons/ (PNG files)
├── *.js (compiled TypeScript)
└── *.html (Node-RED UI files)
```

### Troubleshooting

#### Windows
- Đảm bảo PowerShell execution policy cho phép chạy scripts
- Nếu gặp lỗi với npm scripts, thử chạy từ Command Prompt thay vì PowerShell

#### Linux/macOS
- Đảm bảo có quyền execute cho npm scripts
- Có thể cần `sudo` cho global installs

### Development

Để phát triển:
1. Chỉnh sửa files trong `src/`
2. Chạy `npm run build` để compile
3. Test trong Node-RED environment

### Dependencies được thêm cho Cross-platform
- `rimraf`: ^3.0.2 - Cross-platform rm -rf
- `copyfiles`: ^2.4.1 - Cross-platform file copying
