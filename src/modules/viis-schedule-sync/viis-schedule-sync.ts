import { NodeAPI, Node, NodeDef } from "node-red";
import { MySqlConfig } from "../../core/mysql-client";
import ClientRegistry from "../../core/client-registry";
import { MqttConfig } from "../../core/mqtt-client";
import { SyncScheduleService } from "../../services/syncSchedule/SyncScheduleService";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import { RowDataPacket } from "mysql2";

interface MyNodeDef extends NodeDef {
  configNode: string;
}

interface MsgNodeRed {
  topic: string;
  payload: any;
}

module.exports = function (RED: NodeAPI) {
  async function ViisScheduleSync(this: Node, config: MyNodeDef) {
    RED.nodes.createNode(this, config);

    const node = this;
    const configNode = RED.nodes.getNode(config.configNode) as any;

    if (!configNode) {
      node.error("Configuration node not found");
      return;
    }

    const mysqlConfig: MySqlConfig = {
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

    const thingsboardMqttConfig: MqttConfig = {
      broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${
        process.env.THINGSBOARD_PORT || "1883"
      }`,
      clientId: `node-red-thingsboard-telemetry-${Math.random()
        .toString(16)
        .substr(2, 8)}`,
      username: process.env.DEVICE_ACCESS_TOKEN || "",
      password: process.env.THINGSBOARD_PASSWORD || "",
      qos: 1 as const,
    };

    const mysqlClient = ClientRegistry.getMySqlClient(mysqlConfig, node);
    const thingsboardClient = await ClientRegistry.getThingsboardMqttClient(
      thingsboardMqttConfig,
      node
    );

    if (!mysqlClient || !thingsboardClient) {
      node.error("Failed to retrieve clients from registry");
      node.status({
        fill: "red",
        shape: "ring",
        text: "Client initialization failed",
      });
      return;
    } else {
      console.log(
        "All clients initialized successfully: Modbus, Local MQTT, MySQL, ThingsBoard MQTT"
      );
    }

    const deviceId = global.get("device_id");

    async function cronSyncCreateAndUpdateToServer() {
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
        const res = await mysqlClient.query(query);
        if (Array.isArray(res) && res.length > 0) {
          const schedules: Partial<TabiotSchedule>[] = res.map((row) => ({
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

          const syncScheduleServiceInstance = new SyncScheduleService();
          await syncScheduleServiceInstance
            .syncScheduleFromLocalToServer(schedules)
            .then(async (response) => {
              let syncedSchedules = response.data;
              for (let index = 0; index < syncedSchedules.length; index++) {
                const element = syncedSchedules[index];
                const queryFromServer = `
              UPDATE tabiot_schedule
              SET is_synced = 1
              WHERE name = ?
              `;
                await mysqlClient.query(queryFromServer, [element.name]);
              }
            });
        }
      } catch (err: any) {
        node.error(`Failed to query DB for device id ${deviceId}`);
      }
    }

    async function cronSyncDeleteToServer() {
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
        const res = await mysqlClient.query(query);
        if (Array.isArray(res) && res.length > 0) {
          const schedules: Partial<TabiotSchedule>[] = res.map((row) => ({
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

          const syncScheduleServiceInstance = new SyncScheduleService();
          await syncScheduleServiceInstance
            .syncScheduleFromLocalToServer(schedules)
            .then(async (response) => {
              let syncedSchedules = response.data;
              for (let index = 0; index < syncedSchedules.length; index++) {
                const element = syncedSchedules[index];
                const queryFromServer = `
                  UPDATE tabiot_schedule
                  SET is_synced = 1
                  WHERE name = ?
                `;
                await mysqlClient.query(queryFromServer, [element.name]);
              }
            });
        }
      } catch (err: any) {
        node.error(`Failed to query DB for device id ${deviceId}`);
      }
    }

    // Do action whenever Inject node send a trigger
    node.on("input", function () {
      cronSyncCreateAndUpdateToServer();
      cronSyncDeleteToServer();
    });

    async function syncFromServer(msg) {
      const moment = global.get("moment");
      const serverScheduleList = msg.payload.params || [];
      const rpcMethod = msg.payload.method;

      if (!rpcMethod.includes("schedule-by-backend")) {
        return null;
      }

      function generateSelectQueries(serverScheduleList: any[]) {
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

      const selectQueries = generateSelectQueries(serverScheduleList);

      async function queryExistingSchedules(
        selectQueries: any[]
      ): Promise<any[]> {
        const rows = [];
        for (const element of selectQueries) {
          await mysqlClient
            .query<RowDataPacket[]>(element.query, element.params)
            .then((data) => rows.push(data.rows));
        }
        return rows;
      }

      const selectResult = await queryExistingSchedules(selectQueries);

      async function handleUpdateFromServer() {
        // Node Function 28
      }

      handleUpdateFromServer();
    }

    thingsboardClient.on("message", (msg) => {
      syncFromServer(msg);
    });
  }

  RED.nodes.registerType("viis-schedule-sync", ViisScheduleSync);
};
