# Changelog

## [1.0.4] - 2025-01-30

### Fixed
- **RPC Control**: Removed unwanted `note: "Config key updated (no Modbus mapping)"` from MQTT messages
  - Config parameters without Modbus mapping now publish clean messages without the note field
  - All other functionality remains unchanged
  - Example before: `{"ts":123,"key":"value","note":"Config key updated (no Modbus mapping)"}`
  - Example after: `{"ts":123,"key":"value"}`

### Technical Details
- Modified `RpcHandler.handleConfigOnlyParameter()` to call `publishConfigUpdate()` without the note parameter
- The `publishConfigUpdate()` method already had proper logic to only include note when provided
- No breaking changes to existing functionality

### Impact
- Cleaner MQTT messages for config-only parameters
- Reduced message size and noise in MQTT broker
- Better user experience with less confusing messages
