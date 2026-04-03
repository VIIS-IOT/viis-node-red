---
name: viis-node-red-common-pattern
description: "Standard architecture and implementation rules for VIIS Node-RED custom nodes, including global context usage, shared core resources, multi-board Modbus mappings, and RPC fallback behavior."
metadata:
	version: 1.0.0
---

# VIIS Node-RED Common Pattern

Skill document mo ta pattern chung cho custom nodes trong he `viis-node-red`.

## Scope

Ap dung cho toan bo node trong thu muc:

- `/home/phuongtung0801/viis/fe-be/viis-local-docker/services/nodered/custom-nodes/viis-node-red/src/modules`

## Core Rules

Tat ca custom nodes can tuan thu cac quy tac sau:

1. Doc credentials can su dung (device, modbus, database, server, ...) tu global context.
2. Tai su dung common resources trong:
	 - `/home/phuongtung0801/viis/fe-be/viis-local-docker/services/nodered/custom-nodes/viis-node-red/src/core`
3. Uu tien pattern multi-board thong nhat, tranh hardcode logic rieng le.

## Multi-Board Mapping Pattern

Trong da so case, cau hinh su dung `board1`.

Modbus mapping trong global context theo naming convention:

- `modbus_board1_coils`
- `modbus_board1_holding_registers`
- `modbus_board1_input_registers`

Vi du `modbus_board1_coils`:

```json
{
	"lamp_control_1": 1,
	"lamp_control_2": 2,
	"co2_control_valve": 3,
	"humid_control_on": 4,
	"fan_control_intake": 5,
	"freezer_control": 6,
	"fan_control_circ": 7,
	"fan_control_dc": 8,
	"dehumid_control_1": 9,
	"dehumid_control_2": 10,
	"cool_control_ac1": 11,
	"cool_control_ac2": 12,
	"backup_control_1": 13,
	"backup_control_2": 14,
	"backup_control_3": 15,
	"backup_control_4": 16
}
```

## RPC Control Fallback

Lenh RPC control gui den node `viis-rpc-control`.

Neu key khong tim thay trong modbus mapping, he thong ghi vao global context `configKeyValues`.

Vi du `configKeyValues`:

```json
{
	"requestId": "44e0de32-eab6-4735-a26d-1c6fc1dda5dc",
	"lamp-control-a": false,
	"lamp-control-b": false,
	"iri_time": 86399,
	"lamp_protect_max_time_on": 10,
	"lamp_control_1_protect_max_time_on": 4
}
```

## Dependent Node Behavior

Mot so node nhu `viis-device-protection` su dung ket hop:

- `configKeyValues`
- Modbus mapping key address

de xu ly cac logic dac thu.

## Implementation Checklist

Khi tao node moi hoac refactor node cu, can kiem tra:

1. Da lay credentials va config tu global context chua.
2. Da tai su dung service/resource trong `src/core` chua.
3. Da doc mapping theo convention `modbus_board{n}_*` chua.
4. Da xu ly fallback vao `configKeyValues` cho key khong co mapping chua.
5. Da dam bao node khac co the doc duoc state can thiet tu global context chua.
