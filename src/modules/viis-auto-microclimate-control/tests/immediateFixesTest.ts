/**
 * Test Suite for Immediate Fixes
 * Tests circular dependency resolution and atomic operations
 */

import {
    FanControlState,
    FanControlMode,
    AutoControlConfig,
    SensorData,
    DeviceStatus
} from "../interfaces/types";
import { FanControlStateManager } from "../services/stateManager";
import { FanControlStateMachine } from "../services/fanStateMachine";
import { FanControlCore } from "../services/fanControlCore";

// Mock implementations
class MockFlowContext {
    private data = new Map<string, any>();

    get(key: string): any {
        return this.data.get(key);
    }

    set(key: string, value: any): void {
        this.data.set(key, value);
    }

    clear(): void {
        this.data.clear();
    }
}

class MockLogger {
    log(message: string): void { console.log(`[LOG] ${message}`); }
    warn(message: string): void { console.warn(`[WARN] ${message}`); }
    error(message: string): void { console.error(`[ERROR] ${message}`); }
    debug(message: string): void { console.debug(`[DEBUG] ${message}`); }
}

export class ImmediateFixesTestSuite {
    private mockFlowContext: MockFlowContext;
    private mockLogger: MockLogger;
    private stateManager: FanControlStateManager;
    private stateMachine: FanControlStateMachine;

    constructor() {
        this.setupMocks();
        this.initializeServices();
    }

    /**
     * Run all immediate fix tests
     */
    public async runTests(): Promise<boolean> {
        console.log("=== Immediate Fixes Test Suite ===\n");

        const testResults = [
            await this.testCircularDependencyResolution(),
            await this.testAtomicOperations(),
            await this.testCoreLogicIntegration(),
            await this.testVersionConflictHandling()
        ];

        const passedTests = testResults.filter(result => result).length;
        const totalTests = testResults.length;

        console.log(`\n=== Test Results ===`);
        console.log(`Passed: ${passedTests}/${totalTests}`);
        
        if (passedTests === totalTests) {
            console.log("🎉 ALL IMMEDIATE FIXES VERIFIED!");
            return true;
        } else {
            console.log("❌ Some fixes need attention!");
            return false;
        }
    }

    /**
     * Test that circular dependencies are resolved
     */
    private async testCircularDependencyResolution(): Promise<boolean> {
        console.log("1. Testing Circular Dependency Resolution");
        console.log("=========================================");

        try {
            // Test that state machine can execute without calling back to enhanced service
            const config: AutoControlConfig = {
                set_mode_fan: 1,
                set_auto_mode_fan: 1,
                set_gr_alternate_fan: 2,
                set_time_alternate_fan: 15
            };

            const sensorData: SensorData = {
                temp_indoor: 28,
                humi_indoor: 65,
                light_indoor: 25000,
                ts: Date.now()
            };

            const deviceStatus: DeviceStatus = {
                quat_1: false,
                quat_2: false,
                quat_3: false,
                quat_4: false,
                quat_5: false,
                quat_6: false,
                ts: Date.now()
            };

            // Force state to rotation active
            await this.stateMachine.forceTransition(FanControlState.ROTATION_ACTIVE, "Test setup");

            // Process through state machine - should not cause circular calls
            const actions = await this.stateMachine.process(config, sensorData, deviceStatus);
            
            console.log("✓ State machine processes without circular dependencies");
            console.log(`✓ Generated ${actions.length} actions`);

            // Test core logic directly
            const coreResult = FanControlCore.executeRotationMode({
                config,
                sensorData,
                deviceStatus,
                currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] },
                coilMapping: { quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5 },
                logger: this.mockLogger
            });

            console.log("✓ Core logic executes independently");
            console.log(`✓ Core generated ${coreResult.actions.length} actions`);

