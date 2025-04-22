import { applyScaling, ScaleConfig } from '../viis-telemetry-utils';

describe('Update scale config', (): void => {
  it('should use only the new scale config after update', (): void => {
    let scaleConfigs: ScaleConfig[] = [
      { key: 'temp', operation: 'multiply', factor: 2, direction: 'read' },
    ];
    // Lần đầu scale
    expect(applyScaling('temp', 10, 'read', scaleConfigs)).toBe(20);

    // Update config
    scaleConfigs = [
      { key: 'temp', operation: 'multiply', factor: 3, direction: 'read' },
    ];
    // Scale lại phải ra kết quả mới (không xen kẽ)
    expect(applyScaling('temp', 10, 'read', scaleConfigs)).toBe(30);
  });
});
