"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const dataSource_1 = require("../../orm/dataSource");
const registry_1 = require("../../services/event-outbox/registry");
const fertigation_start_sequence_1 = require("../shared/fertigation-start-sequence");
const actuator_policy_1 = require("./actuator-policy");
const arbiter_api_1 = require("./arbiter-api");
const arbiter_registry_1 = require("./arbiter-registry");
const arbiter_store_1 = require("./arbiter-store");
const arbiter_targets_1 = require("./arbiter-targets");
const reconciler_1 = require("./reconciler");
const DEFAULT_MANUAL_LEASE_S = 1800;
const DEFAULT_SCENARIO_LEASE_S = 600;
function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
module.exports = function (RED) {
    function ViisActuatorArbiterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const helper = new global_context_helper_1.GlobalContextHelper(node.context());
        const mode = (0, arbiter_registry_1.parseArbiterMode)(helper.getEnvVar('ARBITER_MODE', 'off'));
        if (mode === 'off') {
            node.status({ fill: 'grey', shape: 'ring', text: 'off (ARBITER_MODE)' });
            return;
        }
        const boards = (0, arbiter_targets_1.parseBoards)(helper.getEnvVar('MODBUS_BOARDS', null));
        if (boards.length === 0) {
            node.error('[arbiter] MODBUS_BOARDS is missing: the arbiter needs multi-board Modbus config; writers keep direct writes');
            node.status({ fill: 'red', shape: 'ring', text: 'no MODBUS_BOARDS' });
            return;
        }
        const defaultBoard = String(helper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id) || boards[0].id);
        client_registry_1.default.initializeMultiBoardConfig({ mode: 'multi', defaultBoard, boards: boards }, node);
        const allTargets = (0, arbiter_targets_1.buildCoilTargets)(boards, boardId => helper.getJsonEnvVar(`MODBUS_${boardId.toUpperCase()}_COILS`, {}), helper.getJsonEnvVar('MODBUS_COILS', {}), defaultBoard);
        const policy = (0, actuator_policy_1.loadActuatorPolicy)(helper.getEnvVar('ACTUATOR_POLICY', null), {
            manualLeaseS: positive(helper.getNumericEnvVar('ARBITER_MANUAL_LEASE_S', DEFAULT_MANUAL_LEASE_S), DEFAULT_MANUAL_LEASE_S),
            coilKeys: allTargets.map(t => t.key),
            warn: message => node.warn(message),
        });
        const targets = allTargets.filter(t => policy.mode(t.key) !== 'unmanaged');
        // One board client per board for the node's lifetime (each getModbusClientV2 call takes a reference).
        const clients = new Map();
        const acquiredBoards = new Set();
        const boardClient = (boardId) => {
            let client = clients.get(boardId);
            if (!client) {
                client = client_registry_1.default.getModbusClientV2(boardId, node).then(c => {
                    acquiredBoards.add(boardId);
                    return c;
                });
                client.catch(() => clients.delete(boardId));
                clients.set(boardId, client);
            }
            return client;
        };
        const readCoil = async (t) => {
            var _a;
            const client = await boardClient(t.boardId);
            if (client.isConnected === false)
                throw new Error(`Modbus client not connected (${t.boardId})`);
            const result = await client.readCoils(t.address, 1);
            return Boolean((_a = result === null || result === void 0 ? void 0 : result.data) === null || _a === void 0 ? void 0 : _a[0]);
        };
        const writeCoil = async (t, value) => {
            const client = await boardClient(t.boardId);
            if (client.isConnected === false)
                throw new Error(`Modbus client not connected (${t.boardId})`);
            await client.writeCoil(t.address, value);
        };
        let arbiter = null;
        let dataSourceAcquired = false;
        let closing = false;
        /** Gives back the board clients and the DataSource reference (close, or a start that lost to close). */
        const releaseResources = async () => {
            for (const boardId of acquiredBoards) {
                client_registry_1.default.releaseClientV2('modbus-board', node, boardId);
            }
            acquiredBoards.clear();
            clients.clear();
            if (dataSourceAcquired) {
                dataSourceAcquired = false;
                await dataSource_1.DataSourceManager.release().catch(() => undefined);
            }
        };
        const init = async () => {
            let store = null;
            try {
                const ds = await dataSource_1.DataSourceManager.acquire(node.context());
                dataSourceAcquired = true;
                store = new arbiter_store_1.ClaimStore(ds);
            }
            catch (error) {
                node.warn(`[arbiter] gateway MySQL unavailable, claims are not persisted: ${error.message}`);
            }
            const next = new arbiter_api_1.ActuatorArbiter({
                policy,
                mode,
                reconcilerDeps: {
                    targets,
                    readCoil,
                    writeCoil,
                    classify: reconciler_1.classifyActuatorKey,
                    waterHammerMs: fertigation_start_sequence_1.WATER_HAMMER_DELAY_MS,
                    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
                },
                scenarioLeaseS: positive(helper.getNumericEnvVar('ARBITER_SCENARIO_LEASE_S', DEFAULT_SCENARIO_LEASE_S), DEFAULT_SCENARIO_LEASE_S),
                store,
                tickMs: helper.getNumericEnvVar('ARBITER_TICK_MS', arbiter_api_1.DEFAULT_TICK_MS),
                outbox: registry_1.getEventOutbox,
                deviceId: () => String(helper.getEnvVar('DEVICE_ID', '') || ''),
                onOwnersChange: owners => node.send([{ topic: 'actuator_owners', payload: owners }, null]),
                onTickReport: report => {
                    const text = `${mode}: ${targets.length} keys, ${report.diffs.length} diff, ${report.readFailed.length} read failed`;
                    node.status({ fill: report.readFailed.length > 0 ? 'yellow' : 'green', shape: 'dot', text });
                    if (config.debugEnable)
                        node.send([null, { topic: 'arbiter_tick', payload: report }]);
                },
                warn: message => node.warn(message),
            });
            await next.start();
            if (closing) {
                // The node closed while starting: close() found nothing to stop.
                await next.stop();
                await releaseResources();
                return;
            }
            arbiter = next;
            (0, arbiter_registry_1.registerArbiter)(next);
            node.status({ fill: 'green', shape: 'dot', text: `${mode}: ${targets.length} keys` });
            node.log(`[arbiter] ${mode}: ${targets.map(t => t.key).join(', ') || 'no managed keys'}`);
        };
        init().catch(error => {
            node.error(`[arbiter] start failed: ${error.message}`);
            node.status({ fill: 'red', shape: 'ring', text: 'start failed' });
        });
        node.on('close', async (done) => {
            closing = true;
            try {
                if (arbiter) {
                    (0, arbiter_registry_1.unregisterArbiter)(arbiter);
                    await arbiter.stop();
                    arbiter = null;
                }
            }
            catch (error) {
                node.warn(`[arbiter] stop failed: ${error.message}`);
            }
            await releaseResources();
            done();
        });
    }
    RED.nodes.registerType('viis-actuator-arbiter', ViisActuatorArbiterNode);
};