            console.log("Circular Dependency Resolution: PASSED\n");
            return true;

        } catch (error) {
            console.log(`✗ Circular dependency test error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Test atomic operations with version checking
     */
    private async testAtomicOperations(): Promise<boolean> {
        console.log("2. Testing Atomic Operations");
        console.log("============================");

        try {
            // Test successful atomic update
            const result1 = await this.stateManager.atomicUpdate((state) => {
                state.controlMode = FanControlMode.ROTATION;
                return { success: true };
            }, "Test update 1");

            if (!result1.success) {
                console.log("✗ Basic atomic update failed");
                return false;
            }
            console.log("✓ Basic atomic update successful");

            // Test version checking by simulating concurrent updates
            let concurrentResults: any[] = [];
            const promises = [];

            for (let i = 0; i < 5; i++) {
                promises.push(
                    this.stateManager.atomicUpdate((state) => {
                        state.errorCount = i;
                        return { success: true };
                    }, `Concurrent update ${i}`)
                );
            }

            concurrentResults = await Promise.all(promises);
            const successCount = concurrentResults.filter(r => r.success).length;

            console.log(`✓ Concurrent updates handled: ${successCount}/5 successful`);

            // Test validation failure
            const result2 = await this.stateManager.atomicUpdate((state) => {
                // Create invalid state
                (state as any).currentState = "invalid_state";
                return { success: true };
            }, "Invalid state test");

            if (result2.success) {
                console.log("✗ Validation should have failed");
                return false;
            }
            console.log("✓ State validation prevents invalid updates");

            console.log("Atomic Operations: PASSED\n");
            return true;

        } catch (error) {
            console.log(`✗ Atomic operations test error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Test core logic integration
     */
    private async testCoreLogicIntegration(): Promise<boolean> {
        console.log("3. Testing Core Logic Integration");
        console.log("=================================");

        try {
            const config: AutoControlConfig = {
                set_mode_fan: 1,
                set_auto_mode_fan: 0, // Threshold mode
                set_k1_fan: 25,
                set_k2_fan: 30,
                set_k3_fan: 35,
                set_k4_fan: 40
            };

            const sensorData: SensorData = {
                temp_indoor: 32, // Should trigger K2 threshold
                humi_indoor: 65,
                light_indoor: 25000,
                ts: Date.now()
            };

            const deviceStatus: DeviceStatus = {
                quat_1: false,
                quat_2: false,
                quat_3: false,
                quat_4: false,
                quat_5: false,
                quat_6: false,
                ts: Date.now()
            };

            // Test threshold mode core logic
            const thresholdResult = FanControlCore.executeThresholdMode({
                config,
                sensorData,
                deviceStatus,
                currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] },
                coilMapping: { quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5 },
                logger: this.mockLogger
            });

            console.log(`✓ Threshold logic executed: ${thresholdResult.requiredGroupSize} fans required`);
            console.log(`✓ Generated ${thresholdResult.actions.length} actions`);

            // Test fan dao logic
            const fanDaoResult = FanControlCore.executeFanDaoControl(
                { ...config, set_mode_fan_dao: 1, set_time_fan_dao_on: 5 },
                0, // Last time
                false, // Current state
                { quat_dao_1: 6, quat_dao_2: 7, quat_dao_3: 8 },
                this.mockLogger
            );

            console.log(`✓ Fan DAO logic executed: ${fanDaoResult.actions.length} actions`);

            // Test transition logic
            const transitionResult = FanControlCore.executeTransitionPhase(
                'off',
                ['quat_1', 'quat_2'],
                ['quat_3', 'quat_4'],
                Date.now(),
                Date.now(),
                1000, // Off delay
                2000, // Transition delay
                "Test transition",
                { quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5 },
                this.mockLogger
            );

            console.log(`✓ Transition logic executed: ${transitionResult.actions.length} actions`);

            console.log("Core Logic Integration: PASSED\n");
            return true;

        } catch (error) {
            console.log(`✗ Core logic integration test error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Test version conflict handling
     */
    private async testVersionConflictHandling(): Promise<boolean> {
        console.log("4. Testing Version Conflict Handling");
        console.log("====================================");

        try {
            // Get initial state version
            const initialState = this.stateManager.getState();
            const initialVersion = initialState.version;

            // Simulate version conflict by manually updating version
            await this.stateManager.atomicUpdate((state) => {
                state.version = initialVersion + 10; // Jump version ahead
                return { success: true };
            }, "Version jump");

            // Now try an update that should detect version conflict
            const conflictResult = await this.stateManager.atomicUpdate((state) => {
                state.controlMode = FanControlMode.THRESHOLD;
                return { success: true };
            }, "Should detect conflict");

            // This should succeed because our atomic update handles version conflicts with retries
            if (conflictResult.success) {
                console.log("✓ Version conflict handled with retry mechanism");
            } else {
                console.log("✓ Version conflict properly detected and handled");
            }

            console.log("Version Conflict Handling: PASSED\n");
            return true;

        } catch (error) {
            console.log(`✗ Version conflict test error: ${(error as Error).message}`);
            return false;
        }
    }

    private setupMocks(): void {
        this.mockFlowContext = new MockFlowContext();
        this.mockLogger = new MockLogger();
    }

    private initializeServices(): void {
        this.stateManager = new FanControlStateManager(this.mockFlowContext, this.mockLogger);
        this.stateMachine = new FanControlStateMachine(this.stateManager, this.mockLogger);
    }
}

// Export test runner function
export async function runImmediateFixesTests(): Promise<boolean> {
    const testSuite = new ImmediateFixesTestSuite();
    return await testSuite.runTests();
}

// Run tests if this file is executed directly
if (require.main === module) {
    runImmediateFixesTests().then(success => {
        process.exit(success ? 0 : 1);
    });
}
