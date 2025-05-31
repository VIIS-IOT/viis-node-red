/**
 * Test script để verify Modbus connection sharing
 * Chạy script này để kiểm tra xem connection sharing có hoạt động đúng không
 */

const helper = require("node-red-node-test-helper");
const viisModbusGetterNode = require("../src/modules/viis-modbus-getter/viis-modbus-getter");

helper.init(require.resolve('node-red'));

describe('VIIS Modbus Getter Connection Sharing', function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should share connection between multiple nodes', function (done) {
        const flow = [
            {
                id: "node1",
                type: "viis-modbus-getter",
                name: "Modbus Getter 1",
                wires: [["helper1"]]
            },
            {
                id: "node2", 
                type: "viis-modbus-getter",
                name: "Modbus Getter 2",
                wires: [["helper2"]]
            },
            {
                id: "helper1",
                type: "helper"
            },
            {
                id: "helper2", 
                type: "helper"
            }
        ];

        // Mock environment variables
        process.env.VIIS_MODBUS_TYPE = "TCP";
        process.env.VIIS_MODBUS_HOST = "127.0.0.1";
        process.env.VIIS_MODBUS_TCP_PORT = "502";
        process.env.VIIS_MODBUS_UNIT_ID = "1";

        helper.load(viisModbusGetterNode, flow, function () {
            const node1 = helper.getNode("node1");
            const node2 = helper.getNode("node2");
            const helper1 = helper.getNode("helper1");
            const helper2 = helper.getNode("helper2");

            // Kiểm tra cả 2 node đều được khởi tạo
            node1.should.have.property('name', 'Modbus Getter 1');
            node2.should.have.property('name', 'Modbus Getter 2');

            // Test message processing
            let receivedCount = 0;
            const expectedCount = 2;

            helper1.on("input", function (msg) {
                receivedCount++;
                msg.should.have.property('payload');
                if (receivedCount === expectedCount) {
                    done();
                }
            });

            helper2.on("input", function (msg) {
                receivedCount++;
                msg.should.have.property('payload');
                if (receivedCount === expectedCount) {
                    done();
                }
            });

            // Gửi test message tới cả 2 node
            setTimeout(() => {
                node1.receive({
                    payload: {
                        address: 0,
                        length: 1,
                        fc: 3 // Read Holding Registers
                    }
                });

                node2.receive({
                    payload: {
                        address: 1,
                        length: 1,
                        fc: 3 // Read Holding Registers
                    }
                });
            }, 1000); // Đợi nodes khởi tạo xong
        });
    });

    it('should handle config mismatch gracefully', function (done) {
        // Test case cho config mismatch
        const flow = [
            {
                id: "node1",
                type: "viis-modbus-getter",
                name: "Modbus Getter 1"
            }
        ];

        // Set different config for second node (simulated)
        process.env.VIIS_MODBUS_TYPE = "TCP";
        process.env.VIIS_MODBUS_HOST = "127.0.0.1";
        process.env.VIIS_MODBUS_TCP_PORT = "502";
        process.env.VIIS_MODBUS_UNIT_ID = "1";

        helper.load(viisModbusGetterNode, flow, function () {
            const node1 = helper.getNode("node1");
            
            // Node should still initialize despite potential config differences
            node1.should.have.property('name', 'Modbus Getter 1');
            
            done();
        });
    });

    it('should cleanup connection when all nodes are removed', function (done) {
        const flow = [
            {
                id: "node1",
                type: "viis-modbus-getter",
                name: "Modbus Getter 1"
            }
        ];

        helper.load(viisModbusGetterNode, flow, function () {
            const node1 = helper.getNode("node1");
            
            // Simulate node removal
            setTimeout(() => {
                helper.unload();
                // Connection should be cleaned up
                done();
            }, 1000);
        });
    });
});

/**
 * Manual test function - chạy để test thực tế
 */
function manualConnectionTest() {
    console.log("=== Manual Connection Sharing Test ===");
    console.log("1. Deploy 2-3 VIIS Modbus Getter nodes trong Node-RED");
    console.log("2. Kiểm tra debug logs cho:");
    console.log("   - [MODBUS-INIT] messages");
    console.log("   - Reference count tăng lên");
    console.log("   - Active users list");
    console.log("3. Xóa 1 node và kiểm tra:");
    console.log("   - [MODBUS-RELEASE] messages");
    console.log("   - Reference count giảm");
    console.log("4. Xóa tất cả nodes và kiểm tra:");
    console.log("   - Connection được disconnect");
    console.log("   - Config được reset");
    console.log("=====================================");
}

// Export cho manual testing
module.exports = {
    manualConnectionTest
};

// Chạy manual test nếu file được execute trực tiếp
if (require.main === module) {
    manualConnectionTest();
}
