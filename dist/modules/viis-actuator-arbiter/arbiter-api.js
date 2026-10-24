"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorArbiter = exports.WRITE_FAILED_ALARM_TICKS = exports.CLAIM_MAX_WAIT_MS = exports.CLAIM_DEBOUNCE_MS = exports.MIN_TICK_MS = exports.DEFAULT_TICK_MS = void 0;
const arbiter_core_1 = require("./arbiter-core");
const reconciler_1 = require("./reconciler");
exports.DEFAULT_TICK_MS = 5000;
exports.MIN_TICK_MS = 2000;
exports.CLAIM_DEBOUNCE_MS = 200;
exports.CLAIM_MAX_WAIT_MS = 15000;
/** Consecutive failed write ticks before `actuator_write_failed:<key>` is raised. */
exports.WRITE_FAILED_ALARM_TICKS = 3;
const WRITE_FAILED_PREFIX = 'actuator_write_failed:';
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
class ActuatorArbiter {
    constructor(opts) {
        var _a, _b, _c, _d;
        this.opts = opts;
        this.waiters = [];
        this.tickChain = Promise.resolve();
        this.queuedTicks = 0;
        this.saveChain = Promise.resolve();
        this.debounceTimer = null;
        this.interval = null;
        this.stopped = false;
        this.lastOwners = '{}';
        /** `actuator_write_failed:<key>` alarms raised (or found Pending in the outbox on start). */
        this.alarmed = new Set();
        this.core = new arbiter_core_1.ArbiterCore(opts.policy);
        this.now = (_a = opts.now) !== null && _a !== void 0 ? _a : Date.now;
        this.reconciler = new reconciler_1.Reconciler(this.core, Object.assign(Object.assign({}, opts.reconcilerDeps), { mode: opts.mode, now: this.now }));
        this.tickMs = Math.max(exports.MIN_TICK_MS, Number(opts.tickMs) || exports.DEFAULT_TICK_MS);
        this.debounceMs = (_b = opts.debounceMs) !== null && _b !== void 0 ? _b : exports.CLAIM_DEBOUNCE_MS;
        this.claimWaitMs = (_c = opts.claimWaitMs) !== null && _c !== void 0 ? _c : exports.CLAIM_MAX_WAIT_MS;
        this.warn = (_d = opts.warn) !== null && _d !== void 0 ? _d : ((message) => console.warn(message));
    }
    manages(key) {
        return this.opts.policy.mode(key) !== 'unmanaged';
    }
    keyMode(key) {
        return this.opts.policy.mode(key);
    }
    target(key) {
        return this.opts.reconcilerDeps.targets.find(t => t.key === key);
    }
    mode() {
        return this.opts.mode;
    }
    leaseMs(source, key) {
        const seconds = source === 'manual' ? this.opts.policy.manualLeaseS(key) : this.opts.scenarioLeaseS;
        return seconds * 1000;
    }
    /** Loads saved claims, picks up Pending write alarms and starts ticking. */
    async start() {
        var _a, _b;
        const { store } = this.opts;
        if (store) {
            try {
                await store.ensureTable();
                this.core.load(await store.load(), this.now());
            }
            catch (error) {
                this.warn(`[arbiter] saved claims not loaded: ${errorText(error)}`);
            }
        }
        const outbox = this.outbox();
        if (outbox) {
            try {
                for (const { alarm_key } of await outbox.activeAlarms()) {
                    if (alarm_key.startsWith(WRITE_FAILED_PREFIX))
                        this.alarmed.add(alarm_key);
                }
            }
            catch (error) {
                this.warn(`[arbiter] active alarms not read: ${errorText(error)}`);
            }
        }
        this.emitOwnersIfChanged();
        this.interval = setInterval(() => {
            if (this.queuedTicks === 0)
                void this.tick();
        }, this.tickMs);
        (_b = (_a = this.interval).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
        this.requestTick();
    }
    /** Stops ticking, waits for the running tick and saves the claims. */
    async stop() {
        this.stopped = true;
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        if (this.interval)
            clearInterval(this.interval);
        this.debounceTimer = null;
        this.interval = null;
        await this.tickChain;
        this.persist();
        await this.saveChain;
        for (const waiter of this.waiters.splice(0))
            waiter(null);
    }
    async claim(input) {
        this.core.claim(Object.assign(Object.assign({}, input), { createdAt: this.now() }));
        this.persist();
        this.emitOwnersIfChanged();
        const report = await this.waitForTick();
        return this.resultFor(input, report);
    }
    async release(ownerId, key) {
        if (this.core.release(ownerId, key).length === 0)
            return;
        this.persist();
        this.emitOwnersIfChanged();
        this.requestTick();
    }
    owners() {
        const owners = {};
        for (const { key, winner } of this.core.resolveAll(this.now())) {
            if (winner)
                owners[key] = { source: winner.source, ownerId: winner.ownerId, expiresAt: winner.expiresAt };
        }
        return owners;
    }
    /** One reconcile pass (serialised with every other tick). */
    tick() {
        this.queuedTicks++;
        const run = this.tickChain.then(() => this.runTick());
        this.tickChain = run.finally(() => {
            this.queuedTicks--;
        });
        return run;
    }
    async runTick() {
        var _a, _b;
        // Claims submitted from here on wait for the next tick: this one may already have resolved their key.
        const waiters = this.waiters.splice(0);
        let report = null;
        try {
            if (this.core.expire(this.now()).length > 0)
                this.persist();
            report = await this.reconciler.tick();
            (_b = (_a = this.opts).onTickReport) === null || _b === void 0 ? void 0 : _b.call(_a, report);
            await this.updateWriteAlarms(report);
        }
        catch (error) {
            this.warn(`[arbiter] tick failed: ${errorText(error)}`);
        }
        this.emitOwnersIfChanged();
        for (const waiter of waiters)
            waiter(report);
        return report;
    }
    requestTick() {
        if (this.stopped || this.debounceTimer)
            return;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.tick();
        }, this.debounceMs);
    }
    waitForTick() {
        if (this.stopped)
            return Promise.resolve(null);
        return new Promise(resolve => {
            const waiter = report => {
                clearTimeout(timer);
                resolve(report);
            };
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== waiter);
                resolve(null);
            }, this.claimWaitMs);
            this.waiters.push(waiter);
            this.requestTick();
        });
    }
    resultFor(input, report) {
        const { winner } = this.core.resolve(input.key, this.now());
        const applied = winner !== null && winner.ownerId === input.ownerId;
        let actual;
        if (report) {
            const write = report.writes.filter(w => w.key === input.key).pop();
            actual = write && write.ok ? write.value : report.actual[input.key];
        }
        const result = { applied, actual, mode: this.opts.mode };
        if (!applied && winner)
            result.blockedBy = winner.source;
        return result;
    }
    outbox() {
        var _a, _b, _c;
        try {
            return (_c = (_b = (_a = this.opts).outbox) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null;
        }
        catch (_d) {
            return null;
        }
    }
    async updateWriteAlarms(report) {
        var _a, _b;
        for (const { key } of this.opts.reconcilerDeps.targets) {
            const alarmKey = `${WRITE_FAILED_PREFIX}${key}`;
            const failures = this.reconciler.consecutiveFailures(key);
            const raise = failures >= exports.WRITE_FAILED_ALARM_TICKS && !this.alarmed.has(alarmKey);
            const clear = failures === 0 && this.alarmed.has(alarmKey);
            if (!raise && !clear)
                continue;
            const outbox = this.outbox();
            if (!outbox)
                continue;
            const lastError = (_b = (_a = report.writes.filter(w => w.key === key && !w.ok).pop()) === null || _a === void 0 ? void 0 : _a.error) !== null && _b !== void 0 ? _b : null;
            try {
                if (raise) {
                    await outbox.raise(alarmKey, this.alarmPayload(key, alarmKey, true, lastError));
                    this.alarmed.add(alarmKey);
                }
                else {
                    await outbox.clear(alarmKey, this.alarmPayload(key, alarmKey, false, null));
                    this.alarmed.delete(alarmKey);
                }
            }
            catch (error) {
                this.warn(`[arbiter] ${alarmKey} not ${raise ? 'raised' : 'cleared'}: ${errorText(error)}`);
            }
        }
    }
    alarmPayload(key, alarmKey, raise, error) {
        var _a, _b;
        const deviceId = ((_b = (_a = this.opts).deviceId) === null || _b === void 0 ? void 0 : _b.call(_a)) || 'unknown_device';
        return {
            alarm_name: alarmKey,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `Không ghi được ${key}` : `Đã ghi được ${key}`,
            message_key: 'iot.notification.device.actuator_write_failed',
            message_params: { key, error },
            message_locale: 'vi-VN',
            severity: 'error',
            trigger_time: new Date(this.now()).toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };
    }
    /** Saves the current claims; saves run one after another so the last one holds the latest set. */
    persist() {
        var _a;
        const { store } = this.opts;
        // Every change is saved while running, so a store whose DataSource another node already closed
        // (node close order) has nothing new to take; warning there was only noise.
        if (!store || ((_a = store.isAvailable) === null || _a === void 0 ? void 0 : _a.call(store)) === false)
            return;
        this.saveChain = this.saveChain
            .then(() => store.save(this.core.snapshot()))
            .catch(error => this.warn(`[arbiter] claims not saved: ${errorText(error)}`));
    }
    emitOwnersIfChanged() {
        var _a, _b;
        const owners = this.owners();
        const serialised = JSON.stringify(owners);
        if (serialised === this.lastOwners)
            return;
        this.lastOwners = serialised;
        (_b = (_a = this.opts).onOwnersChange) === null || _b === void 0 ? void 0 : _b.call(_a, owners);
    }
}
exports.ActuatorArbiter = ActuatorArbiter;
