/**
 * VIIS Aqara Device Node
 * 
 * Controls Aqara IR devices via Open API
 * Loads credentials directly from global context
 * 
 * Usage:
 *   global.set("aqaraCredentials", {
 *     appid: "your-app-id",
 *     keyid: "your-key-id",
 *     appkey: "your-app-key",
 *     accesstoken: "optional"
 *   });
 * 
 * @module viis-aqara-device
 */

import { NodeAPI, Node, NodeDef } from "node-red";
import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

// ============================================================================
// Type Definitions
// ============================================================================

interface AqaraDeviceNodeDef extends NodeDef {
  name: string;
  deviceType: "ac" | "ir_generic" | "custom";
  operationMode: "auto" | "manual";
  acKeyTemplate?: string;
  defaultTemperature?: number;
  defaultFanSpeed?: number;
  requestDelay?: number;
  enableRetry?: boolean;
  maxRetries?: number;
}

interface AqaraCredentials {
  appid: string;
  keyid: string;
  appkey: string;
  accesstoken?: string;
}

interface AqaraCommand {
  intent: string;
  data: {
    did: string;
    acKey?: string;
    [key: string]: any;
  };
}

interface AqaraResponse {
  code: number;
  message: string;
  result?: any;
}

interface ParsedACState {
  power: boolean;
  mode: number;
  modeName: string;
  temperature: number;
  fanSpeed: number;
  fanName: string;
  direction: number;
  rawState: string;
}

// ============================================================================
// Aqara Service Class
// ============================================================================

class AqaraService {
  private credentials: AqaraCredentials;
  private httpClient: AxiosInstance;
  private baseUrl: string = "https://open-sg.aqara.com/v3.0/open/api";
  private lastRequestTime: number = 0;
  private requestDelay: number = 2000;

