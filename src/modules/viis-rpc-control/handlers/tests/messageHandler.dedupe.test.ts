import { DiagnosticLogger } from '../../../../core/observability/diagnostic-logger';
import { MessageHandler } from '../messageHandler';

const ID_A = '11111111-2222-4333-8444-555555555555';
const ID_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const PREFIX = 'v1/devices/me/rpc/request/+';

function node() {
  return { id: 'rpc-node', log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn() };
}

function msg(topicId: string, payload: Record<string, unknown>) {
  return { topic: `v1/devices/me/rpc/request/${topicId}`, message: JSON.stringify(payload) };
}

describe('MessageHandler dedupe (port from demeter-nodered d2b2adc)', () => {
  let events: Array<{ event: string; fields: any }>;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    events = [];
    spy = jest.spyOn(DiagnosticLogger.prototype, 'emit').mockImplementation(function (_level: any, event: string, fields: any = {}) {
      events.push({ event, fields });
    });
  });
  afterEach(() => {
    spy.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('processes the same params again when the command_id is new (legit re-send within 10s)', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();

    mh.processMqttMessage(msg('1', { method: 'set_state', command_id: ID_A, params: { digital_out_2: false } }), PREFIX, processor);
    jest.advanceTimersByTime(2000);
    mh.processMqttMessage(msg('2', { method: 'set_state', command_id: ID_B, params: { digital_out_2: false } }), PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('processes the same params again when only the MQTT request id in the topic differs', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const payload = { method: 'set_state', params: { valve_1: true } };

    mh.processMqttMessage(msg('41', payload), PREFIX, processor);
    jest.advanceTimersByTime(3000);
    mh.processMqttMessage(msg('42', payload), PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('drops an exact redelivery of the same command for 60s and reports it as duplicate by command_id', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const m = msg('7', { method: 'set_state', command_id: ID_A, params: { digital_out_2: true } });

    mh.processMqttMessage(m, PREFIX, processor);
    jest.advanceTimersByTime(30000);
    mh.processMqttMessage(m, PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(1);
    const dup = events.find(e => e.event === 'rpc.duplicate');
    expect(dup?.fields).toEqual(expect.objectContaining({ dedupBy: 'command_id', dedupTtlMs: 60000 }));

    jest.advanceTimersByTime(30001);
    mh.processMqttMessage(m, PREFIX, processor);
    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('does not treat a recycled numeric request id with different params as duplicate', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();

    mh.processMqttMessage(msg('1', { method: 'set_state', params: { valve_1: true } }), PREFIX, processor);
    mh.processMqttMessage(msg('1', { method: 'set_state', params: { valve_1: false } }), PREFIX, processor);

    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('keeps the legacy params-hash dedupe (10s) for messages without any id', () => {
    const mh = new MessageHandler({ node: node() } as any);
    const processor = jest.fn();
    const payload = { method: 'set_state', params: { a: 1 } };

    mh.processMessage(payload, processor);
    mh.processMessage(payload, processor);
    jest.advanceTimersByTime(10001);
    mh.processMessage(payload, processor);

    expect(processor).toHaveBeenCalledTimes(2);
    expect(events.find(e => e.event === 'rpc.duplicate')?.fields).toEqual(expect.objectContaining({ dedupBy: 'params', dedupTtlMs: 10000 }));
  });
});
