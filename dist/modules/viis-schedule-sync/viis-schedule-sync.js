"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const SyncScheduleService_1 = require("../../services/syncSchedule/SyncScheduleService");
module.exports = function (RED) {
    function ViisScheduleSync(config) {
        return __awaiter(this, void 0, void 0, function* () {
            RED.nodes.createNode(this, config);
            const node = this;
            const configNode = RED.nodes.getNode(config.configNode);
            if (!configNode) {
                node.error("Configuration node not found");
                return;
            }
            const mysqlConfig = {
                host: process.env.DATABASE_HOST || "localhost",
                port: process.env.DATABASE_PORT
                    ? parseInt(process.env.DATABASE_PORT, 10)
                    : 3306,
                user: process.env.DATABASE_USER || "root",
                password: process.env.DATABASE_PASSWORD || "",
                database: process.env.DATABASE_NAME || "your_database",
                connectionLimit: process.env.DATABASE_CONNECTION_LIMIT
                    ? parseInt(process.env.DATABASE_CONNECTION_LIMIT, 10)
                    : 10,
            };
            const thingsboardMqttConfig = {
                broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
                clientId: `node-red-thingsboard-telemetry-${Math.random()
                    .toString(16)
                    .substr(2, 8)}`,
                username: process.env.DEVICE_ACCESS_TOKEN || "",
                password: process.env.THINGSBOARD_PASSWORD || "",
                qos: 1,
            };
            const mysqlClient = client_registry_1.default.getMySqlClient(mysqlConfig, node);
            const thingsboardClient = yield client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
            if (!mysqlClient || !thingsboardClient) {
                node.send({ payload: "Failed to retrieve clients from registry" });
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "Client initialization failed",
                });
                return;
            }
            else {
                console.log("All clients initialized successfully: Modbus, Local MQTT, MySQL, ThingsBoard MQTT");
            }
            const globalContext = node.context().global;
            const deviceId = globalContext.get("device_id");
            function cronSyncCreateAndUpdateToServer() {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const query = `
          SELECT
            name,
            creation,
            modified,
            device_id,
            \`action\`,
            COALESCE(enable, 0) AS enable,
            \`interval\`,
            set_time,
            start_date,
            end_date,
            start_time,
            end_time,
            type,
            label,
            is_from_local,
            is_synced,
            is_deleted,
            status,
            schedule_plan_id
          FROM
            tabiot_schedule
          WHERE
            is_synced = 0
            AND is_deleted = 0
            AND device_id = '${deviceId}'
        `;
                        const res = yield mysqlClient.query(query);
                        if (Array.isArray(res) && res.length > 0) {
                            const schedules = res.map((row) => ({
                                name: row.name,
                                creation: row.creation,
                                modified: row.modified,
                                device_id: row.device_id,
                                action: row.action,
                                enable: row.enable,
                                interval: row.interval,
                                set_time: row.set_time,
                                start_date: row.start_date,
                                end_date: row.end_date,
                                start_time: row.start_time,
                                end_time: row.end_time,
                                type: row.type,
                                label: row.label,
                                is_from_local: row.is_from_local,
                                is_synced: row.is_synced,
                                is_deleted: row.is_deleted,
                                status: row.status,
                                schedule_plan_id: row.schedule_plan_id,
                            }));
                            const syncScheduleServiceInstance = new SyncScheduleService_1.SyncScheduleService();
                            yield syncScheduleServiceInstance
                                .syncScheduleFromLocalToServer(schedules)
                                .then((response) => __awaiter(this, void 0, void 0, function* () {
                                let syncedSchedules = response.data;
                                for (let index = 0; index < syncedSchedules.length; index++) {
                                    const element = syncedSchedules[index];
                                    const queryFromServer = `
                  UPDATE tabiot_schedule
                  SET is_synced = 1
                  WHERE name = ?
                  `;
                                    yield mysqlClient.query(queryFromServer, [element.name]);
                                }
                            }));
                        }
                    }
                    catch (err) {
                        node.error(`Failed to query DB for device id ${deviceId}`);
                    }
                });
            }
            function cronSyncDeleteToServer() {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const query = `
          SELECT
            name,
            creation,
            modified,
            device_id,
            \`action\`,
            COALESCE(enable, 0) AS enable,
            \`interval\`,
            set_time,
            start_date,
            end_date,
            start_time,
            end_time,
            type,
            label,
            is_from_local,
            is_synced,
            is_deleted
          FROM
              tabiot_schedule
          WHERE
              is_synced = 0
              AND is_deleted = 1
              AND device_id = '${deviceId}'
          `;
                        const res = yield mysqlClient.query(query);
                        if (Array.isArray(res) && res.length > 0) {
                            const schedules = res.map((row) => ({
                                name: row.name,
                                creation: row.creation,
                                modified: row.modified,
                                device_id: row.device_id,
                                action: row.action,
                                enable: row.enable,
                                interval: row.interval,
                                set_time: row.set_time,
                                start_date: row.start_date,
                                end_date: row.end_date,
                                start_time: row.start_time,
                                end_time: row.end_time,
                                type: row.type,
                                label: row.label,
                                is_from_local: row.is_from_local,
                                is_synced: row.is_synced,
                                is_deleted: row.is_deleted,
                                status: row.status,
                                schedule_plan_id: row.schedule_plan_id,
                            }));
                            const syncScheduleServiceInstance = new SyncScheduleService_1.SyncScheduleService();
                            yield syncScheduleServiceInstance
                                .syncScheduleFromLocalToServer(schedules)
                                .then((response) => __awaiter(this, void 0, void 0, function* () {
                                let syncedSchedules = response.data;
                                for (let index = 0; index < syncedSchedules.length; index++) {
                                    const element = syncedSchedules[index];
                                    const queryFromServer = `
                  UPDATE tabiot_schedule
                  SET is_synced = 1
                  WHERE name = ?
                `;
                                    yield mysqlClient.query(queryFromServer, [element.name]);
                                }
                            }));
                        }
                    }
                    catch (err) {
                        node.error(`Failed to query DB for device id ${deviceId}`);
                    }
                });
            }
            // Do action whenever Inject node send a trigger
            node.on("input", function () {
                cronSyncCreateAndUpdateToServer();
                cronSyncDeleteToServer();
            });
            function syncFromServer(msg) {
                return __awaiter(this, void 0, void 0, function* () {
                    const moment = global.get("moment");
                    const serverScheduleList = msg.payload.params || [];
                    const rpcMethod = msg.payload.method;
                    if (!rpcMethod.includes("schedule-by-backend")) {
                        return null;
                    }
                    function generateSelectQueries(serverScheduleList) {
                        return serverScheduleList.map((schedule) => {
                            let query = `
            SELECT modified FROM tabiot_schedule
            WHERE device_id = ? AND name = ? AND deleted IS NULL`;
                            const params = [schedule.device_id, schedule.name, schedule.modified];
                            // Uncomment and modify the following conditions based on schedule type
                            // if (schedule.type === 'circulate') {
                            //   query += ` AND start_time = ? AND end_time = ? AND \`interval\` = ? ORDER BY modified DESC LIMIT 1`;
                            //   params.push(schedule.start_time, schedule.end_time, schedule.interval);
                            // } else if (schedule.type === 'fixed') {
                            //   query += ` AND set_time = ? AND start_date = ? AND end_date = ? ORDER BY modified DESC LIMIT 1`;
                            //   params.push(schedule.set_time, schedule.start_date, schedule.end_date);
                            // } else if (schedule.type === 'interval') {
                            //   query += ` AND set_time = ? AND \`interval\` = ? ORDER BY modified DESC LIMIT 1`;
                            //   params.push(schedule.set_time, schedule.interval);
                            // }
                            return { query, params };
                        });
                    }
                    function queryExistingSchedules(selectQuerie) {
                        return __awaiter(this, void 0, void 0, function* () {
                            const rows = [];
                            yield mysqlClient
                                .query(selectQuerie.query, selectQuerie.params)
                                .then((data) => rows.push(data.rows));
                            return rows;
                        });
                    }
                    function handleUpdateFromServer() {
                        return __awaiter(this, void 0, void 0, function* () {
                            for (let queryIndex = 0; queryIndex < serverScheduleList.length; queryIndex++) {
                                const serverSchedule = serverScheduleList[queryIndex];
                                const selectResult = yield queryExistingSchedules(generateSelectQueries([serverSchedule])[0]);
                                let sqlQuery = "";
                                let params = [];
                                // Ensure all values are properly formatted and not undefined or null
                                const safeValue = (value) => value !== undefined && value !== null ? value : null;
                                // Function to build query dynamically
                                const buildQuery = (schedule) => {
                                    let fields = [];
                                    let values = [];
                                    let updates = [];
                                    let queryParams = [];
                                    const addField = (field, value) => {
                                        if (value !== undefined && value !== null) {
                                            if (field === "interval") {
                                                field = "`interval`"; // Handle reserved keyword
                                            }
                                            fields.push(field);
                                            values.push("?");
                                            updates.push(`${field} = VALUES(${field})`);
                                            queryParams.push(value);
                                        }
                                    };
                                    addField("name", safeValue(schedule.name));
                                    addField("creation", safeValue(schedule.creation));
                                    addField("modified", safeValue(schedule.modified));
                                    addField("device_id", safeValue(schedule.device_id));
                                    addField("action", safeValue(schedule.action));
                                    addField("enable", safeValue(schedule.enable));
                                    addField("interval", safeValue(schedule.interval)); // Use 'interval' as a field name
                                    addField("set_time", safeValue(schedule.set_time));
                                    addField("start_date", safeValue(schedule.start_date));
                                    addField("end_date", safeValue(schedule.end_date));
                                    addField("start_time", safeValue(schedule.start_time));
                                    addField("end_time", safeValue(schedule.end_time));
                                    addField("status", safeValue(schedule.status));
                                    addField("type", safeValue(schedule.type));
                                    addField("label", safeValue(schedule.label));
                                    addField("is_from_local", 0); // Default value
                                    addField("is_synced", 1); // Default value
                                    addField("is_deleted", safeValue(schedule.is_deleted));
                                    addField("deleted", schedule.is_deleted === 1 ? safeValue(schedule.modified) : null);
                                    addField("schedule_plan_id", safeValue(schedule.schedule_plan_id));
                                    let insertQuery = `
              INSERT INTO tabiot_schedule (
                ${fields.join(", ")}
              ) VALUES (
                ${values.join(", ")}
              )
              ON DUPLICATE KEY UPDATE
              ${updates.join(", ")}
              ;
            `;
                                    return { insertQuery, queryParams };
                                };
                                if (selectResult.length > 0) {
                                    const existingRecord = selectResult[0].modified;
                                    const incomingModified = serverSchedule.modified;
                                    if (moment(existingRecord).isSameOrAfter(incomingModified)) {
                                        node.warn(moment(existingRecord));
                                        node.warn(moment(incomingModified));
                                        node.warn("Skipping record as the existing one is newer or the same");
                                        // Update is_synced flag to 0 for skipped record
                                        sqlQuery = `
                UPDATE tabiot_schedule
                SET is_synced = 0
                WHERE name = ? AND device_id = ?;
              `;
                                        params = [
                                            safeValue(serverSchedule.name),
                                            safeValue(serverSchedule.device_id),
                                        ];
                                        yield mysqlClient.query(sqlQuery, params);
                                        continue; // Skip to the next iteration
                                    }
                                }
                                const { insertQuery, queryParams } = buildQuery(serverSchedule);
                                yield mysqlClient.query(insertQuery, queryParams);
                            }
                        });
                    }
                    handleUpdateFromServer();
                });
            }
            // subscribe to topic before listening for messages
            thingsboardClient.on("message", (msg) => {
                syncFromServer(msg);
            });
        });
    }
    RED.nodes.registerType("viis-schedule-sync", ViisScheduleSync);
};