  constructor(credentials: AqaraCredentials, requestDelay?: number) {
    this.credentials = credentials;
    this.requestDelay = requestDelay || 2000;
    
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  generateAuthParams(): { headers: Record<string, string>; time: string; nonce: string } {
    const time = Date.now().toString();
    const nonce = Math.random().toString(36).substring(2, 18);

    let signStr: string;
    if (this.credentials.accesstoken) {
      signStr = `accesstoken=${this.credentials.accesstoken}&appid=${this.credentials.appid}&keyid=${this.credentials.keyid}&nonce=${nonce}&time=${time}${this.credentials.appkey}`;
    } else {
      signStr = `appid=${this.credentials.appid}&keyid=${this.credentials.keyid}&nonce=${nonce}&time=${time}${this.credentials.appkey}`;
    }

    const sign = crypto
      .createHash("md5")
      .update(signStr.toLowerCase())
      .digest("hex");

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Appid': this.credentials.appid,
      'Keyid': this.credentials.keyid,
      'Nonce': nonce,
      'Time': time,
      'Sign': sign,
    };

    if (this.credentials.accesstoken) {
      headers['Accesstoken'] = this.credentials.accesstoken;
    }

    return { headers, time, nonce };
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      const waitTime = this.requestDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  async sendCommand(
    command: AqaraCommand,
    enableRetry: boolean = true,
    maxRetries: number = 3,
    customUrl?: string
  ): Promise<AqaraResponse> {
    let lastError: Error | null = null;
    const attempts = enableRetry ? maxRetries : 1;
    const url = customUrl || this.baseUrl;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.enforceRateLimit();
        const { headers } = this.generateAuthParams();

        const response = await this.httpClient.post<AqaraResponse>(
          url,
          command,
          { headers }
        );

        const result = response.data;

        if (result.code !== 0) {
          throw new AqaraApiError(result.message, result.code, result);
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof AqaraApiError) {
          const apiError = error as AqaraApiError;
          if ([1001, 1002, 1003, 2001].includes(apiError.code)) {
            throw apiError;
          }
        }

        if (attempt < attempts) {
          const backoffTime = 1000 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }

    throw lastError || new Error("Unknown error sending Aqara command");
  }

  async sendIrClick(
    deviceId: string,
    acKey: string,
    enableRetry?: boolean,
    maxRetries?: number,
    customUrl?: string
  ): Promise<AqaraResponse> {
    const command: AqaraCommand = {
      intent: "write.ir.click",
      data: {
        did: deviceId,
        acKey: acKey,
      },
    };

    return this.sendCommand(command, enableRetry, maxRetries, customUrl);
  }

  async sendCustomCommand(
    intent: string,
    data: any,
    enableRetry?: boolean,
    maxRetries?: number,
    customUrl?: string
  ): Promise<AqaraResponse> {
    const command: AqaraCommand = {
      intent,
      data,
    };

    return this.sendCommand(command, enableRetry, maxRetries, customUrl);
  }

  async readACState(
    deviceId: string,
    enableRetry?: boolean,
    maxRetries?: number
  ): Promise<{ success: boolean; state?: ParsedACState; error?: string; errorCode?: number }> {
    try {
      const command: AqaraCommand = {
        intent: "query.ir.acState",
        data: { did: deviceId },
      };

      const response = await this.sendCommand(command, enableRetry, maxRetries);
      
      if (response.result && response.result.acState) {
        const parsedState = this.parseACState(response.result.acState);
        return { success: true, state: parsedState };
      } else {
        return { success: false, error: "No AC state data", errorCode: 3002 };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to read AC state",
        errorCode: (error as AqaraApiError).code || 3003,
      };
    }
  }

  parseACState(acState: string): ParsedACState {
    const modeNames = ['cooling', 'heating', 'auto', 'fan', 'dry'];
    const fanNames = ['auto', 'low', 'medium', 'high'];
    
    const powerMatch = acState.match(/P(\d)/);
    const modeMatch = acState.match(/_M(\d)_/);
    const tempMatch = acState.match(/_T(\d+)_/);
    const fanMatch = acState.match(/_S(\d)/);
    const dirMatch = acState.match(/_D(\d)/);
    
    return {
      power: powerMatch ? powerMatch[1] === '0' : true,
      mode: modeMatch ? parseInt(modeMatch[1]) : 0,
      modeName: modeMatch ? (modeNames[parseInt(modeMatch[1])] || 'unknown') : 'auto',
      temperature: tempMatch ? parseInt(tempMatch[1]) : 25,
      fanSpeed: fanMatch ? parseInt(fanMatch[1]) : 0,
      fanName: fanMatch ? (fanNames[parseInt(fanMatch[1])] || 'auto') : 'auto',
      direction: dirMatch ? parseInt(dirMatch[1]) : 0,
      rawState: acState,
    };
  }

  generateAcKey(power: boolean, mode: number, temperature: number, fanSpeed: number): string {
    const powerCode = power ? "0" : "1";
    return `P${powerCode}_M${mode}_T${temperature}_S${fanSpeed}`;
  }
}

// ============================================================================
// Custom Error Class
// ============================================================================

class AqaraApiError extends Error {
  code: number;
  details?: any;

