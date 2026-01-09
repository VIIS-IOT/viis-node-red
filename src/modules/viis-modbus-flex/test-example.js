/**
 * Test example for VIIS Modbus Getter Node
 *
 * This file demonstrates how to use the VIIS Modbus Getter node
 * in a Node-RED flow to read data from Modbus devices.
 */

// Example flow configuration for Node-RED
const exampleFlow = [
    {
        "id": "inject-node",
        "type": "inject",
        "name": "Test Modbus Read",
        "props": [
            {
                "p": "payload"
            }
        ],
        "repeat": "",
        "crontab": "",
        "once": false,
        "onceDelay": 0.1,
        "topic": "",
        "payload": "",
        "payloadType": "str",
        "x": 150,
        "y": 100,
        "wires": [["function-node"]]
    },
    {
        "id": "function-node",
        "type": "function",
        "name": "Prepare Modbus Request",
        "func": `
// Example 1: Read 10 holding registers starting from address 0
msg.payload = {
    fc: 3,          // Function code: 3 = Read Holding Registers
    unitid: 1,      // Unit ID
    address: 0,     // Starting address
    quantity: 10    // Number of registers to read
};

// Example 2: Read 20 coils starting from address 0
// msg.payload = {
//     fc: 1,          // Function code: 1 = Read Coils
//     unitid: 1,      // Unit ID
//     address: 0,     // Starting address
//     quantity: 20    // Number of coils to read
// };

// Example 3: Read 5 input registers starting from address 100
// msg.payload = {
//     fc: 4,          // Function code: 4 = Read Input Registers
//     unitid: 1,      // Unit ID
//     address: 100,   // Starting address
//     quantity: 5     // Number of registers to read
// };

return msg;
        `,
        "outputs": 1,
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": 350,
        "y": 100,
        "wires": [["modbus-getter-node"]]
    },
    {
        "id": "modbus-getter-node",
        "type": "viis-modbus-flex",
        "name": "Modbus Getter",
        "x": 550,
        "y": 100,
        "wires": [["debug-node", "process-response-node"]]
    },
    {
        "id": "debug-node",
        "type": "debug",
        "name": "Debug Output",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "payload",
        "targetType": "msg",
        "statusVal": "",
        "statusType": "auto",
        "x": 750,
        "y": 80,
        "wires": []
    },
    {
        "id": "process-response-node",
        "type": "function",
        "name": "Process Response",
        "func": `
// Check if the response is successful
if (msg.payload.success) {
    // Success response
    const data = msg.payload.data;
    const address = msg.payload.address;
    const quantity = msg.payload.quantity;
    const functionCode = msg.payload.functionCode;

    node.log(\`Successfully read \${quantity} values from address \${address} using FC \${functionCode}\`);
    node.log(\`Data: \${JSON.stringify(data)}\`);

    // Process the data as needed
    msg.processedData = {
        values: data,
        count: data.length,
        startAddress: address,
        readTime: new Date(msg.payload.timestamp).toISOString()
    };

} else {
    // Error response
    node.error(\`Modbus read failed: \${msg.payload.error}\`);
    msg.processedData = {
        error: msg.payload.error,
        errorTime: new Date(msg.payload.timestamp).toISOString()
    };
}

return msg;
        `,
        "outputs": 1,
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": 750,
        "y": 120,
        "wires": [["final-debug-node"]]
    },
    {
        "id": "final-debug-node",
        "type": "debug",
        "name": "Processed Data",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "processedData",
        "targetType": "msg",
        "statusVal": "",
        "statusType": "auto",
        "x": 950,
        "y": 120,
        "wires": []
    }
];

// Example environment variables setup
const environmentVariables = {
    // Required Modbus configuration
    MODBUS_TYPE: "TCP",
    MODBUS_HOST: "192.168.1.51",
    MODBUS_TCP_PORT: "502",
    MODBUS_UNIT_ID: "1",
    MODBUS_TIMEOUT: "5000",
    MODBUS_RECONNECT_INTERVAL: "5000"
};

// Example usage scenarios
const usageExamples = {
    // Read temperature sensors (holding registers)
    readTemperatureSensors: {
        fc: 3,
        unitid: 1,
        address: 0,
        quantity: 4
    },

    // Read digital inputs (coils)
    readDigitalInputs: {
        fc: 1,
        unitid: 1,
        address: 0,
        quantity: 16
    },

    // Read analog inputs (input registers)
    readAnalogInputs: {
        fc: 4,
        unitid: 1,
        address: 100,
        quantity: 8
    },

    // Read system status (discrete inputs)
    readSystemStatus: {
        fc: 2,
        unitid: 1,
        address: 200,
        quantity: 10
    }
};

// Expected response formats
const responseExamples = {
    // Success response for holding registers
    successResponse: {
        success: true,
        data: [25.5, 26.2, 24.8, 27.1],  // Temperature values
        address: 0,
        quantity: 4,
        functionCode: 3,
        timestamp: 1640995200000
    },

    // Success response for coils
    coilResponse: {
        success: true,
        data: [true, false, true, true, false, false, true, false],  // Boolean values
        address: 0,
        quantity: 8,
        functionCode: 1,
        timestamp: 1640995200000
    },

    // Error response
    errorResponse: {
        error: "Modbus client not connected",
        timestamp: 1640995200000
    }
};

// Export for documentation
module.exports = {
    exampleFlow,
    environmentVariables,
    usageExamples,
    responseExamples
};
