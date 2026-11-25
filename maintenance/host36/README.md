# Host 36 RPC and schedule synchronization repair

This branch contains the MQTT identity isolation required by the legacy dual-identity flow, RPC initialization that continues while the Modbus transport reconnects, and the three saved-flow function replacements in this directory. The flow patch is a separate deployment artifact; installing the custom-node package alone does not apply it.

## Behavior

- Each cloud broker/authentication identity gets its own shared MQTT client; closing a node releases its own client lease and listener.
- RPC attaches MQTT ingress even when the board is offline during boot. The existing Modbus transport handles reconnection independently. Startup never issues a test actuator write.
- Schedule/plan SQL builders normalize ISO datetime values before MySQL writes. ISO Z uses UTC components, naive SQL clock values remain unchanged, fractions retain up to six digits, and DATE fields retain their calendar date. There is no additional UTC+7 adjustment.
- Invalid temporal input rejects the list before query emission. Existing-record comparison keeps microsecond precision. Stale-record sync bookkeeping explicitly preserves modified to prevent MySQL ON UPDATE timestamp drift.
- Schedule times, intervals, enables, actions and register mappings are not changed by this patch. No missed-run catch-up or new app-level synchronization ACK protocol is introduced.

## Offline verification

From the repository root:

```sh
npm run test:host36-schedule-sync
```

No database, Node-RED, network or extra dependencies are needed. The runner checks original function hashes and compiles all replacements, then runs 132 behavioral cases in each of UTC, Asia/Ho_Chi_Minh and America/New_York. Tests cover both distinct schedule records, timezone offsets, malformed dates, null/Date inputs, fractional precision, batch validation and stale-version handling.

The source regression test for offline boot is src/modules/viis-rpc-control/tests/startup-offline-recovery.test.ts. It runs the real node factory and RPC/Modbus services with fake transport/MQTT boundaries; it checks command receipt, exact mapped coil write/readback, publication acknowledgement, lease release and default-board reload.

## Flow application

datetime-patch.json maps three existing Node-RED function IDs to replacement bodies. datetime-baseline-hashes.json records the expected original SHA-256 hash for each func. Take a protected full-flow/credentials backup, verify all three hashes, then replace only those func properties. Preserve node IDs, wires, configuration and credentials. If an original hash differs, inspect the local customization instead of overwriting it. Reload using the site's normal maintenance procedure, with no active schedule interrupted.

original.json contains only the three original function bodies and names for deterministic patch generation/testing. Rebuild using node maintenance/host36/datetime-build.cjs, then run the offline verification. No full device flow, env, token, deployment backup or operational log is included.

datetime-mysql.cjs is an optional operator integration probe, run explicitly inside the existing Node-RED container with mysql2 available and the site's existing common.json database configuration. It loads the staged function mapping, or the saved deployed functions with --deployed. All emitted writes are rewritten to connection-local TEMPORARY tables; real target rows are only read for a before/after digest. It never sends MQTT or actuator commands. Do not use it as a general deployment script.

## Validation and limits

Validated on 25 November 2026: 132 cases in each of three timezones; 19 checks using actual MySQL temporary tables and deployed function bodies; 21 exact-runtime JavaScript cases across MQTT identity/lifecycle, RPC and schedule compatibility. User app commands were traced through write/readback and acknowledged delivery; plan resynchronization completed without datetime errors.

The full npm test command was attempted with one worker and a 240-second limit: 48 suites completed PASS before the process was terminated by the bound. This is not a full-suite pass. Untouched upstream also has the previously observed EC-control TypeScript error; the deployed RPC module was transpiled with project compiler options while preserving the other official runtime artifacts. Future scheduled execution and a real cold-start outage were not triggered during acceptance.
