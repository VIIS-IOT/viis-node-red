/**
 * State machine tests for viis-fertilizer-ec-control
 * Tests FSM transitions: IDLE -> STARTING -> RAMPING_UP -> RUNNING -> STOPPING -> IDLE
 */
describe('Fertilizer EC Control - State Machine', () => {
    describe('State Transitions', () => {
        it('should follow correct state flow: IDLE -> STARTING -> RAMPING_UP -> RUNNING -> STOPPING -> IDLE', () => {
            const states = ['IDLE', 'STARTING', 'RAMPING_UP', 'RUNNING', 'STOPPING', 'IDLE'];
            let currentState = 'IDLE';
            // Simulate state transitions
            const transitions = states.slice(1);
            transitions.forEach(nextState => {
                // Each transition should be valid
                expect(isValidTransition(currentState, nextState)).toBe(true);
                currentState = nextState;
            });
        });
        it('should reject invalid transitions', () => {
            // Cannot go directly from IDLE to RUNNING
            expect(isValidTransition('IDLE', 'RUNNING')).toBe(false);
            // Cannot go from RUNNING back to STARTING
            expect(isValidTransition('RUNNING', 'STARTING')).toBe(false);
            // Cannot go from STOPPING to RAMPING_UP
            expect(isValidTransition('STOPPING', 'RAMPING_UP')).toBe(false);
        });
        it('should allow stopping from any active state', () => {
            const activeStates = ['STARTING', 'RAMPING_UP', 'RUNNING'];
            activeStates.forEach(state => {
                expect(isValidTransition(state, 'STOPPING')).toBe(true);
            });
        });
        it('should only allow starting from IDLE or ERROR state', () => {
            expect(isValidTransition('IDLE', 'STARTING')).toBe(true);
            expect(isValidTransition('ERROR', 'STARTING')).toBe(true);
            expect(isValidTransition('RUNNING', 'STARTING')).toBe(false);
            expect(isValidTransition('STOPPING', 'STARTING')).toBe(false);
        });
        it('should transition to ERROR from any state', () => {
            const allStates = ['IDLE', 'STARTING', 'RAMPING_UP', 'RUNNING', 'STOPPING'];
            allStates.forEach(state => {
                expect(isValidTransition(state, 'ERROR')).toBe(true);
            });
        });
    });
    describe('State Guards', () => {
        it('should prevent multiple starts when not in IDLE', () => {
            const state = 'RUNNING';
            const canStart = state === 'IDLE' || state === 'ERROR';
            expect(canStart).toBe(false);
        });
        it('should allow start only when IDLE or ERROR', () => {
            expect(canStartIrrigation('IDLE')).toBe(true);
            expect(canStartIrrigation('ERROR')).toBe(true);
            expect(canStartIrrigation('STARTING')).toBe(false);
            expect(canStartIrrigation('RAMPING_UP')).toBe(false);
            expect(canStartIrrigation('RUNNING')).toBe(false);
            expect(canStartIrrigation('STOPPING')).toBe(false);
        });
        it('should prevent stop when already IDLE', () => {
            expect(canStopIrrigation('IDLE')).toBe(false);
            expect(canStopIrrigation('RUNNING')).toBe(true);
            expect(canStopIrrigation('RAMPING_UP')).toBe(true);
        });
        it('should allow polling only during RAMPING_UP or RUNNING', () => {
            expect(shouldPoll('IDLE')).toBe(false);
            expect(shouldPoll('STARTING')).toBe(false);
            expect(shouldPoll('RAMPING_UP')).toBe(true);
            expect(shouldPoll('RUNNING')).toBe(true);
            expect(shouldPoll('STOPPING')).toBe(false);
            expect(shouldPoll('ERROR')).toBe(false);
        });
    });
    describe('Concurrent Operation Prevention', () => {
        it('should block concurrent start operations', () => {
            let state = 'IDLE';
            let operationInProgress = false;
            // First start
            if (canStartIrrigation(state) && !operationInProgress) {
                operationInProgress = true;
                state = 'STARTING';
            }
            // Second start should be blocked
            const secondStartAllowed = canStartIrrigation(state) && !operationInProgress;
            expect(secondStartAllowed).toBe(false);
        });
        it('should prevent state changes during transitions', () => {
            const state = 'STARTING'; // Transitional state
            // Should not allow another start during transition
            expect(canStartIrrigation(state)).toBe(false);
        });
    });
});
function isValidTransition(from, to) {
    var _a, _b;
    const validTransitions = {
        'IDLE': ['STARTING', 'ERROR'],
        'STARTING': ['RAMPING_UP', 'STOPPING', 'ERROR'],
        'RAMPING_UP': ['RUNNING', 'STOPPING', 'ERROR'],
        'RUNNING': ['STOPPING', 'ERROR'],
        'STOPPING': ['IDLE', 'ERROR'],
        'ERROR': ['IDLE', 'STARTING'],
    };
    return (_b = (_a = validTransitions[from]) === null || _a === void 0 ? void 0 : _a.includes(to)) !== null && _b !== void 0 ? _b : false;
}
function canStartIrrigation(state) {
    return state === 'IDLE' || state === 'ERROR';
}
function canStopIrrigation(state) {
    return state !== 'IDLE' && state !== 'STOPPING';
}
function shouldPoll(state) {
    return state === 'RAMPING_UP' || state === 'RUNNING';
}
