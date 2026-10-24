/**
 * viis-actuator-arbiter: the one writer of the actuator coils that device1.json `actuatorPolicy` lists as
 * `managed` or `hold` (plan Task 12). One node per gateway.
 *
 * ARBITER_MODE (default `off`):
 * - `off`: the node does nothing (no Modbus client, no table, no timer); getArbiter() stays null and every
 *   writer keeps today's direct writes.
 * - `observe`: claims are recorded and coils read, diffs reported, nothing is written by the arbiter.
 * - `enforce`: sources submit claims instead of writing; the arbiter writes the winning value.
 *
 * Outputs: 1 = `{ topic: 'actuator_owners', payload: owners }` when ownership changes;
 *          2 = the tick report when `debugEnable` is on.
 */
import { NodeAPI, Node, NodeDef } from 'node-red';
import ClientRegistry, { MultiModbusConfig } from '../../core/client-registry';
import { GlobalContextHelper } from '../../ultils/global-context-helper';
import { DataSourceManager } from '../../orm/dataSource';
import { getEventOutbox } from '../../services/event-outbox/registry';
import { WATER_HAMMER_DELAY_MS } from '../shared/fertigation-start-sequence';
import { loadActuatorPolicy } from './actuator-policy';
import { ActuatorArbiter, DEFAULT_TICK_MS } from './arbiter-api';
import { parseArbiterMode, registerArbiter, unregisterArbiter } from './arbiter-registry';
import { ClaimStore } from './arbiter-store';
import { buildCoilTargets, parseBoards } from './arbiter-targets';
import { classifyActuatorKey, CoilTarget } from './reconciler';

interface ViisActuatorArbiterNodeDef extends NodeDef {
    debugEnable?: boolean;
}

const DEFAULT_MANUAL_LEASE_S = 1800;
const DEFAULT_SCENARIO_LEASE_S = 600;

