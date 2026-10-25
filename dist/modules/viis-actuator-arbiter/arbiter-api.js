"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorArbiter = exports.WRITE_FAILED_ALARM_TICKS = exports.CLAIM_MAX_WAIT_MS = exports.CLAIM_DEBOUNCE_MS = exports.MIN_TICK_MS = exports.DEFAULT_TICK_MS = void 0;
const alarm_key_1 = require("../../services/event-outbox/alarm-key");
const arbiter_core_1 = require("./arbiter-core");
const reconciler_1 = require("./reconciler");
exports.DEFAULT_TICK_MS = 5000;
exports.MIN_TICK_MS = 2000;
exports.CLAIM_DEBOUNCE_MS = 200;
exports.CLAIM_MAX_WAIT_MS = 15000;
/** Consecutive failed write ticks before `actuator_write_failed:<key>` is raised. */
exports.WRITE_FAILED_ALARM_TICKS = 3;
const WRITE_FAILED_PREFIX = 'actuator_write_failed:';
const RUNTIME_EXCEEDED_PREFIX = 'manual_runtime_exceeded:';
const EXTERNAL_OFF_PREFIX = 'actuator_external_off:';
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
class ActuatorArbiter {
    constructor(opts) {
        var _a, _b, _c, _d, _e;
        this.opts = opts;
        this.waiters = [];
        this.tickChain = Promise.resolve();
        this.queuedTicks = 0;
        this.saveChain = Promise.resolve();
        this.debounceTimer = null;
        this.interval = null;
        this.stopped = false;
        /** Last owners published; null until the first computed state, which is always published (even `{}`). */
        this.lastOwners = null;
        /** `actuator_write_failed:<key>` alarms raised (or found Pending in the outbox on start). */
        this.alarmed = new Set();
        /** `actuator_external_off:<key>` alarms raised (or found Pending in the outbox on start). */
        this.externalOffAlarmed = new Set();
        /** Keys whose ON write device protection is holding back (logged once per block). */
        this.gateBlocked = new Set();
        /** `manual_runtime_exceeded:<key>` alarms raised (or found Pending on start) -> owner of the key then (null = none). */
        this.ceilingAlarmed = new Map();
        /** Manual ON claims whose lease ended and whose tick has not reported yet. */
        this.pendingExpired = [];
        this.core = new arbiter_core_1.ArbiterCore(opts.policy);
        this.now = (_a = opts.now) !== null && _a !== void 0 ? _a : Date.now;
        this.reconciler = new reconciler_1.Reconciler(this.core, Object.assign(Object.assign({}, opts.reconcilerDeps), { mode: opts.mode, now: this.now }));
        this.tickMs = Math.max(exports.MIN_TICK_MS, Number(opts.tickMs) || exports.DEFAULT_TICK_MS);
        this.debounceMs = (_b = opts.debounceMs) !== null && _b !== void 0 ? _b : exports.CLAIM_DEBOUNCE_MS;
        this.claimWaitMs = (_c = opts.claimWaitMs) !== null && _c !== void 0 ? _c : exports.CLAIM_MAX_WAIT_MS;
        this.warn = (_d = opts.warn) !== null && _d !== void 0 ? _d : ((message) => console.warn(message));
        this.log = (_e = opts.log) !== null && _e !== void 0 ? _e : ((message) => console.log(message));
        this.leasePolicy = opts.policy;
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
        if (source === 'alarm_action')
            return null;
        const seconds = source === 'manual' ? this.leasePolicy.manualLeaseS(key) : this.opts.scenarioLeaseS;
        return seconds * 1000;
    }
    /**
     * Takes the manual leases from a reloaded policy (device1.json changed after a gateway sync). Claims
     * already submitted keep their expiry. Which keys are managed, and in what mode, is not reloaded.
     */
    setPolicy(policy) {
        this.leasePolicy = policy;
    }
    /** Loads saved claims, picks up Pending write alarms and starts ticking. */
    async start() {
        var _a, _b, _c, _d;
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
                const now = this.now();
                for (const { alarm_key } of await outbox.activeAlarms()) {
                    if (alarm_key.startsWith(WRITE_FAILED_PREFIX))
                        this.alarmed.add(alarm_key);
                    if (alarm_key.startsWith(EXTERNAL_OFF_PREFIX))
                        this.externalOffAlarmed.add(alarm_key);
                    if (alarm_key.startsWith(RUNTIME_EXCEEDED_PREFIX)) {
                        const key = alarm_key.slice(RUNTIME_EXCEEDED_PREFIX.length);
                        this.ceilingAlarmed.set(alarm_key, (_b = (_a = this.core.resolve(key, now).winner) === null || _a === void 0 ? void 0 : _a.ownerId) !== null && _b !== void 0 ? _b : null);
                    }
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
        (_d = (_c = this.interval).unref) === null || _d === void 0 ? void 0 : _d.call(_c);
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
        var _a, _b, _c;
        this.core.claim(Object.assign(Object.assign({}, input), { createdAt: this.now() }));
        this.persist();
        this.emitOwnersIfChanged();
        const boardId = (_a = this.target(input.key)) === null || _a === void 0 ? void 0 : _a.boardId;
        if (boardId !== undefined && ((_c = (_b = this.opts.reconcilerDeps).boardOffline) === null || _c === void 0 ? void 0 : _c.call(_b, boardId))) {
            return Object.assign(Object.assign({}, this.resultFor(input, null)), { boardOffline: boardId });
        }
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
        const now = this.now();
        const info = (c) => ({ source: c.source, ownerId: c.ownerId, expiresAt: c.expiresAt });
        const owners = {};
        for (const { key, winner } of this.core.resolveAll(now)) {
            if (!winner)
                continue;
            const runnerUp = this.core.rankedClaims(key, now)[1];
            owners[key] = Object.assign(Object.assign({}, info(winner)), { value: winner.value, next: runnerUp ? info(runnerUp) : null });
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
            const expired = this.core.expire(this.now());
            if (expired.length > 0) {
                this.persist();
                this.pendingExpired.push(...expired.filter(c => c.source === 'manual' && c.value));
            }
            report = await this.reconciler.tick();
            this.noteExternalOff(report);
            this.noteGateBlocked(report);
            this.emitCoilWrites(report);
            (_b = (_a = this.opts).onTickReport) === null || _b === void 0 ? void 0 : _b.call(_a, report);
            await this.updateWriteAlarms(report);
            await this.updateCeilingAlarms(report);
            await this.updateExternalOffAlarms(report);
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
        var _a;
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
        const gate = report === null || report === void 0 ? void 0 : report.gateBlocked.find(g => g.key === input.key);
        if (gate)
            result.gateBlocked = gate.reason;
        const boardId = (_a = this.target(input.key)) === null || _a === void 0 ? void 0 : _a.boardId;
        if (report && boardId !== undefined && report.offlineBoards.includes(boardId))
            result.boardOffline = boardId;
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
            const alarmKey = (0, alarm_key_1.capAlarmKey)(`${WRITE_FAILED_PREFIX}${key}`);
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
    ceilingPayload(key, alarmKey, raise) {
        var _a, _b;
        const deviceId = ((_b = (_a = this.opts).deviceId) === null || _b === void 0 ? void 0 : _b.call(_a)) || 'unknown_device';
        return {
            alarm_name: `Quá mức trần bật tay ${key}`,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `${key} đã tắt: quá mức trần bật tay` : `${key} đã tắt hẳn`,
            message_key: 'iot.notification.device.manual_runtime_exceeded',
            message_params: { key },
            message_locale: 'vi-VN',
            severity: 'notification',
            trigger_time: new Date(this.now()).toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };
    }
    /**
     * The reconciler gave up the claims of keys whose coil an outside party switched OFF (two OFF reads after
     * it was seen ON): save the claim set and log what was dropped.
     */
    noteExternalOff(report) {
        if (report.externalOff.length === 0)
            return;
        this.persist();
        for (const event of report.externalOff) {
            const dropped = [
                ...event.released.map(id => `released ${id}`),
                ...event.suspended.map(id => `suspended ${id}`),
            ].join(', ');
            if (event.winner.source === 'manual' && event.suspended.length === 0) {
                this.log(`[arbiter] manual claim released: ${event.key} closed by device`);
            }
            else {
                this.log(`[arbiter] external OFF on ${event.key} (winner ${event.winner.ownerId}): ${dropped}; not written ON again`);
            }
        }
    }
    /** Logs ON writes that device protection holds back, once per block, and when they are allowed again. */
    noteGateBlocked(report) {
        const now = new Set(report.gateBlocked.map(g => g.key));
        for (const { key, reason } of report.gateBlocked) {
            if (this.gateBlocked.has(key))
                continue;
            this.gateBlocked.add(key);
            this.log(`[arbiter] ON write of ${key} held back by device protection: ${reason}`);
        }
        for (const key of Array.from(this.gateBlocked)) {
            if (!now.has(key))
                this.gateBlocked.delete(key);
        }
    }
    externalOffPayload(key, alarmKey, raise) {
        var _a, _b;
        const deviceId = ((_b = (_a = this.opts).deviceId) === null || _b === void 0 ? void 0 : _b.call(_a)) || 'unknown_device';
        return {
            alarm_name: `Bị tắt từ bên ngoài ${key}`,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `${key} bị tắt từ bên ngoài` : `${key} điều khiển lại bình thường`,
            message_key: 'iot.notification.device.actuator_external_off',
            message_params: { key },
            message_locale: 'vi-VN',
            severity: 'notification',
            trigger_time: new Date(this.now()).toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };
    }
    /**
     * `actuator_external_off:<key>`: something outside the gateway switched a coil OFF that a schedule/scenario
     * claim wanted ON, and the arbiter stopped writing it ON (enforce only; nothing when the outbox is off).
     * Cleared when the coil reads ON again or no claim wants the key ON any more.
     */
    async updateExternalOffAlarms(report) {
        const now = this.now();
        if (this.opts.mode === 'enforce') {
            for (const event of report.externalOff) {
                if (event.suspended.length === 0)
                    continue;
                const alarmKey = (0, alarm_key_1.capAlarmKey)(`${EXTERNAL_OFF_PREFIX}${event.key}`);
                if (this.externalOffAlarmed.has(alarmKey))
                    continue;
                const outbox = this.outbox();
                if (!outbox)
                    continue;
                try {
                    await outbox.raise(alarmKey, this.externalOffPayload(event.key, alarmKey, true));
                    this.externalOffAlarmed.add(alarmKey);
                }
                catch (error) {
                    this.warn(`[arbiter] ${alarmKey} not raised: ${errorText(error)}`);
                }
            }
        }
        for (const alarmKey of Array.from(this.externalOffAlarmed)) {
            const key = alarmKey.slice(EXTERNAL_OFF_PREFIX.length);
            const readsOn = report.actual[key] === true;
            const wanted = this.core.suspendedClaims(key, now).length > 0 || this.core.rankedClaims(key, now).some(c => c.value);
            if (!readsOn && wanted)
                continue;
            const outbox = this.outbox();
            if (!outbox)
                continue;
            try {
                await outbox.clear(alarmKey, this.externalOffPayload(key, alarmKey, false));
                this.externalOffAlarmed.delete(alarmKey);
            }
            catch (error) {
                this.warn(`[arbiter] ${alarmKey} not cleared: ${errorText(error)}`);
            }
        }
    }
    /**
     * `manual_runtime_exceeded:<key>`: a manual ON claim ended while its coil still read ON and the
     * arbiter is driving it OFF (enforce only; nothing is raised when the outbox is off). Cleared once the
     * coil reads OFF, or when a claim other than the one that held the key at raise time wins it.
     */
    async updateCeilingAlarms(report) {
        var _a, _b, _c, _d;
        const expired = this.pendingExpired.splice(0);
        const now = this.now();
        for (const claim of expired) {
            const alarmKey = (0, alarm_key_1.capAlarmKey)(`${RUNTIME_EXCEEDED_PREFIX}${claim.key}`);
            if (this.opts.mode !== 'enforce' || this.ceilingAlarmed.has(alarmKey))
                continue;
            if (report.actual[claim.key] !== true || report.desired[claim.key] !== false)
                continue;
            const outbox = this.outbox();
            if (!outbox)
                continue;
            try {
                await outbox.raise(alarmKey, this.ceilingPayload(claim.key, alarmKey, true));
                this.ceilingAlarmed.set(alarmKey, (_b = (_a = this.core.resolve(claim.key, now).winner) === null || _a === void 0 ? void 0 : _a.ownerId) !== null && _b !== void 0 ? _b : null);
            }
            catch (error) {
                this.warn(`[arbiter] ${alarmKey} not raised: ${errorText(error)}`);
            }
        }
        for (const [alarmKey, raisedOwner] of Array.from(this.ceilingAlarmed)) {
            const key = alarmKey.slice(RUNTIME_EXCEEDED_PREFIX.length);
            const owner = (_d = (_c = this.core.resolve(key, now).winner) === null || _c === void 0 ? void 0 : _c.ownerId) !== null && _d !== void 0 ? _d : null;
            const newWinner = owner !== null && owner !== raisedOwner;
            if (report.actual[key] !== false && !newWinner)
                continue;
            const outbox = this.outbox();
            if (!outbox)
                continue;
            try {
                await outbox.clear(alarmKey, this.ceilingPayload(key, alarmKey, false));
                this.ceilingAlarmed.delete(alarmKey);
            }
            catch (error) {
                this.warn(`[arbiter] ${alarmKey} not cleared: ${errorText(error)}`);
            }
        }
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
    /** Reports the writes of this tick that did not throw; a listener error must not fail the tick. */
    emitCoilWrites(report) {
        const { onCoilWrite } = this.opts;
        if (!onCoilWrite)
            return;
        const ts = this.now();
        for (const write of report.writes) {
            if (!write.ok)
                continue;
            try {
                onCoilWrite({ key: write.key, value: write.value, ts });
            }
            catch (error) {
                this.warn(`[arbiter] coil write of ${write.key} not reported: ${errorText(error)}`);
            }
        }
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
