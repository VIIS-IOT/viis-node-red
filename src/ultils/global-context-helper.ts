/**
 * Global Context Helper for VIIS Node-RED Custom Nodes
 * Provides utilities to access environment variables from Node-RED global context
 * with fallback to process.env for backward compatibility
 *
 * @author VIIS Team
 * @version 1.0.0
 */

import { NodeContext } from "node-red";

/**
 * Environment variable mapping from process.env names to global context names
 */
const ENV_TO_GLOBAL_MAPPING: Record<string, string> = {
  'DEVICE_ID': 'device_id',
  'DEVICE_ACCESS_TOKEN': 'device_access_token',
  'DEVICE_LABEL': 'device_label',
  'DEVICE_SERIAL': 'device_serial',
  'DEVICE_PROFILE_ID': 'device_profile_id',
  'DEVICE_PROFILE_LABEL': 'device_profile_label',
  'VIIS_BACKEND': 'server_url',
  'BACKEND_URL': 'backend_url',
  // Modbus configuration
  'MODBUS_HOST': 'modbus_host',
  'MODBUS_TCP_PORT': 'modbus_tcp_port',
  'MODBUS_TYPE': 'modbus_type',
  'MODBUS_SERIAL_PORT': 'modbus_serial_port',
  'MODBUS_BAUD_RATE': 'modbus_baud_rate',
  'MODBUS_PARITY': 'modbus_parity',
  'MODBUS_UNIT_ID': 'modbus_unit_id',
  'MODBUS_TIMEOUT': 'modbus_timeout',
  'MODBUS_RECONNECT_INTERVAL': 'modbus_reconnect_interval',
  'MODBUS_HOLDING_REGISTERS': 'modbusHoldingRegisters',
  'MODBUS_INPUT_REGISTERS': 'modbusInputRegisters',
  'MODBUS_COILS': 'modbusCoils',
  // Multi-board configuration
  'MODBUS_BOARDS': 'modbus_boards',
  'MODBUS_DEFAULT_BOARD': 'modbus_default_board',
  // Board-specific mappings (for per-board coils/registers)
  'MODBUS_BOARD1_COILS': 'modbus_board1_coils',
  'MODBUS_BOARD2_COILS': 'modbus_board2_coils',
  'MODBUS_BOARD1_HOLDING_REGISTERS': 'modbus_board1_holding_registers',
  'MODBUS_BOARD2_HOLDING_REGISTERS': 'modbus_board2_holding_registers',
  'MODBUS_BOARD1_INPUT_REGISTERS': 'modbus_board1_input_registers',
  'MODBUS_BOARD2_INPUT_REGISTERS': 'modbus_board2_input_registers',
  // ThingsBoard configuration
  'THINGSBOARD_HOST': 'thingsboard_host',
  'THINGSBOARD_PORT': 'thingsboard_port',
  'THINGSBOARD_PASSWORD': 'thingsboard_password',
  'THINGSBOARD_URL': 'thingsboard_url',
  // EMQX configuration
  'EMQX_HOST': 'emqx_host',
  'EMQX_PORT': 'emqx_port',
  'EMQX_USERNAME': 'emqx_username',
  'EMQX_PASSWORD': 'emqx_password',
  // Database configuration
  'DATABASE_HOST': 'database_host',
  'DATABASE_PORT': 'database_port',
  'DATABASE_USERNAME': 'database_username',
  'DATABASE_USER': 'database_username', // Alias for DATABASE_USERNAME
  'DATABASE_PASSWORD': 'database_password',
  'DATABASE_NAME': 'database_name',
  // Legacy database configuration (db_* prefix)
  'DB_HOST': 'db_host',
  'DB_PORT': 'db_port',
  'DB_USERNAME': 'db_username',
  'DB_PASSWORD': 'db_password',
  'DB_DATABASE': 'db_database',
  // Additional mappings for other environment variables
  'PORT': 'port',
  'ERP_URL': 'erp_url',
  'EMQX_ENDPOINT': 'emqx_endpoint',
  'WEBHOOK_URL': 'webhook_url',
  'EXPIRED_DAY_COOKIE': 'expired_day_cookie',
  'BASIC_AUTH_FRAPPE': 'basic_auth_frappe',
  'THINGSBOARD_TOKEN': 'thingsboard_token',
  'SNS_TOPIC_ARN_PREFIX': 'sns_topic_arn_prefix',
  'SNS_TOPIC_OWNER': 'sns_topic_owner',
  'SNS_GLOBAL_TOPIC_ARN': 'sns_global_topic_arn',
  'SNS_APPLICATION_ARN': 'sns_application_arn',
  'GOOGLE_CLOUD_TOKEN': 'google_cloud_token',
  'WEATHER_API_TOKEN': 'weather_api_token',
  'EMQX_ACCESS_KEY': 'emqx_access_key',
  'EMQX_SECRET_KEY': 'emqx_secret_key',
  'AWS_SNS_ACCESS_KEY_ID': 'aws_sns_access_key_id',
  'AWS_SNS_SECRET_ACCESS_KEY': 'aws_sns_secret_access_key'
};

