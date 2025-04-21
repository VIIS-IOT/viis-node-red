import { debugLog } from '../viis-telemetry-utils';

describe('debugLog', (): void => {
  it('should call node.warn if enabled', (): void => {
    const node = { warn: jest.fn() };
    debugLog({ enable: true, node, message: 'debug' });
    expect(node.warn).toHaveBeenCalledWith('debug');
  });

  it('should NOT call node.warn if disabled', (): void => {
    const node = { warn: jest.fn() };
    debugLog({ enable: false, node, message: 'debug' });
    expect(node.warn).not.toHaveBeenCalled();
  });
});
