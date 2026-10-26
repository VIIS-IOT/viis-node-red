import { NodeAPI, Node } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ViisModbusGetterNodeDef, ServiceOptions, NodeStatus } from "./interfaces/types";
import { ModbusGetterService, offlineWriteOrigin } from "./services/modbusGetterService";
import { Logger } from "./utils/logger";
import { DEFAULT_CONFIG, ENV_KEYS, STATUS_MESSAGES } from "./constants";
import { reportScenarioWriteFromMsg } from "../viis-automation-node/services/scenarioTriggerTracker";
import { getEventOutbox } from "../../services/event-outbox/registry";
import { capAlarmKey } from "../../services/event-outbox/alarm-key";
import { redactDeviceToken } from "../../services/event-outbox/outbox-sender";

/** Status events that raise `board_offline:<boardId>`; `connected` clears it. */
const BOARD_OFFLINE_STATUSES = new Set(['circuit-breaker-open', 'prolonged-disconnect']);

/**
 * Every flex node on a board gets the board's status events; the first node that handles one reports the
 * board until it closes or moves to another board (it then drops the role and the next node on that board
 * to see an event takes it), so the board is one alarm and one request per change.
 */
const boardAlarmReporters = new Map<string, string>();

/**
 * Without the outbox (direct POST, no retry, no stored state) the gateway only knows what it sent in this
 * process. `boardsRaisedDirect`: boards whose Pending reached the backend (a Clear is owed when they come
 * back). `boardsKnownClear`: boards whose Clear reached the backend since the process started. A board in
 * neither set has an unknown backend state (the backend may hold a `board_offline:<id>` from before a
 * restart), so its first healthy moment sends one Clear; backend state alarms notify only on transitions,
 * so a Clear for an alarm that is not active changes nothing.
 */
const boardsRaisedDirect = new Set<string>();
const boardsKnownClear = new Set<string>();
/** Boards with a direct POST under way, so concurrent reads / events do not send the same alert twice. */
const boardsDirectInFlight = new Set<string>();
/** Last startup-Clear attempt per board (a failed POST is retried at most once per `HEALTHY_CLEAR_RETRY_MS`). */
const boardsClearAttemptAt = new Map<string, number>();
const HEALTHY_CLEAR_RETRY_MS = 60_000;

/**
 * Reports a board's connection state as the gateway state alarm `board_offline:<boardId>` (backend
 * `iot_alarm_state`, one raise and one clear per outage). With the event outbox on the alarm is raised or
 * cleared there; otherwise the same payload is POSTed once (no retry) to `/api/v2/alarm/notification-by-token`,
 * and the backend drops a repeated Pending.
 * The device access token goes only in that request's query string, never in a log line.
 */
