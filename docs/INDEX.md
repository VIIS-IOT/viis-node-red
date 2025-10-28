# 📚 VIIS Node-RED Documentation Index

**Last Updated**: 2025-01-28

---

## 🚢 Marine IoT System (TFS-Based)

### TFS Accumulation System
- **[TFS Testing Guide](./TFS_TESTING_GUIDE.md)** 📘 (15 min)
  - Complete testing guide for TFS delta-based system
  - Manual testing procedures
  - Database verification steps

- **[TFS Test Summary](./TFS_TEST_SUMMARY.md)** ✅ (5 min)
  - Test results: 51/51 PASS
  - Formula verification
  - Key metrics

- **[TFS Formula Fix](./TFS_FORMULA_FIX.md)** 🔧 (10 min)
  - Modulo 1000 formula correction
  - Before/After comparison
  - Deployment checklist

- **[Integration Test Results](./INTEGRATION_TEST_RESULTS.md)** 🧪 (10 min)
  - Docker MySQL integration tests
  - Database setup guide
  - Test coverage report

### Marine IoT Components
- **[Marine Telemetry Node](./VIIS_MARINE_TELEMETRY_NODE.md)** 📡 (15 min)
  - viis-marine-telemetry node documentation
  - Configuration guide
  - Usage examples

- **[WebSocket API](./MARINE_WEBSOCKET_API.md)** 🔌 (10 min)
  - Real-time data streaming API
  - Event types and formats
  - Client examples

- **[WebSocket Quick Start](./MARINE_WEBSOCKET_QUICKSTART.md)** ⚡ (5 min)
  - Quick setup guide
  - Basic examples
  - Troubleshooting

- **[API Summary](./MARINE_API_SUMMARY.md)** 📋 (5 min)
  - HTTP API endpoints
  - Request/Response formats

### Marine IoT Architecture
- **[Multi-Machine Implementation](./MARINE_IOT_MULTI_MACHINE_IMPLEMENTATION.md)** 🏗️ (10 min)
  - 3-machine support (Generator, Main Engine, Boiler)
  - Independent oil profiles
  - Configuration guide

- **[kg/m³ Standard](./MARINE_IOT_KG_M3_STANDARD.md)** ⚖️ (5 min)
  - SI unit standard
  - No frontend/backend conversion
  - Density handling

---

## 🎯 Error Notification System

### Quick Start
- **[Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)** ⚡ (5 min)
  - Cheat sheet, API nhanh
  - Copy-paste examples
  - Troubleshooting nhanh

- **[Monitor Nodes Usage](./ERROR_MONITOR_NODES_USAGE.md)** 📺 (10 min)
  - viis-error-monitor node
  - viis-warning-monitor node
  - Configuration & examples

### Detailed Guides
- **[README](./ERROR_NOTIFICATION_README.md)** 📖 (10 min)
  - System overview
  - Quick start guide
  - Test results (45/45 passed)

- **[Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)** 📘 (15 min)
  - Step-by-step instructions
  - Code examples
  - Best practices

### Architecture
- **[Architecture](./ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md)** 🏗️ (20 min)
  - System design overview
  - Component details
  - Data flow diagrams

---

## 🔧 Utilities

- **[OR Filtering](./OR_FILTERING.md)** 🔍
  - Query filtering patterns
  - OR condition handling

---

## 🚀 Getting Started Paths

### Marine IoT Development
1. Start: [TFS Testing Guide](./TFS_TESTING_GUIDE.md)
2. Review: [TFS Test Summary](./TFS_TEST_SUMMARY.md)
3. Deploy: [TFS Formula Fix](./TFS_FORMULA_FIX.md)
4. Verify: [Integration Test Results](./INTEGRATION_TEST_RESULTS.md)

### Marine IoT Operations
1. Setup: [Marine Telemetry Node](./VIIS_MARINE_TELEMETRY_NODE.md)
2. Configure: [Multi-Machine Implementation](./MARINE_IOT_MULTI_MACHINE_IMPLEMENTATION.md)
3. Monitor: [WebSocket Quick Start](./MARINE_WEBSOCKET_QUICKSTART.md)

### Error System Development
1. Start: [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)
2. Then: [README](./ERROR_NOTIFICATION_README.md)
3. Deep dive: [Usage Guide](./ERROR_NOTIFICATION_USAGE_GUIDE.md)

---

## 📊 Document Summary

| Document | System | Type | Size | Purpose |
|----------|--------|------|------|---------|
| TFS Testing Guide | Marine | Tutorial | 14KB | Testing procedures |
| TFS Test Summary | Marine | Report | 9KB | Test results |
| TFS Formula Fix | Marine | Technical | 7KB | Formula correction |
| Integration Tests | Marine | Report | 7KB | DB integration |
| Marine Telemetry | Marine | Reference | 14KB | Node documentation |
| WebSocket API | Marine | API | 12KB | Real-time API |
| Multi-Machine | Marine | Architecture | 4KB | System design |
| Error Quick Ref | Error | Cheat Sheet | 5KB | Quick lookup |
| Error README | Error | Overview | 15KB | System overview |
| Error Usage | Error | Tutorial | 16KB | Detailed guide |
| Architecture | Error | Technical | 24KB | System design |

---

## 🔗 Related Files

### Marine IoT Source
```
src/
├── modules/viis-marine-telemetry/
│   ├── viis-marine-telemetry-processor.ts  # TFS parsing
│   └── __tests__/
│       ├── tfs-parsing.test.ts             # 23/23 PASS
│       └── tfs-e2e.test.ts                 # 10/10 PASS
├── services/MarineIoT/
│   ├── FlowAccumulationService.ts
│   ├── FlowCheckpointService.ts
│   └── __tests__/
│       ├── FlowAccumulationService.test.ts # 11/11 PASS
│       └── FlowCheckpointService.test.ts   # 7/7 PASS
```

### Error System Source
```
src/
├── services/
│   ├── error-mapping.service.ts
│   ├── error-notification.service.ts
│   └── __tests__/
│       ├── error-mapping.service.test.ts
│       └── error-notification.service.test.ts
```

### Tests
```bash
# TFS tests
npm test -- --testPathPattern="(tfs|FlowCheckpoint|FlowAccumulation)"

# Error tests
npm test -- --testPathPattern="error"

# All tests
npm test
```

---

## 📁 Archived Documentation

Outdated documentation (pre-TFS implementation) moved to `archived/`:
- MARINE_IOT_README.md
- MARINE_IOT_SUMMARY.md
- MARINE_IOT_OVERVIEW.md
- MARINE_IOT_SYSTEM_ANALYSIS.md
- MARINE_IOT_TESTING.md
- MARINE_IOT_USAGE_GUIDE.md

**Note**: These docs describe old flow-rate based logic. Current system uses TFS delta-based calculation.

---

## 📞 Quick Links

- **Marine IoT**: Start → [TFS Testing Guide](./TFS_TESTING_GUIDE.md)
- **Error System**: Start → [Quick Reference](./ERROR_NOTIFICATION_QUICK_REFERENCE.md)
- **WebSocket**: Start → [Quick Start](./MARINE_WEBSOCKET_QUICKSTART.md)
- **Test Results**: [Integration Tests](./INTEGRATION_TEST_RESULTS.md)

---

**Made with ❤️ by VIIS Team**
