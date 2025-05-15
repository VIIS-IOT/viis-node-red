module.exports = function (RED) {
    function ViisRpcControlSimpleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Log when node is initialized
        node.warn("Simple VIIS RPC Control Node initialized");
        console.log("Simple VIIS RPC Control Node initialized");

        // Handle input messages
        this.on('input', (msg: any) => {
            // Log to Node-RED debug sidebar and console
            node.warn("VIIS-RPC-CONTROL: INPUT RECEIVED");
            console.log("VIIS-RPC-CONTROL: INPUT RECEIVED");
            node.warn(`Input msg: ${JSON.stringify(msg)}`);
            console.log(`Input msg: ${JSON.stringify(msg)}`);

            // Set node status
            node.status({ fill: "blue", shape: "dot", text: "Message received" });

            // Output the message unchanged
            node.send(msg);
        });

        // Log when node is closed
        node.on('close', function () {
            node.warn("Simple VIIS RPC Control Node closed");
            console.log("Simple VIIS RPC Control Node closed");
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlSimpleNode);
};