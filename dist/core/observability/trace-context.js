"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createId = void 0;
exports.extractBusinessRequestId = extractBusinessRequestId;
exports.createTraceContext = createTraceContext;
exports.attachBusinessRequestId = attachBusinessRequestId;
exports.createOperationContext = createOperationContext;
const crypto_1 = require("crypto");
const createId = () => (0, crypto_1.randomUUID)();
exports.createId = createId;
function extractBusinessRequestId(payload) {
    var _a, _b;
    const candidates = [
        ["params.requestId", (_a = payload === null || payload === void 0 ? void 0 : payload.params) === null || _a === void 0 ? void 0 : _a.requestId],
        ["params.request_id", (_b = payload === null || payload === void 0 ? void 0 : payload.params) === null || _b === void 0 ? void 0 : _b.request_id],
        ["request_id", payload === null || payload === void 0 ? void 0 : payload.request_id],
        ["requestId", payload === null || payload === void 0 ? void 0 : payload.requestId],
    ];
    for (const [source, value] of candidates) {
        if (value === undefined || value === null || value === "")
            continue;
        if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
            return { invalid: source };
        }
        return { id: value, source };
    }
    return {};
}
function createTraceContext(args) {
    var _a;
    const requestMatch = (_a = args.topic) === null || _a === void 0 ? void 0 : _a.match(/^v1\/devices\/me\/rpc\/request\/([^/]+)$/);
    const businessId = extractBusinessRequestId(args.payload);
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ runtimeBootId: args.runtimeBootId, nodeId: args.nodeId, nodeInstanceId: args.nodeInstanceId }, (args.deviceId ? { deviceId: args.deviceId.slice(0, 128) } : {})), { traceId: args.traceId || (0, exports.createId)(), ingress: args.ingress, brokerRole: args.brokerRole }), (requestMatch ? { mqttRequestId: requestMatch[1].slice(0, 128) } : {})), (args.nodeRedMessageId ? { nodeRedMessageId: args.nodeRedMessageId.slice(0, 128) } : {})), (businessId.id ? { businessRequestId: businessId.id, businessRequestIdSource: businessId.source } : {})), (args.duplicateOfTraceId ? { duplicateOfTraceId: args.duplicateOfTraceId } : {}));
}
function attachBusinessRequestId(context, payload) {
    const businessId = extractBusinessRequestId(payload);
    if (businessId.id) {
        return { context: Object.assign(Object.assign({}, context), { businessRequestId: businessId.id, businessRequestIdSource: businessId.source }) };
    }
    return Object.assign({ context }, (businessId.invalid ? { invalidSource: businessId.invalid } : {}));
}
function createOperationContext(context, values = {}) {
    return Object.assign(Object.assign(Object.assign({}, context), values), { operationId: values.operationId || (0, exports.createId)() });
}