/**
 * Global Context Helper class
 */
export class GlobalContextHelper {
  private globalContext: any;
  private namespace: string;

  /**
   * Creates a new GlobalContextHelper instance
   * @param nodeContext - Node-RED node context
   * @param namespace - Optional namespace prefix for global variables
   */
  constructor(nodeContext: NodeContext, namespace: string = '') {
    this.globalContext = nodeContext.global;
    this.namespace = namespace;
  }

  /**
   * Gets a prefixed variable name with namespace
   * @param variableName - Original variable name
   * @returns Prefixed variable name
   */
  private getPrefixedName(variableName: string): string {
    const prefix = this.namespace ? `${this.namespace}_` : '';
    return `${prefix}${variableName}`;
  }

  /**
   * Gets an environment variable value from global context with fallback to process.env
   * @param envVarName - Environment variable name (e.g., 'DEVICE_ID')
   * @param defaultValue - Default value if not found
   * @returns Variable value or default
   */
  getEnvVar(envVarName: string, defaultValue?: any): any {
    // First try to get from global context using mapping
    const globalVarName = ENV_TO_GLOBAL_MAPPING[envVarName];
    if (globalVarName) {
      const prefixedName = this.getPrefixedName(globalVarName);
      const globalValue = this.globalContext.get(prefixedName);
      if (globalValue !== undefined && globalValue !== null && globalValue !== '') {
        return globalValue;
      }
    }

    // Fallback to process.env
    const processValue = process.env[envVarName];
    if (processValue !== undefined && processValue !== null && processValue !== '') {
      return processValue;
    }

    // Return default value
    return defaultValue;
  }

