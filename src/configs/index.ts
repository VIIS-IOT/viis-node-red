// import dotenv from 'dotenv';
// // Set the NODE_ENV to 'development' by default
// process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// const envFound = dotenv.config();
// if (envFound.error) {
//     // This error should crash whole process
//     throw new Error("⚠️ Fuckkkk Couldn't find .env file  ⚠️");
// }

import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";

/**
 * Configuration factory function that uses global context exclusively
 * @param nodeContext - Optional Node-RED node context for global variable access
 * @returns Configuration object
 */
export function createConfig(nodeContext?: NodeContext) {
    // Create helper if nodeContext is available
    const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;

    // Helper function to get environment variable from global context only
    const getEnvVar = (envVarName: string, defaultValue?: any): any => {
        if (helper) {
            return helper.getEnvVar(envVarName, defaultValue);
        }
        // No nodeContext: return default only (no process.env fallback)
        return defaultValue;
    };

    const getNumericEnvVar = (envVarName: string, defaultValue: number = 0): number => {
        if (helper) {
            return helper.getNumericEnvVar(envVarName, defaultValue);
        }
        // No nodeContext: return default only (no process.env fallback)
        return defaultValue;
    };

    const getBooleanEnvVar = (envVarName: string, defaultValue: boolean = false): boolean => {
        if (helper) {
            return helper.getBooleanEnvVar(envVarName, defaultValue);
        }
        // No nodeContext: return default only (no process.env fallback)
        return defaultValue;
    };

    return {
        /**
         * Device configuration
         */
        deviceId: getEnvVar('DEVICE_ID'),
        deviceAccessToken: getEnvVar('DEVICE_ACCESS_TOKEN'),
        deviceLabel: getEnvVar('DEVICE_LABEL'),
        deviceSerial: getEnvVar('DEVICE_SERIAL'),
        deviceProfileId: getEnvVar('DEVICE_PROFILE_ID'),
        deviceProfileLabel: getEnvVar('DEVICE_PROFILE_LABEL'),
        
        /**
         * Your favorite port
         */
        port: getNumericEnvVar('PORT', 3000),
        serverUrl: getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech'),
        erpUrl: getEnvVar('ERP_URL', 'https://erp.viis.tech'),
        noderedUrl: 'http://54.255.158.241:1880',
        thingsboardUrl: getEnvVar('THINGSBOARD_URL', 'https://device-iotcore.viis.tech/'),
        emqxEndpoint: getEnvVar('EMQX_ENDPOINT', 'https://iot-bridge.viis.tech'),
        weatherApiUrl: 'https://api.weatherapi.com/v1',
        webhookUrl: getEnvVar('WEBHOOK_URL', 'https://webhook.viis.tech'),
        expiredCookie: getNumericEnvVar('EXPIRED_DAY_COOKIE', 3) * 86400 * 1000,

        cookieAuthName: `authorization`,

        // Token for supper admin
        basicAuthFrappe: getEnvVar('BASIC_AUTH_FRAPPE'),

        /**
         * Thingsboard token
         */

        bearerAuthThingsboard: getEnvVar('BEARER_AUTH_THINGSBOARD'),
        bearerAuthThingsboardSysAdmin: getEnvVar('BEARER_AUTH_THINGSBOARD_SYSTEM'),
        /**
         * Your secret sauce
         */
        jwtSecret: getEnvVar('JWT_SECRET', 'axcela'),
        jwtTbSecret: getEnvVar('JWT_TB_SECRET', 'axcela'),
        /**
         * Used by winston logger
         */
        logs: {
            level: getEnvVar('LOG_LEVEL', 'silly'),
        },

        /**
         * API configs
         */
        api: {
            prefix: getEnvVar('API_PREFIX', '/api'),
        },
        authorizationMode: getEnvVar('AUTHORIZATION_MODE', 'adminToken'),
        cookieSessionSecure: getBooleanEnvVar('COOKIE_SESSION_SECURE', false),
        cookieSessionSamsite: <any>getEnvVar('COOKIE_SESSION_SAMESITE', 'lax'),

        snsTopicArnPrefix: getEnvVar('SNS_TOPIC_ARN_PREFIX'),
        snsTopicOwner: getEnvVar('SNS_TOPIC_OWNER'),
        snsGlobalTopicArn: getEnvVar('SNS_GLOBAL_TOPIC_ARN'),
        snsPlatformApplicationArn: getEnvVar('SNS_APPLICATION_ARN'),
        googleCloudToken: getEnvVar('GOOGLE_CLOUD_TOKEN', 'GOOGLE_CLOUD_TOKEN'),
        weatherApiToken: getEnvVar('WEATHER_API_TOKEN', 'WEATHER_API_TOKEN'),
        emqxAccessKey: getEnvVar('EMQX_ACCESS_KEY', 'emqx'),
        emqxSecretKey: getEnvVar('EMQX_SECRET_KEY', 'emqx'),
        AWS_SNS_ACCESS_KEY_ID: getEnvVar('AWS_SNS_ACCESS_KEY_ID', ''),
        AWS_SNS_SECRET_ACCESS_KEY: getEnvVar('AWS_SNS_SECRET_ACCESS_KEY', ''),
    };
}

// Default export for backward compatibility (uses process.env only)
export default createConfig();
