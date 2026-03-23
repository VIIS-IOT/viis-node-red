/**
 * VIIS Aqara Configuration Node
 * 
 * Manages Aqara Open API credentials and provides authentication
 * services to Aqara device nodes.
 * 
 * @module viis-aqara-config
 */

import { NodeAPI, Node, NodeDef } from "node-red";
import crypto from "crypto";

// ============================================================================
// Type Definitions
// ============================================================================

interface AqaraConfigNodeDef extends NodeDef {
  name: string;
  appid: string;
  keyid: string;
  appkey: string;
  accesstoken?: string;
  testOnDeploy?: boolean;
}

interface AqaraCredentials {
  appid: string;
  keyid: string;
  appkey: string;
  accesstoken?: string;
}

// ============================================================================
// Node-RED Config Node Implementation
// ============================================================================

module.exports = function (RED: NodeAPI) {
  // Config node constructor
  function ViisAqaraConfigNode(this: Node, config: AqaraConfigNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Store credentials securely
    const credentials: AqaraCredentials = {
      appid: config.appid || "",
      keyid: config.keyid || "",
      appkey: config.appkey || "",
      accesstoken: config.accesstoken || "",
    };

    // Validate credentials on node initialization
    if (!credentials.appid || !credentials.keyid || !credentials.appkey) {
      node.error("Missing required Aqara credentials");
      node.status({ fill: "red", shape: "ring", text: "Credentials missing" });
    } else {
      node.status({ fill: "green", shape: "dot", text: "Configured" });
    }

    /**
     * Get credentials (called by device nodes)
     */
    (node as any).getCredentials = (): AqaraCredentials => {
      return { ...credentials };
    };

    /**
     * Generate authentication signature (utility function)
     */
    (node as any).generateAuthParams = (): {
      headers: Record<string, string>;
      time: number;
      nonce: number;
      sign: string;
    } => {
      const time = Date.now();
      const nonce = time;

      // Build pre-sign string
      let preSign = "";
      if (credentials.accesstoken) {
        preSign = `Accesstoken=${credentials.accesstoken}&`;
      }

      preSign +=
        `Appid=${credentials.appid}&` +
        `Keyid=${credentials.keyid}&` +
        `Nonce=${nonce}&` +
        `Time=${time}` +
        credentials.appkey;

      // Generate MD5 hash
      const sign = crypto
        .createHash("md5")
        .update(preSign.toLowerCase())
        .digest("hex");

      // Build headers
      const headers: Record<string, string> = {
        Appid: credentials.appid,
        Keyid: credentials.keyid,
        Time: time.toString(),
        Nonce: nonce.toString(),
        Sign: sign,
      };

      if (credentials.accesstoken) {
        headers.Accesstoken = credentials.accesstoken;
      }

      return { headers, time, nonce, sign };
    };

    /**
     * Test connection to Aqara API
     */
    (node as any).testConnection = async (): Promise<{ success: boolean; message: string }> => {
      try {
        const axios = await import("axios");
        const { headers } = (node as any).generateAuthParams();

        // Test with a simple API call (you may need to adjust based on available test endpoints)
        const response = await axios.default.post(
          "https://open-sg.aqara.com/v3.0/open/api",
          {
            intent: "read.device.info",
            data: {
              did: "test",
            },
          },
          { headers, timeout: 5000 }
        );

        if (response.data.code === 0) {
          return { success: true, message: "Connection successful" };
        } else {
          return {
            success: false,
            message: `API error: ${response.data.message}`,
          };
        }
      } catch (error: any) {
        return {
          success: false,
          message: error.message || "Connection failed",
        };
      }
    };

    node.log("Aqara config node initialized");
  }

  // Register config node type
  RED.nodes.registerType("viis-aqara-config", ViisAqaraConfigNode, {
    credentials: {
      appid: { type: "text" },
      keyid: { type: "text" },
      appkey: { type: "password" },
      accesstoken: { type: "password" },
    },
  });
};
