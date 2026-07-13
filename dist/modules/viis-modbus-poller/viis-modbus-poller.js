"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const constants_1 = require("../viis-modbus-flex/constants");
const viis_telemetry_constants_1 = require("../viis-telemetry/viis-telemetry-constants");
const config_resolver_1 = require("./services/config-resolver");
const config_validator_1 = require("./services/config-validator");
const poll_runner_1 = require("./services/poll-runner");
const DEFAULT_POLLER_OPTIONS = {
    maxGap: 5,
    maxCoilsPerRead: 64,
    maxRegistersPerRead: 32,
    staleLockMs: 5000,
    publishFullSnapshotOnFirstRead: true,
    enableDiagnostics: true,
};
function toPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseOptions(config) {
    return {
        maxGap: toPositiveNumber(config.maxGap, DEFAULT_POLLER_OPTIONS.maxGap),
        maxCoilsPerRead: toPositiveNumber(config.maxCoilsPerRead, DEFAULT_POLLER_OPTIONS.maxCoilsPerRead),
        maxRegistersPerRead: toPositiveNumber(config.maxRegistersPerRead, DEFAULT_POLLER_OPTIONS.maxRegistersPerRead),
        staleLockMs: toPositiveNumber(config.staleLockMs, DEFAULT_POLLER_OPTIONS.staleLockMs),
        publishFullSnapshotOnFirstRead: config.publishFullSnapshotOnFirstRead !== false,
        enableDiagnostics: config.enableDiagnostics !== false,
    };
}
function parseJsonMaybe(value, label) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string") {
        return value;
    }
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new Error(`Invalid JSON in ${label}: ${error.message}`);
    }
}
function getGlobalValue(globalContext, keys) {
    for (const key of keys) {
        const value = globalContext.get(key);
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return undefined;
}
function readBoardConfigs(globalContext, globalHelper) {
    var _a, _b;
    const rawBoards = (_a = getGlobalValue(globalContext, ["modbusBoards", "modbus_boards"])) !== null && _a !== void 0 ? _a : globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_BOARDS, undefined);
    const boards = parseJsonMaybe(rawBoards, "modbusBoards");
    if (!Array.isArray(boards) || boards.length === 0) {
        return {};
    }
    const defaultBoardRaw = (_b = getGlobalValue(globalContext, ["modbusDefaultBoard", "modbus_default_board"])) !== null && _b !== void 0 ? _b : globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id);
    const defaultBoard = typeof defaultBoardRaw === "string" && defaultBoardRaw.trim()
        ? defaultBoardRaw.trim()
        : boards[0].id;
    return { boards, defaultBoard };
}
function readSingleModbusConfig(globalHelper) {
    return {
        type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, constants_1.DEFAULT_CONFIG.MODBUS_TYPE),
        host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, constants_1.DEFAULT_CONFIG.MODBUS_HOST),
        tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, constants_1.DEFAULT_CONFIG.MODBUS_TCP_PORT),
        serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, constants_1.DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
        baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, constants_1.DEFAULT_CONFIG.MODBUS_BAUD_RATE),
        parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, constants_1.DEFAULT_CONFIG.MODBUS_PARITY),
        unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, constants_1.DEFAULT_CONFIG.MODBUS_UNIT_ID),
        timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, constants_1.DEFAULT_CONFIG.MODBUS_TIMEOUT),
        reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, constants_1.DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL),
    };
}
function resolveSharedClientTarget(node, globalContext, boardId) {
    const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
    const { boards, defaultBoard } = readBoardConfigs(globalContext, globalHelper);
    if (boards && boards.length > 0) {
        client_registry_1.default.initializeMultiBoardConfig({
            mode: "multi",
            defaultBoard,
            boards,
        }, node);
        const targetBoardId = boardId || defaultBoard || boards[0].id;
        const boardConfig = boards.find((board) => board.id === targetBoardId);
        const signature = boardConfig
            ? targetKey({ mode: "single", config: boardConfig })
            : `missing:${targetBoardId}`;
        return { mode: "board", boardId: targetBoardId, signature };
    }
    return { mode: "single", config: readSingleModbusConfig(globalHelper) };
}
function targetKey(target) {
    if (target.mode === "board") {
        return `board:${target.boardId}:${target.signature}`;
    }
    const config = target.config;
    return config.type === "TCP"
        ? `single:tcp:${config.host}:${config.tcpPort}`
        : `single:rtu:${config.serialPort}`;
}
function buildDiagnosticsMessage(status, errors = [], warnings = [], extra = {}) {
    const now = Date.now();
    return {
        topic: "viis/modbus-poller/diagnostics",
        payload: Object.assign({ status,
            errors,
            warnings, readCount: 0, errorCount: errors.length, requests: [], startedAt: now, endedAt: now, durationMs: 0, timestamp: now }, extra),
    };
}
function getDueGroups(pollingConfig, lastPollTimes, now) {
    const dueGroups = [];
    for (const [groupName, group] of Object.entries(pollingConfig)) {
        const interval = toPositiveNumber(group.interval, 0);
        const lastPoll = lastPollTimes[groupName] || 0;
        if (interval > 0 && now - lastPoll >= interval) {
            dueGroups.push(groupName);
        }
    }
    return dueGroups;
}
function markDueGroups(lastPollTimes, dueGroups, now) {
    for (const groupName of dueGroups) {
        lastPollTimes[groupName] = now;
    }
}
function splitLatestDataByRegister(latestData, mappings) {
    const result = { coils: {}, input: {}, holding: {} };
    for (const [key, value] of Object.entries(latestData)) {
        if (Object.prototype.hasOwnProperty.call(mappings.coils, key)) {
            result.coils[key] = value;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(mappings.input, key)) {
            result.input[key] = value;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(mappings.holding, key)) {
            result.holding[key] = value;
        }
    }
    return result;
}
function mergeGlobalTelemetry(globalContext, key, data, timestamp) {
    if (Object.keys(data).length === 0) {
        return;
    }
    const previous = globalContext.get(key) || {};
    globalContext.set(key, Object.assign(Object.assign(Object.assign({}, previous), { ts: timestamp }), data));
}
function writeLatestGlobalState(globalContext, config, latestData) {
    const timestamp = Date.now();
    const split = splitLatestDataByRegister(latestData, config.mappings);
    mergeGlobalTelemetry(globalContext, viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, split.coils, timestamp);
    mergeGlobalTelemetry(globalContext, viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, split.input, timestamp);
    mergeGlobalTelemetry(globalContext, viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, split.holding, timestamp);
}
function buildTelemetryMessages(config, changedData, pollDurationMs) {
    const payload = Object.assign(Object.assign({}, changedData), { ts: Date.now(), _poll_duration_ms: pollDurationMs });
    return [
        {
            topic: `v1/devices/me/telemetry/${config.deviceId}`,
            payload,
            qos: 0,
            retain: false,
        },
        {
            topic: "v1/devices/me/telemetry",
            payload,
            qos: 0,
            retain: false,
        },
    ];
}
module.exports = function registerViisModbusPoller(RED) {
    function ViisModbusPollerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const options = parseOptions(config);
        const previousState = {};
        const lastPollTimes = {};
        const emittedWarnings = new Set();
        let firstSuccessfulRead = true;
        let pollInProgress = 0;
        let modbusClient = null;
        let currentTarget = null;
        function releaseCurrentModbusClient() {
            if (!modbusClient || !currentTarget) {
                return;
            }
            if (currentTarget.mode === "board") {
                client_registry_1.default.releaseClientV2("modbus-board", node, currentTarget.boardId);
            }
            else {
                client_registry_1.default.releaseClientV2("modbus", node);
            }
            modbusClient = null;
            currentTarget = null;
        }
        async function getOrCreateSharedModbusClient(boardId) {
            const nextTarget = resolveSharedClientTarget(node, node.context().global, boardId);
            if (modbusClient && currentTarget && targetKey(currentTarget) === targetKey(nextTarget)) {
                return modbusClient;
            }
            releaseCurrentModbusClient();
            currentTarget = nextTarget;
            modbusClient = nextTarget.mode === "board"
                ? await client_registry_1.default.getModbusClientV2(nextTarget.boardId, node)
                : await client_registry_1.default.getModbusClientV2(nextTarget.config, node);
            return modbusClient;
        }
        function sendDiagnostics(send, message) {
            if (options.enableDiagnostics) {
                send([null, null, message]);
            }
        }
        node.status({ fill: "grey", shape: "ring", text: "Waiting for inject" });
        node.on("input", async (msg, send, done) => {
            const nodeSend = send || ((messages) => node.send(messages));
            const startedAt = Date.now();
            if (pollInProgress && startedAt - pollInProgress < options.staleLockMs) {
                node.status({ fill: "yellow", shape: "ring", text: "Previous poll running" });
                sendDiagnostics(nodeSend, buildDiagnosticsMessage("skipped", ["previous poll still running"], [], {
                    boardId: config.boardId || "board1",
                    dueGroups: [],
                }));
                done === null || done === void 0 ? void 0 : done();
                return;
            }
            if (pollInProgress && startedAt - pollInProgress >= options.staleLockMs) {
                node.warn(`Stale poll lock detected after ${startedAt - pollInProgress}ms; resetting`);
                pollInProgress = 0;
            }
            pollInProgress = startedAt;
            try {
                const resolvedConfig = (0, config_resolver_1.resolvePollerConfig)(config, node.context().global);
                const validation = (0, config_validator_1.validateResolvedConfig)(resolvedConfig);
                if (validation.warnings.length > 0) {
                    for (const warning of validation.warnings) {
                        if (!emittedWarnings.has(warning)) {
                            emittedWarnings.add(warning);
                            node.warn(warning);
                        }
                    }
                }
                if (validation.errors.length > 0) {
                    const errorText = validation.errors.join("; ");
                    node.error(`Invalid viis-modbus-poller config: ${errorText}`);
                    node.status({ fill: "red", shape: "ring", text: "Invalid config" });
                    sendDiagnostics(nodeSend, buildDiagnosticsMessage("error", validation.errors, validation.warnings, {
                        boardId: resolvedConfig.boardId,
                        dueGroups: [],
                    }));
                    done === null || done === void 0 ? void 0 : done();
                    return;
                }
                const dueGroups = getDueGroups(resolvedConfig.pollingConfig, lastPollTimes, startedAt);
                if (dueGroups.length === 0) {
                    node.status({ fill: "grey", shape: "ring", text: "No groups due" });
                    sendDiagnostics(nodeSend, buildDiagnosticsMessage("skipped", ["no groups due"], validation.warnings, {
                        boardId: resolvedConfig.boardId,
                        dueGroups,
                    }));
                    done === null || done === void 0 ? void 0 : done();
                    return;
                }
                markDueGroups(lastPollTimes, dueGroups, startedAt);
                node.status({ fill: "blue", shape: "dot", text: `Polling ${dueGroups.join(", ")}` });
                const client = await getOrCreateSharedModbusClient(resolvedConfig.boardId);
                const result = await (0, poll_runner_1.runPollTick)({
                    modbusClient: client,
                    dueGroups,
                    config: resolvedConfig,
                    previousState,
                    options: {
                        maxGap: options.maxGap,
                        maxCoilsPerRead: options.maxCoilsPerRead,
                        maxRegistersPerRead: options.maxRegistersPerRead,
                        publishFullSnapshot: firstSuccessfulRead && options.publishFullSnapshotOnFirstRead,
                    },
                });
                const latestCount = Object.keys(result.latestData).length;
                if (latestCount > 0) {
                    Object.assign(previousState, result.latestData);
                    firstSuccessfulRead = false;
                    writeLatestGlobalState(node.context().global, resolvedConfig, result.latestData);
                }
                const changedCount = Object.keys(result.changedData).length;
                if (changedCount === 0) {
                    const statusText = result.diagnostics.errorCount > 0 ? "No changes, read errors" : "No changes";
                    node.status({
                        fill: result.diagnostics.errorCount > 0 ? "yellow" : "grey",
                        shape: "ring",
                        text: statusText,
                    });
                    sendDiagnostics(nodeSend, { payload: result.diagnostics });
                    done === null || done === void 0 ? void 0 : done();
                    return;
                }
                const [localMessage, thingsboardMessage] = buildTelemetryMessages(resolvedConfig, result.changedData, Date.now() - startedAt);
                const statusText = result.diagnostics.errorCount > 0
                    ? `Published ${changedCount} keys, ${result.diagnostics.errorCount} errors`
                    : `Published ${changedCount} keys`;
                node.status({
                    fill: result.diagnostics.errorCount > 0 ? "yellow" : "green",
                    shape: "dot",
                    text: statusText,
                });
                nodeSend([localMessage, thingsboardMessage, options.enableDiagnostics ? { payload: result.diagnostics } : null]);
                done === null || done === void 0 ? void 0 : done();
            }
            catch (error) {
                const errorMessage = error.message;
                node.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: "Poll error" });
                sendDiagnostics(nodeSend, buildDiagnosticsMessage("error", [errorMessage], [], {
                    boardId: config.boardId || "board1",
                    dueGroups: [],
                }));
                done === null || done === void 0 ? void 0 : done(error);
            }
            finally {
                pollInProgress = 0;
            }
        });
        node.on("close", (removedOrDone, done) => {
            const closeDone = typeof removedOrDone === "function" ? removedOrDone : done;
            try {
                releaseCurrentModbusClient();
                node.status({});
                closeDone === null || closeDone === void 0 ? void 0 : closeDone();
            }
            catch (error) {
                node.error(`Error closing viis-modbus-poller: ${error.message}`);
                closeDone === null || closeDone === void 0 ? void 0 : closeDone();
            }
        });
    }
    RED.nodes.registerType("viis-modbus-poller", ViisModbusPollerNode);
};