  constructor(message: string, code: number, details?: any) {
    super(message);
    this.name = "AqaraApiError";
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// Node-RED Node Implementation
// ============================================================================

module.exports = function (RED: NodeAPI) {
  function ViisAqaraDeviceNode(this: Node, config: AqaraDeviceNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get credentials from global context
    const globalContext = (node as any).context().global;
    const credentials = globalContext.get("aqaraCredentials");

    // Validate credentials
    if (!credentials || !credentials.appid || !credentials.keyid || !credentials.appkey) {
      node.error("Missing Aqara credentials in global context");
      node.status({ fill: "red", shape: "ring", text: "Credentials missing" });
      node.log("ERROR: Set global.aqaraCredentials in init function");
      return;
    }

    // Initialize Aqara service
    const deviceType = config.deviceType || "ac";
    const operationMode = config.operationMode || "auto";
    const defaultTemperature = config.defaultTemperature || 25;
    const defaultFanSpeed = config.defaultFanSpeed ?? 2;
    const requestDelay = config.requestDelay || 2000;
    const enableRetry = config.enableRetry ?? true;
    const maxRetries = config.maxRetries ?? 3;

    const aqaraService = new AqaraService(credentials, requestDelay);
    
    node.log("Aqara device node initialized");
    node.status({ fill: "green", shape: "dot", text: "Ready" });

    node.on("input", async (msg: any) => {
      try {
        // Check for standard Aqara API format: msg.payload = { intent: "...", data: {...} }
        if (msg.payload?.intent) {
          const intent = msg.payload.intent;
          const data = msg.payload.data || {};
          const url = msg.payload.url || msg.url;

          node.status({ fill: "yellow", shape: "dot", text: "Calling API..." });

          const response = await aqaraService.sendCustomCommand(
            intent,
            data,
            enableRetry,
            maxRetries,
            url
          );

          node.status({ fill: "green", shape: "dot", text: "API success" });

          // Return exact Aqara response
          node.send({
            payload: response,
            topic: msg.topic || "aqara/api"
          });

          return;
        }

        if (operationMode === "auto" && msg.payload?.auto === false) {
          node.status({ fill: "blue", shape: "dot", text: "Manual mode" });
          return;
        }

        const deviceId = msg.deviceId || msg.payload?.deviceId || config.name;

        if (!deviceId) {
          throw new Error("Device ID is required");
        }

        const action = msg.payload?.action || msg.action || "write";

        if (action === "read" || action === "query") {
          node.status({ fill: "yellow", shape: "dot", text: "Reading..." });

          const readResult = await aqaraService.readACState(deviceId, enableRetry, maxRetries);

          if (readResult.success && readResult.state) {
            node.status({ fill: "green", shape: "dot", text: `Read: ${readResult.state.temperature}°C` });

            node.send({
              payload: {
                success: true,
                action: "read",
                deviceId: deviceId,
                acState: readResult.state,
                temperature: readResult.state.temperature,
                mode: readResult.state.mode,
                modeName: readResult.state.modeName,
                fanSpeed: readResult.state.fanSpeed,
                fanName: readResult.state.fanName,
                power: readResult.state.power,
                rawState: readResult.state.rawState,
                timestamp: Date.now()
              },
              topic: msg.topic || "aqara/state",
            });
          } else {
            node.status({ fill: "red", shape: "ring", text: `Read failed` });

            node.send({
              payload: {
                success: false,
                action: "read",
                deviceId: deviceId,
                error: readResult.error,
                errorCode: readResult.errorCode,
                timestamp: Date.now()
              },
              topic: msg.topic || "aqara/error"
            });
          }
          return;
        }

        // WRITE operation
        let acKey: string;

        if (msg.payload?.acKey) {
          acKey = msg.payload.acKey;
        } else if (deviceType === "ac") {
          const power = msg.payload?.power ?? true;
          const mode = msg.payload?.mode ?? 0;
          const temperature = msg.payload?.temperature ?? defaultTemperature;
          const fanSpeed = msg.payload?.fanSpeed ?? defaultFanSpeed;
          acKey = aqaraService.generateAcKey(power, mode, temperature, fanSpeed);
        } else {
          const acKeyTemplate = config.acKeyTemplate || "P0_M0_T{temp}_S2";
          acKey = acKeyTemplate
            .replace("{power}", msg.payload?.power ? "0" : "1")
            .replace("{temp}", String(msg.payload?.temperature ?? defaultTemperature))
            .replace("{mode}", String(msg.payload?.mode ?? 0))
            .replace("{fan}", String(msg.payload?.fanSpeed ?? defaultFanSpeed));
        }

        node.status({ fill: "yellow", shape: "dot", text: "Sending..." });

        const response = await aqaraService.sendIrClick(deviceId, acKey, enableRetry, maxRetries);

        node.status({ fill: "green", shape: "dot", text: "Command sent" });

        node.send({
          payload: {
            success: true,
            action: "write",
            deviceId,
            acKey,
            response: response.result,
            timestamp: Date.now(),
          },
          topic: msg.topic || "aqara/command",
        });

      } catch (error) {
        const err = error as Error;
        node.error(`Aqara command failed: ${err.message}`, msg);

        const errorCode = (error as AqaraApiError).code;
        node.status({ fill: "red", shape: "ring", text: `Error: ${errorCode || "Unknown"}` });

        node.send({
          payload: {
            success: false,
            error: err.message,
            errorCode: (error as AqaraApiError).code,
            timestamp: Date.now(),
          },
          topic: msg.topic || "aqara/error",
        });
      }
    });

    node.on("close", (done) => {
      node.log("Aqara device node closing");
      done();
    });
  }

  RED.nodes.registerType("viis-aqara-device", ViisAqaraDeviceNode);
};