async function reportBoardAlarm(
    logger: Logger,
    globalHelper: GlobalContextHelper,
    boardId: string,
    event: { status: string; error?: unknown },
    raise: boolean
) {
    try {
        const alarmKey = capAlarmKey(`board_offline:${boardId}`);
        const deviceId = globalHelper.getEnvVar('DEVICE_ID', null) || 'unknown_device';
        const payload: Record<string, any> = {
            alarm_name: alarmKey,
            alarm_key: alarmKey,
            id: deviceId,
            msg: raise ? `Mất kết nối bộ điều khiển ${boardId}` : `Đã kết nối lại bộ điều khiển ${boardId}`,
            message_key: 'iot.notification.device.board_offline',
            message_params: { boardId, status: event.status, error: event.error ?? null },
            message_locale: 'vi-VN',
            severity: 'error',
            trigger_time: new Date().toISOString(),
            tb_alarm_id: alarmKey,
            clear_by_user_id: '',
            entity: deviceId,
        };

        const outbox = getEventOutbox();
        if (outbox) {
            try {
                const stored = raise ? await outbox.raise(alarmKey, payload) : await outbox.clear(alarmKey, payload);
                if (stored) logger.log(`[NOTIFICATION] ${alarmKey} ${raise ? 'raised' : 'cleared'} (outbox)`);
                return;
            } catch (error) {
                logger.warn(`[NOTIFICATION] outbox failed for ${alarmKey}, sending directly: ${(error as Error).message}`);
            }
        }

        if (raise && boardsRaisedDirect.has(boardId)) return; // already reported for this down period
        if (!raise && !boardsRaisedDirect.has(boardId) && boardsKnownClear.has(boardId)) return; // nothing owed
        if (boardsDirectInFlight.has(boardId)) return;

        const deviceAccessToken = globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', null);
        const backendUrl = globalHelper.getEnvVar('VIIS_BACKEND', null);
        if (!deviceAccessToken || !backendUrl) {
            logger.warn('[NOTIFICATION] VIIS_BACKEND or device_access_token not found, skipping alert');
            return;
        }

        payload.alarm_status = raise ? 'Pending' : 'Clear';
        payload.clear_by = raise ? '' : 'Value';
        const urlWithToken = `${backendUrl}/api/v2/alarm/notification-by-token?device_access_token=${encodeURIComponent(deviceAccessToken)}`;

        logger.log(`[NOTIFICATION] Sending alert to: ${redactDeviceToken(urlWithToken)}`);

        boardsDirectInFlight.add(boardId);
        try {
            const response = await fetch(urlWithToken, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                if (raise) {
                    boardsRaisedDirect.add(boardId);
                    boardsKnownClear.delete(boardId);
                } else {
                    boardsRaisedDirect.delete(boardId);
                    boardsKnownClear.add(boardId);
                }
                logger.log(`[NOTIFICATION] Alert sent successfully: ${event.status}`);
            } else {
                const errorText = await response.text();
                logger.error(`[NOTIFICATION] Failed to send alert: ${response.status} - ${errorText}`);
            }
        } finally {
            boardsDirectInFlight.delete(boardId);
        }
    } catch (error) {
        // fetch quotes the whole request URL in some failures (e.g. "Failed to parse URL from <url>").
        logger.error(`[NOTIFICATION] Error sending alert: ${redactDeviceToken((error as Error).message)}`);
    }
}

/**
 * A read or write of `boardId` just succeeded, so the board is healthy. Outbox off: if the backend state of
 * `board_offline:<boardId>` is unknown (after a restart), send one Clear. A board this process raised is
 * cleared by its `connected` event instead. Cheap after that: a set lookup.
 */
