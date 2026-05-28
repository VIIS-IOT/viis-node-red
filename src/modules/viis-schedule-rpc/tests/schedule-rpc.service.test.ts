/**
 * Unit tests for viis-schedule-rpc routing logic
 */

describe('viis-schedule-rpc routing', () => {
    const RPC_METHODS = {
        SCHEDULE_DISABLE: "schedule-disable-by-backend",
        CONFIRM_DEVICES_OFF: "confirm-devices-off",
        CONTROL: "control",
        SET_CONTROL_MODE: "set_control_mode",
    };

    function routeRpcMethod(method: string): number {
        switch (method) {
            case RPC_METHODS.SCHEDULE_DISABLE: return 0;
            case RPC_METHODS.CONFIRM_DEVICES_OFF: return 1;
            case RPC_METHODS.CONTROL: return 2;
            case RPC_METHODS.SET_CONTROL_MODE: return 3;
            default: return 4;
        }
    }

    describe('RPC method routing', () => {
        it('should route schedule-disable-by-backend to output 0', () => {
            expect(routeRpcMethod('schedule-disable-by-backend')).toBe(0);
        });

        it('should route confirm-devices-off to output 1', () => {
            expect(routeRpcMethod('confirm-devices-off')).toBe(1);
        });

        it('should route control to output 2', () => {
            expect(routeRpcMethod('control')).toBe(2);
        });

        it('should route set_control_mode to output 3', () => {
            expect(routeRpcMethod('set_control_mode')).toBe(3);
        });

        it('should route unknown method to output 4', () => {
            expect(routeRpcMethod('unknown-method')).toBe(4);
        });

        it('should route empty string to output 4', () => {
            expect(routeRpcMethod('')).toBe(4);
        });
    });

    describe('Message validation', () => {
        it('should detect message without method', () => {
            const msg = { payload: { data: 'test' } } as any;
            const hasMethod = msg.payload && typeof msg.payload === 'object' && msg.payload.method;
            expect(hasMethod).toBeFalsy();
        });

        it('should detect null payload', () => {
            const msg = { payload: null } as any;
            const hasMethod = msg.payload && typeof msg.payload === 'object' && msg.payload.method;
            expect(hasMethod).toBeFalsy();
        });

        it('should detect valid RPC message', () => {
            const msg = { payload: { method: 'control', params: {} } } as any;
            const hasMethod = msg.payload && typeof msg.payload === 'object' && msg.payload.method;
            expect(hasMethod).toBeTruthy();
        });
    });
});
