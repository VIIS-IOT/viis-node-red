"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_IN_FLIGHT_KEY = void 0;
exports.createSerializedQueue = createSerializedQueue;
exports.tryBeginScheduleTransition = tryBeginScheduleTransition;
exports.endScheduleTransition = endScheduleTransition;
exports.isScheduleTransitionInFlight = isScheduleTransitionInFlight;
exports.clearAllScheduleTransitions = clearAllScheduleTransitions;
exports.SCHEDULE_IN_FLIGHT_KEY = "scheduleTransitionsInFlight";
/**
 * Serialize Node-RED input ticks so START/FINISH (including the 7s water-hammer)
 * cannot overlap when inject repeats every few seconds.
 */
function createSerializedQueue() {
    let tail = Promise.resolve();
    return function enqueue(work) {
        const run = tail.then(work, work);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}
function readInFlight(store) {
    return Object.assign({}, (store.get(exports.SCHEDULE_IN_FLIGHT_KEY) || {}));
}
function tryBeginScheduleTransition(store, scheduleName, kind) {
    const current = readInFlight(store);
    if (current[scheduleName]) {
        return false;
    }
    current[scheduleName] = kind;
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, current);
    return true;
}
function endScheduleTransition(store, scheduleName) {
    const current = readInFlight(store);
    delete current[scheduleName];
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, current);
}
function isScheduleTransitionInFlight(store, scheduleName) {
    const current = store.get(exports.SCHEDULE_IN_FLIGHT_KEY) || {};
    return Boolean(current[scheduleName]);
}
function clearAllScheduleTransitions(store) {
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, {});
}