async function reportBoardHealthy(logger: Logger, globalHelper: GlobalContextHelper, boardId: string) {
    if (getEventOutbox()) return; // the outbox keeps the alarm state and sends transitions only
    if (boardsKnownClear.has(boardId) || boardsRaisedDirect.has(boardId)) return;
    // Reads run every second: while the backend is unreachable (or unconfigured) try once a minute, quietly.
    if (!globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', null) || !globalHelper.getEnvVar('VIIS_BACKEND', null)) return;
    const now = Date.now();
    if (now - (boardsClearAttemptAt.get(boardId) ?? 0) < HEALTHY_CLEAR_RETRY_MS) return;
    boardsClearAttemptAt.set(boardId, now);
    await reportBoardAlarm(logger, globalHelper, boardId, { status: 'connected' }, false);
}

/**
 * VIIS Modbus Flex Node
 * A custom Node-RED node for reading data from Modbus devices using shared connection resources
 */
module.exports = function (RED: NodeAPI) {
    function ViisModbusGetterNode(this: Node, config: ViisModbusGetterNodeDef) {
        RED.nodes.createNode(this, config as any);
        const node = this;
        let modbusGetterService: ModbusGetterService | null = null;
        let logger: Logger;
        let configCheckInterval: NodeJS.Timeout | null = null;
        let currentModbusConfig: any = null;
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let detachModbusStatus: () => void = () => undefined;
        /**
         * The board of the client this node is attached to (`board_offline:<id>`). A node can switch boards
         * through `msg.payload.boardId`, so this follows the client, not the configured `config.boardId`.
         */
        let alarmBoardId: string = config.boardId || 'default';
        /** The board whose client a node reads, from the board it is on or the default of the board set. */
        const boardOf = (multi: boolean, defaultBoard?: string): string =>
            multi ? (currentBoardId || defaultBoard || 'default') : (config.boardId || 'default');
        const releaseReporterRole = () => {
            if (boardAlarmReporters.get(alarmBoardId) === node.id) boardAlarmReporters.delete(alarmBoardId);
        };

        try {
            // Initialize logger with enableLogging flag from config
            logger = new Logger(node, node.id, config.enableLogging);
            logger.log("Initializing VIIS Modbus Flex Node...");

            // Set initial status
            node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

            // Initialize GlobalContextHelper for environment variables
            const globalHelper = new GlobalContextHelper(node.context());

            const attachModbusStatus = (client: any, boardId: string) => {
                detachModbusStatus();
                detachModbusStatus = () => undefined;
                // Moved to another board: hand the reporter role of the old board back.
                if (boardId !== alarmBoardId) {
                    releaseReporterRole();
                    alarmBoardId = boardId;
                }
                const eventBoardId = boardId;

                if (!client || typeof client.on !== "function") {
                    logger.warn("[MODBUS-GETTER] Client has no modbus-status events; polling continues");
                    return;
                }

                const handler = async (event: any) => {
                    logger.log(`[EVENT] Board ${eventBoardId}: ${event.status} - ${event.error || ''}`);

                    const raise = BOARD_OFFLINE_STATUSES.has(event.status);
                    if (raise || event.status === 'connected') {
                        const reporter = boardAlarmReporters.get(eventBoardId);
                        if (!reporter) boardAlarmReporters.set(eventBoardId, node.id);
                        if (!reporter || reporter === node.id) {
                            await reportBoardAlarm(logger, globalHelper, eventBoardId, event, raise);
                        }
                    }

                    switch (event.status) {
                        case 'connected':
                            node.status({ fill: "green", shape: "dot", text: "Connected" });
                            break;
                        case 'disconnected':
                            node.status({ fill: "red", shape: "ring", text: `Disconnected: ${event.error}` });
                            break;
                        case 'circuit-breaker-open':
                            const recoveryMin = event.recoveryAt ?
                                Math.round((event.recoveryAt - Date.now()) / 60000) : 5;
                            node.status({
                                fill: "yellow",
                                shape: "ring",
                                text: `Circuit Breaker (retry in ${recoveryMin}m)`
                            });
                            break;
                        case 'error':
                            node.status({ fill: "yellow", shape: "ring", text: `Error: ${event.error}` });
                            break;
                    }
                };

                try {
                    client.on("modbus-status", handler);
                } catch (error) {
                    logger.warn(`[MODBUS-GETTER] Status subscription skipped: ${(error as Error).message}`);
                    return;
                }

                detachModbusStatus = () => {
                    try {
                        if (typeof client.removeListener === "function") {
                            client.removeListener("modbus-status", handler);
                        } else if (typeof client.off === "function") {
                            client.off("modbus-status", handler);
                        }
                    } catch (error) {
                        logger.warn(`[MODBUS-GETTER] Status unsubscribe skipped: ${(error as Error).message}`);
                    }
                };
            };

            // Helper function to read fresh Modbus config from global context
            const readModbusConfig = () => {
                // Check for multi-board configuration
                const boardsConfig = globalHelper.getEnvVar(ENV_KEYS.MODBUS_BOARDS, null);

                if (boardsConfig) {
                    try {
                        let boards;

                        // Handle both already-parsed array and JSON string
                        if (Array.isArray(boardsConfig)) {
                            boards = boardsConfig;
                        } else if (typeof boardsConfig === 'string') {
                            boards = JSON.parse(boardsConfig);
                        } else {
                            logger.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfig}`);
                            boards = null;
                        }

                        if (Array.isArray(boards) && boards.length > 0) {
                            // Multi-board mode
                            return {
                                mode: 'multi',
                                boards: boards,
                                defaultBoard: globalHelper.getEnvVar(ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id)
                            };
                        }
                    } catch (e) {
                        logger.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                    }
                }

                // Single-board mode (backward compatible)
                return {
                    mode: 'single',
                    config: {
                        type: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, DEFAULT_CONFIG.MODBUS_TYPE) as "TCP" | "RTU"),
                        host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, DEFAULT_CONFIG.MODBUS_HOST),
                        tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, DEFAULT_CONFIG.MODBUS_TCP_PORT),
                        serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
                        baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, DEFAULT_CONFIG.MODBUS_BAUD_RATE),
                        parity: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, DEFAULT_CONFIG.MODBUS_PARITY) as "none" | "even" | "odd"),
                        unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, DEFAULT_CONFIG.MODBUS_UNIT_ID),
                        timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, DEFAULT_CONFIG.MODBUS_TIMEOUT),
                        reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL)
                    }
                };
            };

            // Build modbus configuration from environment variables
            const configData = readModbusConfig();
            currentModbusConfig = { ...configData }; // Store for hot-reload detection

            // Auto-detect mode
            if (configData.mode === 'multi') {
                isMultiBoardMode = true;
                logger.log(`Multi-board mode detected with ${configData.boards.length} boards`);

                // Initialize multi-board configuration
                const multiConfig: MultiModbusConfig = {
                    mode: 'multi',
                    defaultBoard: configData.defaultBoard,
                    boards: configData.boards
                };
                ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
            } else {
                isMultiBoardMode = false;
                logger.log(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
            }

            // Get or create shared Modbus client
            logger.log("Getting shared Modbus client from ClientRegistry...");
            ClientRegistry.logConnectionCounts(node);

            // Determine which client to get based on mode and configuration
            let modbusClient: any;

            // Wrap async initialization in IIFE
            (async () => {
                try {
                    if (isMultiBoardMode) {
                        const boardToUse = currentBoardId || configData.defaultBoard;
                        logger.log(`Getting client for board: ${boardToUse}`);
                        modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                    } else {
                        modbusClient = await ClientRegistry.getModbusClientV2(configData.config, node);
                    }

                    if (!modbusClient) {
                        throw new Error("Failed to initialize Modbus client");
                    }

                    logger.log("Modbus client initialized successfully");
                    ClientRegistry.logConnectionCounts(node);

                    // Create service options with enableLogging flag
                    const serviceOptions: ServiceOptions = {
                        node: node,
                        nodeId: node.id,
                        enableLogging: config.enableLogging
                    };

                    // Initialize modbus getter service
                    modbusGetterService = new ModbusGetterService(serviceOptions, modbusClient);
                    logger.log("ModbusGetterService initialized successfully");

                    // Log configuration status
                    if (config.enableLogging) {
                        logger.log("Detailed logging is ENABLED");
                    } else {
                        logger.log("Detailed logging is DISABLED");
                    }

                    // Set ready status
                    node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });

                    // Status events are optional. A missing .on() must not abort polling.
                    attachModbusStatus(modbusClient, boardOf(isMultiBoardMode, configData.defaultBoard));
                    logger.log("Modbus status event listener registered");

            // Auto-detect config changes every 30 seconds
            configCheckInterval = setInterval(async () => {
                try {
                    const newConfig = readModbusConfig();

                    // Check if mode has changed or if critical config has changed
                    let hasChanged = false;
                    let changeDescription = "";

                    if (currentModbusConfig.mode !== newConfig.mode) {
                        hasChanged = true;
                        changeDescription = `mode changed from ${currentModbusConfig.mode} to ${newConfig.mode}`;
                    } else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
                        // Check single mode config changes
                        const oldCfg = currentModbusConfig.config;
                        const newCfg = newConfig.config;
                        hasChanged =
                            oldCfg.host !== newCfg.host ||
                            oldCfg.tcpPort !== newCfg.tcpPort ||
                            oldCfg.serialPort !== newCfg.serialPort ||
                            oldCfg.type !== newCfg.type;
                        if (hasChanged) {
                            changeDescription = `${newCfg.host}:${newCfg.tcpPort}`;
                        }
                    } else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                        // Check multi mode config changes
                        const oldBoards = JSON.stringify(currentModbusConfig.boards);
                        const newBoards = JSON.stringify(newConfig.boards);
                        hasChanged = oldBoards !== newBoards;
                        if (hasChanged) {
                            changeDescription = `board configuration updated`;
                        }
                    }

                    if (hasChanged) {
                        logger.log(`[HOT-RELOAD] Config change detected: ${changeDescription}`);

                        // Reinitialize based on new mode
                        if (newConfig.mode === 'multi') {
                            const multiConfig: MultiModbusConfig = {
                                mode: 'multi',
                                defaultBoard: newConfig.defaultBoard,
                                boards: newConfig.boards
                            };
                            ClientRegistry.initializeMultiBoardConfig(multiConfig, node);

                            // Get new client for current board
                            const boardToUse = currentBoardId || newConfig.defaultBoard;
                            modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                        } else {
                            // Single mode reload
                            const reloaded = await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                            if (reloaded) {
                                modbusClient = await ClientRegistry.getModbusClientV2(newConfig.config, node);
                            }
                        }

                        // Update service with new client and move the status listener
                        // onto that client. Each flex instance keeps its own listener.
                        if (modbusGetterService && modbusClient) {
                            (modbusGetterService as any).modbusClient = modbusClient;
                            attachModbusStatus(modbusClient, boardOf(newConfig.mode === 'multi', newConfig.defaultBoard));
                        }

                        currentModbusConfig = { ...newConfig };
                        isMultiBoardMode = newConfig.mode === 'multi';
                        logger.log(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);

                        // Show brief reload notification
                        node.status({ fill: "green", shape: "dot", text: `Reloaded: ${changeDescription}` });
                        setTimeout(() => {
                            node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
                        }, 3000);
                    }
                } catch (error) {
                    logger.error(`[HOT-RELOAD] Config check error: ${(error as Error).message}`);
                }
            }, 30000); // Check every 30 seconds

            logger.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");

            // Handle incoming messages
            node.on("input", async (msg: any, send: any, done: any) => {
                try {
                    if (!modbusGetterService) {
                        throw new Error("ModbusGetterService not initialized");
                    }

                    // Check if a different board is requested in the payload (multi-board mode)
                    // Priority: msg.payload.boardId > config.boardId > defaultBoard
                    const targetBoardId = (msg.payload && msg.payload.boardId) || currentBoardId;

                    if (isMultiBoardMode && targetBoardId && targetBoardId !== currentBoardId) {
                        const requestedBoardId = targetBoardId;
                        logger.log(`Switching to board: ${requestedBoardId}`);
                        detachModbusStatus();
                        detachModbusStatus = () => undefined;
                        // This node no longer listens to the old board: another node on it takes over reporting.
                        releaseReporterRole();

                        // Release current board connection
                        if (currentBoardId) {
                            ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                        }

                        // Get client for requested board
                        try {
                            modbusClient = await ClientRegistry.getModbusClientV2(requestedBoardId, node);
                            currentBoardId = requestedBoardId;

                            // Update service with new client
                            if (modbusGetterService) {
                                (modbusGetterService as any).modbusClient = modbusClient;
                                attachModbusStatus(modbusClient, requestedBoardId);
                            }

                            logger.log(`Switched to board: ${requestedBoardId}`);
                        } catch (error) {
                            throw new Error(`Failed to switch to board ${requestedBoardId}: ${(error as Error).message}`);
                        }
                    }

                    // Set reading status
                    node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.READING });

                    // Log incoming request if logging is enabled
                    if (config.enableLogging) {
                        logger.debug(`Processing request: ${JSON.stringify(msg.payload)}`);
                    }

                    // Process the modbus request
                    // OFFLINE intent chain: a managed coil becomes an arbiter claim (ARBITER_MODE=enforce).
                    const response = await modbusGetterService.processRequest(
                        msg.payload,
                        offlineWriteOrigin(msg, config.writeSource, targetBoardId ?? null)
                    );

                    // A read that returned data (or a write that succeeded) proves the board answers: after a
                    // restart this sends the one Clear the backend may be waiting for (outbox off only).
                    if (Array.isArray(response) || (response as any)?.success === true) {
                        void reportBoardHealthy(logger, globalHelper, alarmBoardId);
                    }

                    // Update message payload with response
                    msg.payload = response;
                    try {
                        reportScenarioWriteFromMsg(msg, response);
                    } catch (reportError) {
                        logger.warn(`[SCENARIO-EVENT] write report skipped: ${(reportError as Error).message}`);
                    }

                    // Log successful response if logging is enabled
                    if (config.enableLogging) {
                        logger.debug(`Response: ${JSON.stringify(response)}`);
                    }

                    // Send the message
                    send(msg);

                    // Set ready status
                    node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });

                    // Call done to indicate completion
                    if (done) {
                        done();
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                    // Always log errors regardless of enableLogging setting
                    logger.error(`Error processing request: ${errorMessage}`);

                    // Set error status
                    node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });

                    // Send error response
                    msg.payload = {
                        error: errorMessage,
                        timestamp: Date.now()
                    };
                    try {
                        reportScenarioWriteFromMsg(msg, msg.payload);
                    } catch (reportError) {
                        logger.warn(`[SCENARIO-EVENT] write report skipped: ${(reportError as Error).message}`);
                    }
                    send(msg);

                    // Call done with error
                    if (done) {
                        done(error);
                    }
                }
            });

            logger.log("VIIS Modbus Flex Node initialized successfully");

                } catch (initError) {
                    const errorMessage = initError instanceof Error ? initError.message : 'Unknown async initialization error';
                    logger.error(`Async initialization failed: ${errorMessage}`);
                    node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
                }
            })();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';

            if (logger) {
                logger.error(`Initialization failed: ${errorMessage}`);
            } else {
                node.error(`[MODBUS-GETTER-${node.id}] Initialization failed: ${errorMessage}`);
            }

            node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
            return;
        }

        // Cleanup when node is closed
        node.on("close", (done: any) => {
            try {
                logger.log("Closing VIIS Modbus Flex Node...");
                detachModbusStatus();
                detachModbusStatus = () => undefined;
                releaseReporterRole();

                // Stop config check interval
                if (configCheckInterval) {
                    clearInterval(configCheckInterval);
                    configCheckInterval = null;
                    logger.log("[CLEANUP] Config check interval stopped");
                }

                // Release shared modbus client
                if (isMultiBoardMode && currentBoardId) {
                    ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
                    logger.log(`Modbus board ${currentBoardId} client released`);
                } else {
                    ClientRegistry.releaseClientV2("modbus", node);
                    logger.log("Modbus client released");
                }

                // Clear service reference
                modbusGetterService = null;

                logger.log("VIIS Modbus Flex Node closed successfully");

                if (done) {
                    done();
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown cleanup error';
                logger.error(`Error during cleanup: ${errorMessage}`);

                if (done) {
                    done(error);
                }
            }
        });
    }

    // Register the node type
    RED.nodes.registerType("viis-modbus-flex", ViisModbusGetterNode);
};