function positive(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = function (RED: NodeAPI) {
    function ViisActuatorArbiterNode(this: Node, config: ViisActuatorArbiterNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const helper = new GlobalContextHelper(node.context());

        const mode = parseArbiterMode(helper.getEnvVar('ARBITER_MODE', 'off'));
        if (mode === 'off') {
            node.status({ fill: 'grey', shape: 'ring', text: 'off (ARBITER_MODE)' });
            return;
        }

        const boards = parseBoards(helper.getEnvVar('MODBUS_BOARDS', null));
        if (boards.length === 0) {
            node.error('[arbiter] MODBUS_BOARDS is missing: the arbiter needs multi-board Modbus config; writers keep direct writes');
            node.status({ fill: 'red', shape: 'ring', text: 'no MODBUS_BOARDS' });
            return;
        }
        const defaultBoard = String(helper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id) || boards[0].id);
        ClientRegistry.initializeMultiBoardConfig(
            { mode: 'multi', defaultBoard, boards: boards as unknown as MultiModbusConfig['boards'] },
            node
        );

        const allTargets = buildCoilTargets(
            boards,
            boardId => helper.getJsonEnvVar(`MODBUS_${boardId.toUpperCase()}_COILS`, {}),
            helper.getJsonEnvVar('MODBUS_COILS', {}),
            defaultBoard
        );
        const policy = loadActuatorPolicy(helper.getEnvVar('ACTUATOR_POLICY', null), {
            manualLeaseS: positive(helper.getNumericEnvVar('ARBITER_MANUAL_LEASE_S', DEFAULT_MANUAL_LEASE_S), DEFAULT_MANUAL_LEASE_S),
            coilKeys: allTargets.map(t => t.key),
            warn: message => node.warn(message),
        });
        const targets = allTargets.filter(t => policy.mode(t.key) !== 'unmanaged');

        // One board client per board for the node's lifetime (each getModbusClientV2 call takes a reference).
        const clients = new Map<string, Promise<any>>();
        const acquiredBoards = new Set<string>();
        const boardClient = (boardId: string): Promise<any> => {
            let client = clients.get(boardId);
            if (!client) {
                client = ClientRegistry.getModbusClientV2(boardId, node).then(c => {
                    acquiredBoards.add(boardId);
                    return c;
                });
                client.catch(() => clients.delete(boardId));
                clients.set(boardId, client);
            }
            return client;
        };
        const readCoil = async (t: CoilTarget): Promise<boolean> => {
            const client = await boardClient(t.boardId);
            if (client.isConnected === false) throw new Error(`Modbus client not connected (${t.boardId})`);
            const result = await client.readCoils(t.address, 1);
            return Boolean(result?.data?.[0]);
        };
        const writeCoil = async (t: CoilTarget, value: boolean): Promise<void> => {
            const client = await boardClient(t.boardId);
            if (client.isConnected === false) throw new Error(`Modbus client not connected (${t.boardId})`);
            await client.writeCoil(t.address, value);
        };

        let arbiter: ActuatorArbiter | null = null;
        let dataSourceAcquired = false;
        let closing = false;

        /** Gives back the board clients and the DataSource reference (close, or a start that lost to close). */
        const releaseResources = async () => {
            for (const boardId of acquiredBoards) {
                ClientRegistry.releaseClientV2('modbus-board', node, boardId);
            }
            acquiredBoards.clear();
            clients.clear();
            if (dataSourceAcquired) {
                dataSourceAcquired = false;
                await DataSourceManager.release().catch(() => undefined);
            }
        };

        const init = async () => {
            let store: ClaimStore | null = null;
            try {
                const ds = await DataSourceManager.acquire(node.context());
                dataSourceAcquired = true;
                store = new ClaimStore(ds);
            } catch (error) {
                node.warn(`[arbiter] gateway MySQL unavailable, claims are not persisted: ${(error as Error).message}`);
            }

            const next = new ActuatorArbiter({
                policy,
                mode,
                reconcilerDeps: {
                    targets,
                    readCoil,
                    writeCoil,
                    classify: classifyActuatorKey,
                    waterHammerMs: WATER_HAMMER_DELAY_MS,
                    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
                },
                scenarioLeaseS: positive(
                    helper.getNumericEnvVar('ARBITER_SCENARIO_LEASE_S', DEFAULT_SCENARIO_LEASE_S),
                    DEFAULT_SCENARIO_LEASE_S
                ),
                store,
                tickMs: helper.getNumericEnvVar('ARBITER_TICK_MS', DEFAULT_TICK_MS),
                outbox: getEventOutbox,
                deviceId: () => String(helper.getEnvVar('DEVICE_ID', '') || ''),
                onOwnersChange: owners => node.send([{ topic: 'actuator_owners', payload: owners }, null]),
                onTickReport: report => {
                    const text = `${mode}: ${targets.length} keys, ${report.diffs.length} diff, ${report.readFailed.length} read failed`;
                    node.status({ fill: report.readFailed.length > 0 ? 'yellow' : 'green', shape: 'dot', text });
                    if (config.debugEnable) node.send([null, { topic: 'arbiter_tick', payload: report }]);
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
            registerArbiter(next);
            node.status({ fill: 'green', shape: 'dot', text: `${mode}: ${targets.length} keys` });
            node.log(`[arbiter] ${mode}: ${targets.map(t => t.key).join(', ') || 'no managed keys'}`);
        };

        init().catch(error => {
            node.error(`[arbiter] start failed: ${(error as Error).message}`);
            node.status({ fill: 'red', shape: 'ring', text: 'start failed' });
        });

        node.on('close', async (done: () => void) => {
            closing = true;
            try {
                if (arbiter) {
                    unregisterArbiter(arbiter);
                    await arbiter.stop();
                    arbiter = null;
                }
            } catch (error) {
                node.warn(`[arbiter] stop failed: ${(error as Error).message}`);
            }
            await releaseResources();
            done();
        });
    }

    RED.nodes.registerType('viis-actuator-arbiter', ViisActuatorArbiterNode);
};
