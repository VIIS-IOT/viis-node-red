# 📚 VIIS Node-RED Documentation Index

**Last Updated**: 2025-10-17

---

## 🎯 Error Notification System

### Quick Start
- **[Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)** ⚡ (5 min)
  - Cheat sheet, API nhanh
  - Copy-paste examples
  - Troubleshooting nhanh

### Detailed Guides
- **[README](./ERROR_NOTIFICATION_README.md)** 📖 (10 min)
  - Tổng quan hệ thống
  - Quick start 5 phút
  - Test results (45/45 passed)
  - API reference đầy đủ

- **[Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)** 📘 (15 min)
  - Hướng dẫn từng bước chi tiết
  - Code examples đầy đủ
  - Best practices
  - Real-world examples

### Architecture
- **[Architecture](./ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)** 🏗️ (20 min)
  - System design overview
  - Component details
  - Data flow diagrams
  - Migration path

---

## 🔧 System Components

### Environment Management
- **[Env-Loader Plan](./EXTEND_ENV_LOADER_PLAN.md)** ⚙️
  - Hot-reload system
  - Global context management
  - Error code mappings

### Data Filtering
- **[OR Filtering](./OR_FILTERING.md)** 🔍
  - Query filtering patterns
  - OR condition handling

---

## 🚀 Getting Started Path

### New Users (Beginner)
1. Start: [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)
2. Then: [README](./ERROR_NOTIFICATION_README.md)
3. Finally: [Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)

### Experienced Developers
1. Start: [README](./ERROR_NOTIFICATION_README.md)
2. Deep dive: [Architecture](./ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)
3. Reference: [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)

### System Administrators
1. [Env-Loader Plan](./EXTEND_ENV_LOADER_PLAN.md)
2. [Architecture](./ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)
3. [Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)

---

## 📊 Document Summary

| Document | Type | Size | Read Time | Purpose |
|----------|------|------|-----------|---------|
| Quick Reference | Cheat Sheet | 5KB | 2 min | Quick API lookup |
| README | Overview | 15KB | 10 min | System overview |
| Usage Guide | Tutorial | 16KB | 15 min | Detailed usage |
| Architecture | Technical | 24KB | 20 min | System design |
| Env-Loader Plan | Technical | 24KB | 20 min | Hot-reload system |
| OR Filtering | Reference | 4KB | 5 min | Query patterns |

---

## 🔗 Related Files

### Source Code
```
src/
├── services/
│   ├── error-mapping.service.ts
│   ├── error-notification.service.ts
│   └── __tests__/
│       ├── error-mapping.service.test.ts
│       ├── error-notification.service.test.ts
│       └── integration/
│           └── error-notification.integration.test.ts
```

### Configuration
```
/services/env/error-codes/
├── climate-controller.json
├── irrigation-system.json
└── default.json
```

### Tests
```bash
# Unit tests (mocked)
npm test

# Integration tests (real database)
npm run test:integration

# All tests
npm run test:all
```

---

## 📞 Quick Links

- **Error Notification**: Start → [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)
- **System Architecture**: [Architecture](./ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)
- **Env Management**: [Env-Loader](./EXTEND_ENV_LOADER_PLAN.md)

---

**Made with ❤️ by VIIS Team**
