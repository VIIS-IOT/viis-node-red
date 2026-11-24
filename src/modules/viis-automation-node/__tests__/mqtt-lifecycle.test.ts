import {EventEmitter} from 'events';
import {MqttAutomationService} from '../services/mqttService';
describe('automation service owns listeners, registry owns sockets',()=>{
 function setup(){const n:any={id:'auto',log:jest.fn(),debug:jest.fn(),warn:jest.fn(),error:jest.fn()};const service=new MqttAutomationService({node:n} as any);const client:any=new EventEmitter();Object.assign(client,{waitForConnection:jest.fn().mockResolvedValue(undefined),subscribe:jest.fn().mockResolvedValue(undefined),disconnect:jest.fn()});return {service,client};}
 it('cleanup detaches only own handler without disconnecting a shared socket',async()=>{
  const {service,client}=setup();const other=jest.fn();client.on('mqtt-message',other);
  await service.initialize(client,'v1/devices/me/rpc/request/+',jest.fn());expect(client.listenerCount('mqtt-message')).toBe(2);
  service.cleanup();expect(client.listenerCount('mqtt-message')).toBe(1);expect(client.disconnect).not.toHaveBeenCalled();
 });
 it('does not reattach after cleanup occurs while initialize is awaiting connection',async()=>{
  const {service,client}=setup();let finish!:()=>void;client.waitForConnection.mockImplementation(()=>new Promise<void>(r=>{finish=r}));
  const p=service.initialize(client,'v1/devices/me/rpc/request/+',jest.fn());service.cleanup();finish();await expect(p).rejects.toThrow(/closed|disposed/i);expect(client.listenerCount('mqtt-message')).toBe(0);
 });
 it('retries initialize without accumulating duplicate ingress handlers',async()=>{
  const {service,client}=setup();await service.initialize(client,'rpc/+',jest.fn());await service.initialize(client,'rpc/+',jest.fn());expect(client.listenerCount('mqtt-message')).toBe(1);service.cleanup();
 });
});
