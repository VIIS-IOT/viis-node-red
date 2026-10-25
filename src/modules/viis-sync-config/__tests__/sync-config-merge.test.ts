import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupConfig, mergeGatewayOwned, refuseDownloadedConfig } from '../sync-config-merge';

const local = {
    deviceIdentity: { DEVICE_ID: 'dev-1', DEVICE_ACCESS_TOKEN: 't' },
    modbusBoards: [{ id: 'board1' }],
    modbusMappings: { board1: { coils: { valve_1: {} } } },
    actuatorPolicy: { valve_1: 'managed' },
    featureFlags: { ARBITER_MODE: 'enforce', EVENT_OUTBOX_ENABLED: 'true', ARBITER_MANUAL_LEASE_S: '60' },
};

describe('refuseDownloadedConfig', () => {
    test('another device id is refused', () => {
        const downloaded = { ...local, deviceIdentity: { DEVICE_ID: 'dev-2', DEVICE_ACCESS_TOKEN: 'x' } };
        expect(refuseDownloadedConfig(downloaded, local, 'dev-1')).toBe('config_device_mismatch');
    });

    test('a download without the boards or Modbus mapping the file has is refused', () => {
        const projection = { deviceIdentity: local.deviceIdentity, featureFlags: {} };
        expect(refuseDownloadedConfig(projection, local, 'dev-1')).toBe('config_incomplete');
        expect(refuseDownloadedConfig({ ...local, modbusMappings: {} }, local, 'dev-1')).toBe('config_incomplete');
    });

    test('a complete download for this device passes; a bare local file accepts any complete-enough download', () => {
        expect(refuseDownloadedConfig({ ...local }, local, 'dev-1')).toBeNull();
        expect(refuseDownloadedConfig({ deviceIdentity: local.deviceIdentity }, { deviceIdentity: local.deviceIdentity }, 'dev-1')).toBeNull();
    });
});

describe('mergeGatewayOwned', () => {
    const downloaded = {
        deviceIdentity: local.deviceIdentity,
        modbusBoards: [{ id: 'board1' }, { id: 'board2' }],
        featureFlags: { ARBITER_MANUAL_LEASE_S: '1800', SOME_NEW_FLAG: 'x', ARBITER_MODE: 'off' },
    };

    test('keeps the local actuatorPolicy and local flags; the download adds what is missing and sets the lease', () => {
        const merged = mergeGatewayOwned(downloaded, local);
        expect(merged.actuatorPolicy).toEqual(local.actuatorPolicy);
        expect(merged.modbusBoards).toHaveLength(2);
        expect(merged.featureFlags).toEqual({
            ARBITER_MODE: 'off', // the download sets it
            EVENT_OUTBOX_ENABLED: 'true', // only local
            ARBITER_MANUAL_LEASE_S: '1800', // the lease follows the download (profile ceiling / cloud device override)
            SOME_NEW_FLAG: 'x',
        });
    });

    test('a download without a lease removes the local one (cleared profile ceiling); no local file → download as is', () => {
        const noLease = { ...downloaded, featureFlags: { ARBITER_MODE: 'off' } };
        const merged = mergeGatewayOwned(noLease, local);
        expect(merged.featureFlags.ARBITER_MANUAL_LEASE_S).toBeUndefined();
        expect(merged.featureFlags.EVENT_OUTBOX_ENABLED).toBe('true');
        expect(mergeGatewayOwned(downloaded, null)).toBe(downloaded);
    });
});

describe('backupConfig', () => {
    test('timestamped backups, newest five kept, foreign .bak files untouched', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-config-'));
        try {
            const file = path.join(dir, 'device1.json');
            fs.writeFileSync(file, '{}');
            fs.writeFileSync(`${file}.bak`, 'old');
            for (let i = 0; i < 7; i++) backupConfig(file, new Date(Date.UTC(2026, 9, 25, 10, i)));

            const names = fs.readdirSync(dir).filter((n) => n !== 'device1.json').sort();
            expect(names).toContain('device1.json.bak');
            const stamped = names.filter((n) => n !== 'device1.json.bak');
            expect(stamped).toHaveLength(5);
            expect(stamped[0]).toBe('device1.json.2026-10-25T10-02-00-000Z.bak');
            expect(stamped[4]).toBe('device1.json.2026-10-25T10-06-00-000Z.bak');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
