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
Object.defineProperty(exports, "__esModule", { value: true });
module.exports = function (RED) {
    function ViisScheduleSync(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNode = RED.nodes.getNode(config.configNode);
        if (!configNode) {
            node.error("Configuration node not found");
            return;
        }
        function saySomething(message) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Saying something...`,
                    });
                    node.send([
                        {
                            payload: {
                                results: message,
                            },
                        },
                    ]);
                }
                catch (error) {
                    console.log(`Error when say something: ${error}`);
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Error: ${error}`,
                    });
                }
            });
        }
        node.on("input", function (msg) {
            saySomething(msg.payload);
        });
    }
    RED.nodes.registerType("viis-schedule-sync", ViisScheduleSync);
};
