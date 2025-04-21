import { applyScaling, ScaleConfig } from '../viis-telemetry-utils';

/**
 * Unit test for applyScaling function.
 */
describe('applyScaling', (): void => {
  const scaleConfigs: ReadonlyArray<ScaleConfig> = [
    { key: 'temp', operation: 'multiply', factor: 2, direction: 'read' },
    { key: 'pressure', operation: 'divide', factor: 10, direction: 'read' },
  ];

  it('should multiply value correctly', (): void => {
    expect(applyScaling('temp', 10, 'read', scaleConfigs as ScaleConfig[])).toBe(20);
  });

  it('should divide value correctly', (): void => {
    expect(applyScaling('pressure', 100, 'read', scaleConfigs as ScaleConfig[])).toBe(10);
  });

  it('should return value unchanged if no config found', (): void => {
    expect(applyScaling('humidity', 50, 'read', scaleConfigs as ScaleConfig[])).toBe(50);
  });
});