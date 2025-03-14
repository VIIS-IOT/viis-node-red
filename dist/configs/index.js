"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// Set the NODE_ENV to 'development' by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const envFound = dotenv_1.default.config();
if (envFound.error) {
    // This error should crash whole process
    throw new Error("⚠️  Couldn't find .env file  ⚠️");
}
exports.default = {
    /**
     * Your favorite port
     */
    port: Number(process.env.PORT || 3000),
    serverUrl: process.env.BACKEND_URL || 'https://iot.viis.tech',
    erpUrl: process.env.ERP_URL || 'https://erp.viis.tech',
    noderedUrl: 'http://54.255.158.241:1880',
    thingsboardUrl: process.env.THINGSBOARD_URL || 'https://device-iotcore.viis.tech/',
    emqxEndpoint: process.env.EMQX_ENDPOINT || 'https://iot-bridge.viis.tech',
    weatherApiUrl: 'https://api.weatherapi.com/v1',
    webhookUrl: process.env.WEBHOOK_URL || 'https://webhook.viis.tech',
    expiredCookie: Number(process.env.EXPIRED_DAY_COOKIE || 3) * 86400 * 1000,
    cookieAuthName: `authorization`,
    // Token for supper admin
    basicAuthFrappe: process.env.BASIC_AUTH_FRAPPE,
    /**
     * Thingsboard token
     */
    bearerAuthThingsboard: process.env.BEARER_AUTH_THINGSBOARD,
    bearerAuthThingsboardSysAdmin: process.env.BEARER_AUTH_THINGSBOARD_SYSTEM,
    /**
     * Your secret sauce
     */
    jwtSecret: process.env.JWT_SECRET || 'axcela',
    jwtTbSecret: process.env.JWT_TB_SECRET || 'axcela',
    /**
     * Used by winston logger
     */
    logs: {
        level: process.env.LOG_LEVEL || 'silly',
    },
    /**
     * API configs
     */
    api: {
        prefix: process.env.API_PREFIX || '/api',
    },
    authorizationMode: process.env.AUTHORIZATION_MODE || 'adminToken',
    cookieSessionSecure: Boolean(process.env.COOKIE_SESSION_SECURE || false),
    cookieSessionSamsite: process.env.COOKIE_SESSION_SAMESITE || 'lax',
    snsTopicArnPrefix: process.env.SNS_TOPIC_ARN_PREFIX,
    snsTopicOwner: process.env.SNS_TOPIC_OWNER,
    snsGlobalTopicArn: process.env.SNS_GLOBAL_TOPIC_ARN,
    snsPlatformApplicationArn: process.env.SNS_APPLICATION_ARN,
    googleCloudToken: process.env.GOOGLE_CLOUD_TOKEN || 'GOOGLE_CLOUD_TOKEN',
    weatherApiToken: process.env.WEATHER_API_TOKEN || 'WEATHER_API_TOKEN',
    emqxAccessKey: process.env.EMQX_ACCESS_KEY || 'emqx',
    emqxSecretKey: process.env.EMQX_SECRET_KEY || 'emqx',
    AWS_SNS_ACCESS_KEY_ID: process.env.AWS_SNS_ACCESS_KEY_ID || '',
    AWS_SNS_SECRET_ACCESS_KEY: process.env.AWS_SNS_SECRET_ACCESS_KEY || '',
};