  /**
   * Gets multiple environment variables at once
   * @param envVarNames - Array of environment variable names
   * @returns Object with variable names as keys and values
   */
  getEnvVars(envVarNames: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const varName of envVarNames) {
      result[varName] = this.getEnvVar(varName);
    }
    return result;
  }

  /**
   * Gets a JSON environment variable (parses string to object)
   * @param envVarName - Environment variable name
   * @param defaultValue - Default value if not found or invalid JSON
   * @returns Parsed JSON object or default
   */
  getJsonEnvVar(envVarName: string, defaultValue: any = {}): any {
    const value = this.getEnvVar(envVarName);

    if (!value) {
      return defaultValue;
    }

    // If it's already an object (from global context), return it
    if (typeof value === 'object') {
      return value;
    }

    // If it's a string (from process.env), try to parse it
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        console.warn(`Failed to parse JSON for ${envVarName}:`, error.message);
        return defaultValue;
      }
    }

    return defaultValue;
  }

  /**
   * Gets a numeric environment variable
   * @param envVarName - Environment variable name
   * @param defaultValue - Default value if not found or invalid number
   * @returns Numeric value or default
   */
  getNumericEnvVar(envVarName: string, defaultValue?: number): number {
    const value = this.getEnvVar(envVarName, defaultValue);

    if (value === undefined || value === null) {
      return defaultValue || 0;
    }

    // If it's already a number, return it
    if (typeof value === 'number') {
      return value;
    }

    // Try to parse as number
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return defaultValue || 0;
    }

    return numValue;
  }

  /**
   * Gets a boolean environment variable
   * @param envVarName - Environment variable name
   * @param defaultValue - Default value if not found
   * @returns Boolean value or default
   */
  getBooleanEnvVar(envVarName: string, defaultValue: boolean = false): boolean {
    const value = this.getEnvVar(envVarName);

    if (value === undefined || value === null) {
      return defaultValue;
    }

    // If it's already a boolean, return it
    if (typeof value === 'boolean') {
      return value;
    }

    // Convert string to boolean
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      return lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes';
    }

    // Convert number to boolean
    if (typeof value === 'number') {
      return value !== 0;
    }

    return defaultValue;
  }

  /**
   * Checks if a variable exists in global context or process.env
   * @param envVarName - Environment variable name
   * @returns True if variable exists
   */
  hasEnvVar(envVarName: string): boolean {
    // Check global context first
    const globalVarName = ENV_TO_GLOBAL_MAPPING[envVarName];
    if (globalVarName) {
      const prefixedName = this.getPrefixedName(globalVarName);
      if (this.globalContext.get(prefixedName) !== undefined) {
        return true;
      }
    }

    // Check process.env
    return process.env[envVarName] !== undefined;
  }

  /**
   * Gets all available environment variables from both global context and process.env
   * @returns Object with all available variables
   */
  getAllEnvVars(): Record<string, any> {
    const result: Record<string, any> = {};

    // Get from global context first
    for (const [envName, globalName] of Object.entries(ENV_TO_GLOBAL_MAPPING)) {
      const prefixedName = this.getPrefixedName(globalName);
      const globalValue = this.globalContext.get(prefixedName);
      if (globalValue !== undefined) {
        result[envName] = globalValue;
      }
    }

    // Add from process.env (only if not already in result)
    for (const [key, value] of Object.entries(process.env)) {
      if (!(key in result) && value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Gets error code mappings from global context
   * @returns Error code mappings object
   */
  getErrorCodeMappings(): Record<string, any> {
    const mappings = this.globalContext.get('errorCodeMappings');
    return mappings || {};
  }

  /**
   * Gets error code mapping for a specific device type
   * @param deviceType - Device type name (e.g., 'Climate_Controller')
   * @returns Error code mapping or null if not found
   */
  getErrorCodeMappingForDevice(deviceType: string): any | null {
    const allMappings = this.getErrorCodeMappings();
    return allMappings[deviceType] || allMappings['default'] || null;
  }

  /**
   * Gets all available device types with error code mappings
   * @returns Array of device type names
   */
  getAvailableErrorDeviceTypes(): string[] {
    const allMappings = this.getErrorCodeMappings();
    return Object.keys(allMappings);
  }

  /**
   * Checks if error code mappings are loaded
   * @returns True if mappings exist in global context
   */
  hasErrorCodeMappings(): boolean {
    const mappings = this.globalContext.get('errorCodeMappings');
    return mappings !== undefined && mappings !== null && Object.keys(mappings).length > 0;
  }

  /**
   * Gets debug information about the helper state
   * @returns Debug information object
   */
  getDebugInfo(): any {
    const globalVars: Record<string, any> = {};
    const processVars: Record<string, any> = {};

    // Check global context variables
    for (const [envName, globalName] of Object.entries(ENV_TO_GLOBAL_MAPPING)) {
      const prefixedName = this.getPrefixedName(globalName);
      const globalValue = this.globalContext.get(prefixedName);
      if (globalValue !== undefined) {
        globalVars[envName] = globalValue;
      }
    }

    // Check process.env variables
    for (const envName of Object.keys(ENV_TO_GLOBAL_MAPPING)) {
      const processValue = process.env[envName];
      if (processValue !== undefined) {
        processVars[envName] = processValue;
      }
    }

    return {
      namespace: this.namespace,
      globalVarsCount: Object.keys(globalVars).length,
      processVarsCount: Object.keys(processVars).length,
      globalVars,
      processVars,
      mapping: ENV_TO_GLOBAL_MAPPING
    };
  }
}

/**
 * Creates a new GlobalContextHelper instance
 * @param nodeContext - Node-RED node context
 * @param namespace - Optional namespace prefix
 * @returns GlobalContextHelper instance
 */
export function createGlobalContextHelper(nodeContext: NodeContext, namespace: string = ''): GlobalContextHelper {
  return new GlobalContextHelper(nodeContext, namespace);
}

/**
 * Utility function to get environment variable with global context fallback
 * @param nodeContext - Node-RED node context
 * @param envVarName - Environment variable name
 * @param defaultValue - Default value
 * @param namespace - Optional namespace
 * @returns Variable value
 */
export function getEnvVar(nodeContext: NodeContext, envVarName: string, defaultValue?: any, namespace: string = ''): any {
  const helper = new GlobalContextHelper(nodeContext, namespace);
  return helper.getEnvVar(envVarName, defaultValue);
}

/**
 * Utility function to get JSON environment variable with global context fallback
 * @param nodeContext - Node-RED node context
 * @param envVarName - Environment variable name
 * @param defaultValue - Default value
 * @param namespace - Optional namespace
 * @returns Parsed JSON object
 */
export function getJsonEnvVar(nodeContext: NodeContext, envVarName: string, defaultValue: any = {}, namespace: string = ''): any {
  const helper = new GlobalContextHelper(nodeContext, namespace);
  return helper.getJsonEnvVar(envVarName, defaultValue);
}
