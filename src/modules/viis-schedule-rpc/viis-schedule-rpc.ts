/**
 * viis-schedule-rpc Node
 * 
 * Responsibility: Route schedule-related RPC commands to appropriate outputs
 * Receives RPC messages from upstream MQTT subscriber (viis-mqtt-client or viis-config-node)
 * and routes based on method to different outputs.
 * 
 * Input: msg.payload = { method: string, params: { scheduleId?: string, ... } }
 * Output 1: schedule-disable-by-backend
 * Output 2: confirm-devices-off
 * Output 3: control (general Modbus control)
 * Output 4: set_control_mode
 * Output 5: unknown/other methods
 */

import { NodeAPI, Node } from "node-red";
import { ScheduleExecutorV2NodeDef, RpcPayload } from "../schedule-executor-v2/common/types";

const RPC_METHODS = {
    SCHEDULE_DISABLE: "schedule-disable-by-backend",
    CONFIRM_DEVICES_OFF: "confirm-devices-off",
    CONTROL: "control",
    SET_CONTROL_MODE: "set_control_mode",
} as const;

module.exports = function (RED: NodeAPI) {
    function ScheduleRpcNode(this: Node, config: ScheduleExecutorV2NodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        const debugEnable = config.debugEnable || false;

        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        debugLog("📡 viis-schedule-rpc initialized");

        node.on("input", function (msg: any, send, done) {
            try {
                const payload = msg.payload as RpcPayload;

                if (!payload || typeof payload !== 'object' || !payload.method) {
                    debugLog("Ignoring message without method");
                    send([null, null, null, null, msg]); // pass to catch-all
                    done();
                    return;
                }

                const method = payload.method;
                debugLog(`Received RPC method: ${method}`);

                let outputIndex: number;

                switch (method) {
                    case RPC_METHODS.SCHEDULE_DISABLE:
                        outputIndex = 0;
                        node.status({ fill: "blue", shape: "dot", text: `disable: ${payload.params?.scheduleId || '?'}` });
                        break;

                    case RPC_METHODS.CONFIRM_DEVICES_OFF:
                        outputIndex = 1;
                        node.status({ fill: "blue", shape: "dot", text: `confirm: ${payload.params?.scheduleId || '?'}` });
                        break;

                    case RPC_METHODS.CONTROL:
                        outputIndex = 2;
                        node.status({ fill: "blue", shape: "dot", text: `control: ${Object.keys(payload.params || {}).length} keys` });
                        break;

                    case RPC_METHODS.SET_CONTROL_MODE:
                        outputIndex = 3;
                        node.status({ fill: "blue", shape: "dot", text: `mode: ${(payload.params as any)?.mode || '?'}` });
                        break;

                    default:
                        outputIndex = 4;
                        node.status({ fill: "grey", shape: "ring", text: `unknown: ${method}` });
                        debugLog(`Unknown RPC method: ${method}`);
                        break;
                }

                // Send to the correct output, null to all others
                const outputs = [null, null, null, null, null];
                outputs[outputIndex] = msg;
                send(outputs);

                done();
            } catch (error) {
                const errorMessage = (error as Error).message;
                node.error(`RPC routing failed: ${errorMessage}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                done(error);
            }
        });

        node.on("close", () => {
            debugLog("viis-schedule-rpc closed");
            node.status({});
        });
    }

    RED.nodes.registerType("viis-schedule-rpc", ScheduleRpcNode);
};
