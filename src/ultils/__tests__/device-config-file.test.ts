import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getDeviceConfigFileValue,
  resetDeviceConfigFileCache,
} from '../device-config-file';
import { getEnvVar, loadDeviceCredentials } from '../env-helper';
import { GlobalContextHelper } from '../global-context-helper';

/**
 * Regression: Node-RED persists global context to disk (localfilesystem). After device1.json
 * is swapped to another device and the container restarts, nodes start before env-loader
 * re-populates global context and used to pick up the PREVIOUS device id/token from the
 * persisted store. The config file must win for identity and broker keys.
 */
describe('device config file is the source of truth for identity keys', () => {
  let dir: string;
  let devicePath: string;
  let commonPath: string;
  const savedEnv = { ...process.env };

  const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
  const globalStore = (values: Record<string, unknown>) => {
    const store: Record<string, unknown> = { ...values };
    return { global: { get: (k: string) => store[k], set: (k: string, v: unknown) => { store[k] = v; } } };
  };
  const staleContext = () => globalStore({
    device_id: 'old-device',
    device_access_token: 'old-token',
    thingsboard_host: 'old-host',
    device_label: 'Old label',
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viis-device-config-'));
    devicePath = path.join(dir, 'device1.json');
    commonPath = path.join(dir, 'common.json');
    process.env.ENV_LOADER_JSON_CONFIG_PATH = devicePath;
    process.env.ENV_LOADER_COMMON_JSON_CONFIG_PATH = commonPath;
    delete process.env.VIIS_CONFIG_FILE_FIRST;
    delete process.env.DEVICE_ID;
    delete process.env.DEVICE_ACCESS_TOKEN;
    resetDeviceConfigFileCache();
    writeJson(devicePath, {
      deviceIdentity: { DEVICE_ID: 'new-device', DEVICE_ACCESS_TOKEN: 'new-token', DEVICE_LABEL: 'New label' },
      modbusBoards: [],
    });
    writeJson(commonPath, {
      result: { backendServices: { THINGSBOARD_HOST: 'device.example', THINGSBOARD_PORT: '11883' } },
    });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    resetDeviceConfigFileCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads identity from device1.json and broker keys from common.json', () => {
    expect(getDeviceConfigFileValue('DEVICE_ID')).toBe('new-device');
    expect(getDeviceConfigFileValue('DEVICE_ACCESS_TOKEN')).toBe('new-token');
    expect(getDeviceConfigFileValue('THINGSBOARD_HOST')).toBe('device.example');
    expect(getDeviceConfigFileValue('THINGSBOARD_PORT')).toBe('11883');
  });

  it('device1.json overrides common.json for the same key', () => {
    writeJson(devicePath, {
      deviceIdentity: { DEVICE_ID: 'new-device', DEVICE_ACCESS_TOKEN: 'new-token' },
      backendServices: { THINGSBOARD_HOST: 'device-specific.example' },
    });
    resetDeviceConfigFileCache();
    expect(getDeviceConfigFileValue('THINGSBOARD_HOST')).toBe('device-specific.example');
  });

  it('does not serve keys outside the identity/broker allowlist', () => {
    writeJson(devicePath, {
      deviceIdentity: { DEVICE_ID: 'new-device' },
      database: { DATABASE_PASSWORD: 'secret' },
    });
    resetDeviceConfigFileCache();
    expect(getDeviceConfigFileValue('DATABASE_PASSWORD')).toBeUndefined();
  });

  it('env-helper getEnvVar and loadDeviceCredentials prefer the file over stale global context', () => {
    const ctx = staleContext();
    expect(getEnvVar(ctx, 'DEVICE_ID')).toBe('new-device');
    expect(getEnvVar(ctx, 'THINGSBOARD_HOST')).toBe('device.example');
    expect(loadDeviceCredentials(ctx)).toEqual({ deviceId: 'new-device', accessToken: 'new-token' });
  });

  it('explicit UI values still win over the file', () => {
    expect(loadDeviceCredentials(staleContext(), 'ui-device', 'ui-token'))
      .toEqual({ deviceId: 'ui-device', accessToken: 'ui-token' });
  });

  it('GlobalContextHelper.getEnvVar prefers the file over stale global context', () => {
    const helper = new GlobalContextHelper(staleContext() as any);
    expect(helper.getEnvVar('DEVICE_ID')).toBe('new-device');
    expect(helper.getEnvVar('DEVICE_ACCESS_TOKEN')).toBe('new-token');
    expect(helper.getEnvVar('DEVICE_LABEL')).toBe('New label');
  });

  it('picks up a rewritten device1.json without a restart', () => {
    expect(getDeviceConfigFileValue('DEVICE_ID')).toBe('new-device');
    writeJson(devicePath, { deviceIdentity: { DEVICE_ID: 'newer-device-with-longer-id', DEVICE_ACCESS_TOKEN: 't' } });
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(devicePath, future, future);
    resetDeviceConfigFileCache({ keepParsed: true });
    expect(getDeviceConfigFileValue('DEVICE_ID')).toBe('newer-device-with-longer-id');
  });

  it('falls back to global context when the file is missing or unreadable', () => {
    fs.rmSync(devicePath);
    fs.writeFileSync(commonPath, '{ not json');
    resetDeviceConfigFileCache();
    const ctx = staleContext();
    expect(getEnvVar(ctx, 'DEVICE_ID')).toBe('old-device');
    expect(new GlobalContextHelper(ctx as any).getEnvVar('DEVICE_ID')).toBe('old-device');
  });

  it('VIIS_CONFIG_FILE_FIRST=false restores the old global-context-first order', () => {
    process.env.VIIS_CONFIG_FILE_FIRST = 'false';
    resetDeviceConfigFileCache();
    expect(getEnvVar(staleContext(), 'DEVICE_ID')).toBe('old-device');
  });
});
