"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
test('applyStartCommandStore keeps commands after a failed key report', () => {
    const store = { activeModbusCommands: {} };
    const mockNode = {
        warn: jest.fn(),
        context: () => ({
            global: {
                get: (key) => store[key],
                set: (key, value) => { store[key] = value; },
            },
        }),
    };
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, false, true);
    service.applyStartCommandStore('sched-1', [
        { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 },
        { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
    ]);
    expect(service.getActiveCommands('sched-1')).toHaveLength(2);
});
test('node no longer gates START status on batch verify failure', () => {
    const nodeSrc = fs.readFileSync(path.join(__dirname, '..', 'viis-schedule-executor.ts'), 'utf8');
    expect(nodeSrc).not.toContain('failed to start after');
    expect(nodeSrc).not.toContain('while (!writeSuccess && attempt < 3)');
});
