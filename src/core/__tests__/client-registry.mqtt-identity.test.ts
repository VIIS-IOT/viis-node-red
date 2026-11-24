import type { Node } from 'node-red';
jest.mock('../mqtt-client', () => {
 const { EventEmitter }=require('events');
 return { MqttClientCore: jest.fn().mockImplementation((config) => {
  const client=new EventEmitter(); Object.assign(client,{config,waitForConnection:jest.fn().mockResolvedValue(undefined),isConnected:jest.fn(()=>true),disconnect:jest.fn(),resetCircuitBreaker:jest.fn()});return client;
 })};
});
jest.mock('../mysql-client',()=>({MySqlClientCore:jest.fn()}));
jest.mock('../modbus-client',()=>({ModbusClientCore:jest.fn()}));
const node=(id:string)=>({id,log:jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn(),status:jest.fn()} as unknown as Node);
const cfg=(username:string,password='',broker='mqtt://cloud:1883')=>({broker,username,password,qos:1 as const});
describe('cloud MQTT identity isolation',()=>{
 let registry:any;
 beforeEach(()=>{jest.useFakeTimers();jest.resetModules();registry=require('../client-registry').default;});
 afterEach(()=>{registry.resetForTests();jest.clearAllTimers();jest.useRealTimers();});
 it.each([['automation','rpc'],['rpc','automation']])('isolates identity when %s starts first',async(first,second)=>{
  const a=await registry.getThingsboardMqttClient(cfg(first),node(first));const b=await registry.getThingsboardMqttClient(cfg(second),node(second));
  expect(a).not.toBe(b);expect(a.config.username).toBe(first);expect(b.config.username).toBe(second);
 });
 it('reuses same identity, normalizes broker host/default port and releases only at last owner',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A','','mqtt://CLOUD'),node('a'));
  const b=await registry.getThingsboardMqttClient(cfg('A'),node('b'));expect(a).toBe(b);
  registry.releaseClient('thingsboard',node('a'));expect(a.disconnect).not.toHaveBeenCalled();
  registry.releaseClient('thingsboard',node('b'));expect(a.disconnect).toHaveBeenCalledTimes(1);
  expect(registry.recoveryTimer).toBeNull();
 });
 it('isolates different passwords and brokers; keeps secret out of pool keys',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A','TOP_SECRET'),node('a'));
  const b=await registry.getThingsboardMqttClient(cfg('A','OTHER_SECRET'),node('b'));
  const c=await registry.getThingsboardMqttClient(cfg('A','TOP_SECRET','mqtt://other:1883'),node('c'));
  expect(new Set([a,b,c]).size).toBe(3);
  expect(JSON.stringify([...registry.thingsboardMqttPool.keys()])).not.toMatch(/SECRET|cloud|other/);
 });
 it('does not disconnect other identities; repeated acquire/release is idempotent per node',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A'),node('a'));
  await registry.getThingsboardMqttClient(cfg('A'),node('a'));
  const b=await registry.getThingsboardMqttClient(cfg('B'),node('b'));
  registry.releaseClient('thingsboard',node('a'));registry.releaseClient('thingsboard',node('a'));
  expect(a.disconnect).toHaveBeenCalledTimes(1);expect(b.disconnect).not.toHaveBeenCalled();expect(registry.referenceCount.thingsboard).toBe(1);
 });
 it('recovers every disconnected identity and clears all clients/timers on test reset',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A'),node('a'));const b=await registry.getThingsboardMqttClient(cfg('B'),node('b'));
  a.isConnected.mockReturnValue(false);b.isConnected.mockReturnValue(false);registry.performHealthCheck();
  expect(a.resetCircuitBreaker).toHaveBeenCalledTimes(1);expect(b.resetCircuitBreaker).toHaveBeenCalledTimes(1);
  registry.resetForTests();expect(a.disconnect).toHaveBeenCalledTimes(1);expect(b.disconnect).toHaveBeenCalledTimes(1);expect(registry.recoveryTimer).toBeNull();
 });
 it('failed online-only acquisition disconnects its socket and does not steal an existing identity',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A'),node('a'));
  const {MqttClientCore}=require('../mqtt-client');
  const bad={waitForConnection:jest.fn().mockRejectedValue(new Error('offline')),isConnected:()=>false,disconnect:jest.fn()};MqttClientCore.mockImplementationOnce(()=>bad);
  await expect(registry.getThingsboardMqttClient(cfg('B'),node('b'),false)).rejects.toThrow('offline');
  expect(bad.disconnect).toHaveBeenCalledTimes(1);expect(a.disconnect).not.toHaveBeenCalled();
 });
 it('rejects in-place identity changes until the old node owner is released',async()=>{
  const a=await registry.getThingsboardMqttClient(cfg('A'),node('same'));
  await expect(registry.getThingsboardMqttClient(cfg('B'),node('same'))).rejects.toThrow(/release/i);expect(a.disconnect).not.toHaveBeenCalled();
 });
 it('does not leak or resurrect a client when its node closes during pending initialization',async()=>{
  const {MqttClientCore}=require('../mqtt-client');let finish!:()=>void;
  const pendingClient={waitForConnection:jest.fn(()=>new Promise<void>(r=>{finish=r})),isConnected:jest.fn(()=>true),disconnect:jest.fn()};
  MqttClientCore.mockImplementationOnce(()=>pendingClient);
  const result=registry.getThingsboardMqttClient(cfg('A'),node('pending'));
  await Promise.resolve();await Promise.resolve();registry.releaseClient('thingsboard',node('pending'));finish();
  await expect(result).rejects.toThrow(/closed|released|cancel/i);
  expect(pendingClient.disconnect).toHaveBeenCalledTimes(1);expect(registry.thingsboardMqttPool.size).toBe(0);
 });
 it('one offline identity cannot block reuse of a healthy identity',async()=>{
  const b=await registry.getThingsboardMqttClient(cfg('B'),node('b'));
  const {MqttClientCore}=require('../mqtt-client');let finish!:()=>void;
  MqttClientCore.mockImplementationOnce(()=>({waitForConnection:()=>new Promise<void>(r=>{finish=r}),isConnected:()=>true,disconnect:jest.fn()}));
  const aPromise=registry.getThingsboardMqttClient(cfg('A'),node('a'));let returned=false;
  const bPromise=registry.getThingsboardMqttClient(cfg('B'),node('b2')).then((c:any)=>{expect(c).toBe(b);returned=true;});
  for(let n=0;n<10;n++)await Promise.resolve();
  const beforeSettlement=returned;finish();await Promise.all([aPromise,bPromise]);expect(beforeSettlement).toBe(true);
 });
 it('rejects another local device even if a shared emitter delivered its topic',async()=>{
  const {MessageHandler}=require('../../modules/viis-rpc-control/handlers/messageHandler');
  const n:any={...node('rpc'),context:()=>({global:{get:()=>undefined,set:jest.fn()}})};
  const handler=new MessageHandler({node:n},{brokerRole:'local',deviceId:'DEVICE_A'});const processor=jest.fn();
  await handler.processMqttMessage({topic:'v1/devices/me/rpc/request/DEVICE_A_OTHER',message:JSON.stringify({method:'set_state',params:{input_pump:false}})},'v1/devices/me/rpc/request/DEVICE_A',processor);
  expect(processor).not.toHaveBeenCalled();handler.clearProcessedMessages();
 });
 it('delivers the legacy cloud RPC only to its authenticated identity and reads back the fake coil',async()=>{
  jest.useRealTimers();
  const {attachRpcMqttMessageHandler}=require('../../modules/viis-rpc-control/rpc-mqtt-ingress');
  const {MessageHandler}=require('../../modules/viis-rpc-control/handlers/messageHandler');
  const auto=await registry.getThingsboardMqttClient(cfg('AUTOMATION'),node('automation'));
  const rpc=await registry.getThingsboardMqttClient(cfg('RPC'),node('rpc'));
  const automationHandler=jest.fn();auto.on('mqtt-message',automationHandler);
  const n:any={...node('rpc'),context:()=>({global:{get:()=>undefined,set:jest.fn()}})};
  const handler=new MessageHandler({node:n});
  const board={writeCoil:jest.fn().mockResolvedValue(undefined),readCoils:jest.fn().mockResolvedValue({data:[false]})};
  const {RpcHandler}=require('../../modules/viis-rpc-control/handlers/rpcHandler');
  const {DiagnosticLogger}=require('../observability/diagnostic-logger');const events:string[]=[];
  const diag=jest.spyOn(DiagnosticLogger.prototype,'emit').mockImplementation((_level:any,event:any)=>{events.push(event as string)});
  const ticket=()=>({operationId:'fake-publish',completion:Promise.resolve({operationId:'fake-publish',status:'acknowledged',acknowledgement:'mqtt_puback'})});
  const mqtt:any={scheduleResultTracked:jest.fn(ticket),publishResult:jest.fn(),publishResultImmediate:jest.fn(),publishConfigUpdate:jest.fn().mockResolvedValue(undefined),publishConfigUpdateTracked:jest.fn().mockResolvedValue({status:'acknowledged'}),publishError:jest.fn(),publishErrorTracked:jest.fn().mockResolvedValue({status:'acknowledged'}),isConnected:()=>true};
  const modbus:any={findModbusMapping:(key:string,value:any)=>key==='input_pump'?{address:1,fc:5,value,boardId:'board1'}:null,getModbusHoldingRegisters:()=>({}),getModbusCoils:()=>({input_pump:1}),writeToModbus:async(_key:string,cmd:any,value:any)=>board.writeCoil(cmd.address,value),readFromModbus:async(_key:string,cmd:any)=>(await board.readCoils(cmd.address,1)).data[0],updateGlobalContextCacheAfterVerification:jest.fn(),checkConnection:jest.fn(),isHoldingSetmlBomOffsetEnabled:()=>false,getHoldingSetmlBomOffset:()=>null,getHoldingSetmlBomOffsetConfig:()=>({})};
  const processor=new RpcHandler({node:n,flowContext:{},globalContext:{}},{getConfigKeyValues:()=>({}),setConfigKeyValues:jest.fn()},{validateAndConvertValue:(_k:string,v:any)=>v},modbus,mqtt,{processRpcBody:jest.fn().mockResolvedValue(false)});
  const completed=jest.fn();
  const detach=attachRpcMqttMessageHandler(rpc,async({message}:any)=>handler.processMqttMessage(message,'v1/devices/me/rpc/request/+',async(payload:any,context:any)=>{
   await processor.handleRpcRequest(payload,3,context);completed();
  }),e=>{throw e});
  rpc.emit('mqtt-message',{message:{topic:'v1/devices/me/rpc/request/95',message:JSON.stringify({method:'set_state',params:{input_pump:false,requestId:'test-host36'}})}});
  await new Promise<void>(r=>setImmediate(r));
  expect(automationHandler).not.toHaveBeenCalled();expect(board.writeCoil).toHaveBeenCalledTimes(1);expect(board.writeCoil).toHaveBeenCalledWith(1,false);expect(board.readCoils).toHaveBeenCalledWith(1,1);expect(completed).toHaveBeenCalled();expect(events).toContain('rpc.execution_finished');expect(events).toContain('rpc.delivery_finished');
  detach();handler.clearProcessedMessages();diag.mockRestore();
 });
});
