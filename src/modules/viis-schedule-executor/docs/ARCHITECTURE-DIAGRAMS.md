# VIIS Schedule Executor - Architecture Diagrams

## System Context Diagram

```mermaid
graph TB
    subgraph "External Systems"
        DB[(PostgreSQL<br/>Schedule Database)]
        ModbusPLC[Modbus PLC<br/>Valves, Pumps, Sensors]
        TB[ThingsBoard Cloud<br/>MQTT Broker]
        EMQX[EMQX Local<br/>MQTT Broker]
        Backend[VIIS Backend API<br/>HTTP Notifications]
    end
    
    subgraph "Node-RED Runtime"
        Inject[Inject Node<br/>Timer Trigger]
        ScheduleNode[viis-schedule-executor<br/>Custom Node]
        Output[Output Node<br/>Next in Flow]
    end
    
    subgraph "Schedule Executor Module"
        EntryPoint[viis-schedule-executor.ts<br/>Node Entry Point]
        Service[viis-schedule-executor-service.ts<br/>Business Logic]
        Resilience[resilience-utils.ts<br/>Fault Tolerance]
        Types[type.ts<br/>Type Definitions]
    end
    
    Inject --> ScheduleNode
    ScheduleNode --> Output
    
    ScheduleNode -.-> EntryPoint
    EntryPoint -.-> Service
    Service -.-> Resilience
    Service -.-> Types
    
    DB <-->|Query/Update| Service
    ModbusPLC <-->|Read/Write Commands| Service
    
    Service -->|Publish Telemetry| TB
    Service -->|Publish Telemetry| EMQX
    Service -->|POST Notifications| Backend
    
    style ScheduleNode fill:#a6bbcf
    style EntryPoint fill:#e1f5ff
    style Service fill:#e1ffe1
    style Resilience fill:#fff5e1
```

## Component Interaction Diagram

```mermaid
graph LR
    subgraph "Node-RED Flow"
        Inject[Inject Node] --> Executor[viis-schedule-executor]
        Executor --> Debug[Debug Node]
    end
    
    subgraph "Core Components"
        Executor --> NodeWrapper[viis-schedule-executor.ts<br/>Node Wrapper]
        NodeWrapper --> ScheduleSvc[ScheduleService<br/>Business Logic]
        ScheduleSvc --> ModbusClient[ModbusClientCore]
        ScheduleSvc --> MqttClient[MqttClientCore ×2<br/>ThingsBoard + EMQX]
        ScheduleSvc --> TypeORM[TypeORM Repository]
        ScheduleSvc --> Axios[Axios HTTP Client]
    end
    
    subgraph "Global Context"
        NodeWrapper --> ActiveCmds[activeModbusCommands]
        NodeWrapper --> ConfigVals[configKeyValues]
        NodeWrapper --> StatusHist[scheduleStatusHistory]
        NodeWrapper --> ConfigKeys[scheduleConfigKeys]
        ScheduleSvc -.-> ActiveCmds
        ScheduleSvc -.-> ConfigVals
        ScheduleSvc -.-> StatusHist
        ScheduleSvc -.-> ConfigKeys
    end
    
    subgraph "Resilience Layer"
        ScheduleSvc --> Timeout[executeWithTimeout]
        ScheduleSvc --> Retry[executeWithExponentialBackoff]
        ScheduleSvc --> CircuitBreaker[executeWithCircuitBreaker]
        ScheduleSvc --> MqttQueue[MqttFailedQueue]
    end
    
    style Executor fill:#a6bbcf
    style NodeWrapper fill:#e1f5ff
    style ScheduleSvc fill:#e1ffe1
```

## Schedule Execution State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    
    Idle --> CheckingDue: Trigger received
    CheckingDue --> Idle: No schedules due
    
    CheckingDue --> StartingSchedule: Schedule due && not running
    
    state StartingSchedule {
        [*] --> MappingCommands
        MappingCommands --> CheckingOverlap: Commands mapped
        CheckingOverlap --> ExecutingModbus: No overlap
        CheckingOverlap --> SkippingSchedule: Overlap detected
        ExecutingModbus --> VerifyingWrite: Commands sent
        VerifyingWrite --> StoringCommands: Verification passed
        VerifyingWrite --> RetryingWrite: Verification failed
        RetryingWrite --> ExecutingModbus: Retry < 3
        RetryingWrite --> ExecutionFailed: Retry >= 3
        StoringCommands --> PublishingTelemetry: Commands stored
        PublishingTelemetry --> PublishingAudit: Telemetry sent
        PublishingAudit --> SendingNotification: Audit logged
        SendingNotification --> SyncingLog: Notification sent
        SyncingLog --> [*]: Log synced
        ExecutionFailed --> [*]: Error logged
        SkippingSchedule --> [*]: Schedule skipped
    }
    
    StartingSchedule --> Running: Start sequence complete
    
    Running --> StillRunning: Still within time window
    StillRunning --> Running: 1-min interval check
    
    Running --> FinishingSchedule: Past end time
    
    state FinishingSchedule {
        [*] --> GettingActiveCommands
        GettingActiveCommands --> ResettingDevices: Commands retrieved
        ResettingDevices --> CheckingResetResult: All commands reset
        CheckingResetResult --> ClearingState: Reset succeeded
        CheckingResetResult --> ErrorHandling: Reset failed
        ClearingState --> GettingConfigValues: Commands cleared
        GettingConfigValues --> ClearingConfigValues: Values retrieved
        ClearingConfigValues --> UpdatingStatus: Config reset to 0
        UpdatingStatus --> ClearingHistory: Status = finished
        ClearingHistory --> PublishingTelemetry: History cleared
        PublishingTelemetry --> PublishingAudit: Telemetry sent
        PublishingAudit --> SendingNotification: Audit logged
        SendingNotification --> SyncingLog: Notification sent
        SyncingLog --> [*]: Log synced
        ErrorHandling --> KeepingRunning: Error notification sent
        KeepingRunning --> [*]: Status remains running
    }
    
    FinishingSchedule --> Finished: Finish sequence complete
    Finished --> Idle: Ready for next execution
```

## Message Routing Logic

```mermaid
graph TD
    A[Input Message Received] --> B{Has payload.payload.method?}
    
    B -->|No| C[Schedule Check Flow]
    B -->|Yes| D{Method Name?}
    
    D -->|schedule-disable-by-backend| E[RPC Disable Flow]
    D -->|confirm-devices-off| F[Manual Recovery Flow]
    D -->|control| G[RPC Control Flow]
    D -->|Unknown| H[Log Warning & Return]
    
    C --> I[Fetch all due schedules]
    E --> J[Find schedule by ID]
    F --> K[Find schedule by ID]
    G --> L[Process each param]
    
    J --> M{Schedule running?}
    M -->|Yes| N[Reset devices & disable]
    M -->|No| O[Only disable schedule]
    
    K --> P{Schedule running?}
    P -->|Yes| Q{verifyDevices?}
    P -->|No| R[Return: Not running]
    
    Q -->|Yes| S[Read Modbus to verify]
    Q -->|No| T[Trust user confirmation]
    
    S --> U{All devices OFF?}
    U -->|Yes| V[Set to finished]
    U -->|No| W[Return: Devices still ON]
    
    T --> V
    V --> X[Clear commands & config]
    
    L --> Y{Key in Modbus mapping?}
    Y -->|Yes| Z[Return: action=modbus]
    Y -->|No| AA{Value falsy?}
    
    AA -->|Yes| AB[Return: error]
    AA -->|No| AC[Store in configKeyValues]
    
    AC --> AD[Return: action=config]
    
    N --> AE[Publish telemetry & audit]
    O --> AE
    X --> AE
    AE --> AF[Send output message]
    AD --> AF
    AF --> AG[Done]
    
    I --> AH[Evaluate each schedule]
    AH --> AI[Execute or skip]
    AI --> AF
    
    style A fill:#e1f5ff
    style AG fill:#e1ffe1
    style E fill:#ffe1e1
    style F fill:#ffe1e1
    style G fill:#ffe1e1
    style C fill:#e1ffe1
```

## Modbus Command Execution Sequence

```mermaid
sequenceDiagram
    participant Node as Schedule Executor
    participant Service as ScheduleService
    participant Modbus as Modbus Device
    participant Verify as Verification Logic
    
    Note over Node,Verify: START SEQUENCE
    
    Node->>Service: mapScheduleToModbus(schedule)
    Service->>Service: Parse action JSON
    Service->>Service: Add iri_time if missing
    Service->>Service: Normalize string numbers
    
    loop For each key in action
        alt Key in holding registers
            Service->>Service: Create FC=6 command
        else Key in coils
            Service->>Service: Create FC=5 command
        else Key not mapped && not falsy
            Service->>Service: Store as config parameter
        else Key not mapped && falsy
            Note over Service: Skip key
        end
    end
    
    Service-->>Node: holdingCommands, coilCommands, configParams
    
    Node->>Node: Add reset keys<br/>(time_valve_*, set_flow_* not in action)
    
    Node->>Service: canExecuteCommands()
    Service->>Service: Check overlap with activeModbusCommands
    
    alt No overlap
        Service-->>Node: true
        
        Node->>Service: executeModbusCommands()
        
        Note over Service,Modbus: Phase 1: Holding Registers
        loop For each holding command
            Service->>Modbus: writeRegister(address, scaled_value)
            Modbus-->>Service: Acknowledge
            Service->>Service: Delay 100ms
        end
        
        Note over Service,Modbus: Phase 2: Valve Coils
        loop For each valve coil
            Service->>Modbus: writeCoil(address, value)
            Modbus-->>Service: Acknowledge
            Service->>Service: Delay 100ms
        end
        
        Note over Service,Modbus: Phase 3: Other Coils
        loop For each other coil
            Service->>Modbus: writeCoil(address, value)
            Modbus-->>Service: Acknowledge
            Service->>Service: Delay 100ms
        end
        
        Note over Service: DELAY 5 SECONDS
        Service->>Service: await delay(5000)
        
        Note over Service,Modbus: Phase 4: Control Coils (Pump/Power)
        loop For each control coil
            Service->>Modbus: writeCoil(address, value)
            Modbus-->>Service: Acknowledge
            Service->>Service: Delay 100ms
        end
        
        Note over Service,Verify: VERIFICATION PHASE
        
        Node->>Service: verifyModbusWrite()
        
        loop For each command to verify
            alt FC=5 (Coil - Always verified)
                Service->>Modbus: readCoils(address, 1)
                Modbus-->>Service: Return value
            else FC=6 (Holding - If verifyAfterWrite)
                Service->>Modbus: readHoldingRegisters(address, 1)
                Modbus-->>Service: Return raw value
                Service->>Service: Scale value (read direction)
            end
            
            Service->>Service: Compare with expected
            alt Value matches
                Note over Service: Verification OK
            else Value mismatch
                Service-->>Node: false
                Note over Node: Retry or fail
            end
        end
        
        Service-->>Node: true (all verified)
        
        Node->>Service: storeActiveCommands()
        Service->>Service: Save to activeModbusCommands
        
    else Overlap detected
        Service-->>Node: false
        Note over Node: Skip execution
    end
    
    Note over Node,Verify: Finish sequence follows reverse order
```

## Configuration Parameter Lifecycle

```mermaid
sequenceDiagram
    participant Schedule as Schedule Action
    participant Service as ScheduleService
    participant Context as Global Context
    participant Finish as Schedule Finish
    
    Note over Schedule,Finish: Configuration parameters are unmapped keys<br/>(not in MODBUS_COILS or MODBUS_HOLDING_REGISTERS)
    
    Schedule->>Service: mapScheduleToModbus()
    Note over Schedule: Example action:<br/>{ "valve_1": true,<br/>  "irrigation_mode": "drip",<br/>  "user_id": 123 }
    
    Service->>Service: Check key mapping
    alt valve_1 in modbusCoils
        Service->>Service: Create Modbus coil command
    else irrigation_mode not mapped
        Service->>Service: storeConfigParameter()
        Service->>Service: validateAndConvertValue()
        Service->>Service: detectParameterType()
        Service->>Context: Add to configKeyValues
        Note over Context: configKeyValues = {<br/>  "irrigation_mode": "drip",<br/>  "user_id": 123<br/>}
        Service->>Context: Track in scheduleConfigKeys
        Note over Context: scheduleConfigKeys = {<br/>  "schedule_001": ["irrigation_mode", "user_id"]<br/>}
    end
    
    Service-->>Schedule: { coilCommands, configParameters }
    
    Note over Schedule,Finish: Schedule runs with these config values...
    
    Finish->>Service: clearScheduleConfigValues(scheduleId)
    Service->>Context: Get scheduleConfigKeys[scheduleId]
    Context-->>Service: ["irrigation_mode", "user_id"]
    
    Service->>Context: Get configKeyValues
    Context-->>Service: { "irrigation_mode": "drip", "user_id": 123 }
    
    loop For each tracked key
        Service->>Context: Set value to 0
        Note over Context: configKeyValues = {<br/>  "irrigation_mode": 0,<br/>  "user_id": 0<br/>}
    end
    
    Service->>Context: Update configKeyValues
    Note over Context: Keys preserved, values reset<br/>Other schedules can override
    
    Service-->>Finish: Config values cleared
    
    Note over Finish: Next schedule can now set<br/>irrigation_mode to different value
```

## RPC Command Processing

```mermaid
graph TD
    A[RPC Message Received] --> B{Extract method from payload}
    
    B --> C{Method exists?}
    C -->|No| D[Continue to schedule check]
    C -->|Yes| E{Method name?}
    
    E -->|schedule-disable-by-backend| F
    E -->|confirm-devices-off| G
    E -->|control| H
    
    subgraph "Schedule Disable RPC"
        F --> F1{scheduleId in params?}
        F1 -->|No| F2[Error: Missing scheduleId]
        F1 -->|Yes| F3[Find schedule by ID]
        F3 --> F4{Schedule exists?}
        F4 -->|No| F5[Status: Not found]
        F4 -->|Yes| F6{Status = running?}
        F6 -->|Yes| F7[Reset all Modbus commands]
        F6 -->|No| F8[Only set enable=0]
        F7 --> F9{Reset success?}
        F9 -->|Yes| F10[Clear commands & config<br/>Set status=finished<br/>Publish telemetry]
        F9 -->|No| F11[Keep status=running<br/>Send error notification]
        F8 --> F10
        F10 --> F12[Done - Send output]
        F11 --> F12
    end
    
    subgraph "Confirm Devices Off RPC"
        G --> G1{scheduleId in params?}
        G1 -->|No| G2[Error: Missing scheduleId]
        G1 -->|Yes| G3[Find schedule by ID]
        G3 --> G4{Status = running?}
        G4 -->|No| G5[Status: Not running]
        G4 -->|Yes| G6{verifyDevices?}
        G6 -->|Yes| G7[Read all active commands from Modbus]
        G6 -->|No| G8[Trust user confirmation]
        G7 --> G9{All devices OFF/0?}
        G9 -->|Yes| G8
        G9 -->|No| G10[Error: Devices still ON]
        G8 --> G11[Clear commands & config<br/>Set status=finished<br/>Publish telemetry]
        G11 --> G12[Done - Send output]
    end
    
    subgraph "Control RPC"
        H --> H1{params exist?}
        H1 -->|No| H2[Error: Missing params]
        H1 -->|Yes| H3[For each param except scheduleId]
        H3 --> H4{Key in Modbus mapping?}
        H4 -->|Yes| H5[Return: action=modbus<br/>address, type]
        H4 -->|No| H6{Value falsy?}
        H6 -->|Yes| H7[Error: Falsy value]
        H6 -->|No| H8[Store in configKeyValues<br/>Return: action=config]
        H5 --> H9[Collect results]
        H7 --> H9
        H8 --> H9
        H9 --> H10{All params processed?}
        H10 -->|No| H3
        H10 -->|Yes| H11[Send response with results]
    end
    
    F12 --> I[End RPC Processing]
    F5 --> I
    F2 --> I
    F12 --> I
    G5 --> I
    G2 --> I
    G10 --> I
    G12 --> I
    H11 --> I
    
    style A fill:#e1f5ff
    style I fill:#e1ffe1
    style F2 fill:#ffe1e1
    style G2 fill:#ffe1e1
    style G10 fill:#ffe1e1
    style H7 fill:#ffe1e1
```

## Error Recovery Strategies

```mermaid
graph TD
    A[Error Detected] --> B{Error Type?}
    
    B -->|Modbus Write Failed| C[Retry up to 3 times]
    B -->|Modbus Verification Failed| C
    B -->|MQTT Publish Failed| D[Continue execution<br/>Error is non-fatal]
    B -->|HTTP Notification Failed| D
    B -->|Database Update Failed| E[Log error<br/>Continue if possible]
    B -->|Command Overlap| F[Skip execution<br/>Wait for next trigger]
    B -->|Power Outage| G[Startup Recovery]
    
    C --> H{Retry successful?}
    H -->|Yes| I[Continue normally]
    H -->|No| J{Start or Finish?}
    
    J -->|Start| K[Log error<br/>Status remains not-running]
    J -->|Finish| L[Keep status as running<br/>CRITICAL WARNING]
    
    D --> I
    E --> I
    F --> M[Skip this schedule]
    
    G --> N[Clear stale state]
    N --> O[Re-evaluate all schedules]
    O --> I
    
    L --> P[Send error notification]
    P --> Q[Await manual intervention]
    
    K --> I
    M --> I
    Q --> R[User sends confirm-devices-off]
    R --> S[Verify devices OFF]
    S --> T[Set to finished]
    
    style A fill:#ffe1e1
    style I fill:#e1ffe1
    style L fill:#fff5e1
    style P fill:#fff5e1
    style G fill:#e1f5ff
    style T fill:#e1ffe1
```

## Global Context Data Flow

```mermaid
graph TB
    subgraph "Write Operations"
        A1[Schedule Start] -->|Write| AC[activeModbusCommands]
        A2[Schedule Finish] -->|Clear| AC
        A3[RPC Disable] -->|Clear| AC
        A4[Manual Recovery] -->|Clear| AC
        
        B1[Config Parameter] -->|Write| CV[configKeyValues]
        B2[RPC Control] -->|Write| CV
        B3[Schedule Finish] -->|Reset to 0| CV
        
        C1[Status Change] -->|Write| SH[scheduleStatusHistory]
        C2[Schedule Finish] -->|Clear| SH
        C3[Cleanup] -->|Clean stale| SH
        
        D1[Schedule Start] -->|Write| CK[scheduleConfigKeys]
        D2[Config Parameter] -->|Append| CK
    end
    
    subgraph "Read Operations"
        E1[Overlap Check] -->|Read| AC
        E2[Finish Sequence] -->|Read| AC
        E3[Verify Devices] -->|Read| AC
        
        F1[Finish Telemetry] -->|Read| CV
        F2[RPC Disable Telemetry] -->|Read| CV
        F3[Manual Recovery Telemetry] -->|Read| CV
        
        G1[Status Change Detection] -->|Read| SH
        G2[Cleanup Check] -->|Read| SH
        
        H1[Clear Config Values] -->|Read| CK
    end
    
    subgraph "Deduplication Tracking"
        I1[Telemetry Publish] -->|Write| TL[telemetryLastPublished_*]
        I2[Telemetry Check] -->|Read| TL
    end
    
    style AC fill:#e1f5ff
    style CV fill:#fff5e1
    style SH fill:#e1ffe1
    style CK fill:#fff5e1
    style TL fill:#e1f5ff
```

## Startup Recovery Flow

```mermaid
sequenceDiagram
    participant Startup as Node Initialization
    participant Context as Global Context
    participant Warning as Node Warnings
    
    Startup->>Context: Generate currentStartupId
    Note over Context: Format: startup_{timestamp}_{random}
    
    Startup->>Context: Get lastStartupId
    Context-->>Startup: lastStartupId or null
    
    alt lastStartupId != currentStartupId
        Note over Startup,Context: FRESH STARTUP DETECTED<br/>(Possible power cycle recovery)
        
        Startup->>Context: Save currentStartupId
        Startup->>Context: Save startupTime
        
        Startup->>Context: Get activeModbusCommands
        Context-->>Startup: existingCommands
        
        Startup->>Context: Get scheduleStatusHistory
        Context-->>Startup: existingHistory
        
        Startup->>Context: Get scheduleLastCheckTimestamps
        Context-->>Startup: existingTimestamps
        
        Startup->>Startup: Count stale entries
        
        alt Stale entries found
            Startup->>Warning: Log recovery message
            Note over Warning: STARTUP RECOVERY: Detected<br/>potential stale state from power outage
            
            Startup->>Context: Clear activeModbusCommands
            Startup->>Context: Clear scheduleStatusHistory
            Startup->>Context: Clear scheduleLastCheckTimestamps
            Startup->>Context: Clear manualModbusOverrides
            
            Startup->>Warning: Log cleared counts
            
            Note over Startup: IMPORTANT: Do NOT clear<br/>configKeyValues and scheduleConfigKeys
            Note over Startup: These preserve config structure
            
            Startup->>Warning: Log preserved config structure
        else No stale entries
            Startup->>Context: Initialize empty objects if missing
            Startup->>Context: Initialize config tracking if missing
        end
    else Same startup ID
        Note over Startup,Context: NORMAL RESTART<br/>(Node redeploy, not power cycle)
        Startup->>Context: Ensure all global vars exist
    end
    
    Startup->>Startup: Initialize services
    Note over Startup: Modbus, MQTT, ScheduleService
```

## Telemetry Publishing Flow

```mermaid
sequenceDiagram
    participant Trigger as Schedule Event
    participant Builder as Telemetry Builder
    participant Dedup as Deduplication Check
    participant TB as ThingsBoard MQTT
    participant EMQX as EMQX MQTT
    participant Tracker as Last Published Tracker
    
    Trigger->>Builder: publishScheduleTelemetry()
    Note over Trigger: Triggered by:<br/>- Schedule start<br/>- Schedule finish<br/>- RPC disable<br/>- Manual recovery
    
    Builder->>Builder: Initialize telemetryData
    Note over Builder: {<br/>  ts: Date.now(),<br/>  _schedule_action: action,<br/>  _schedule_id: schedule.name,<br/>  _schedule_label: schedule.label<br/>}
    
    Builder->>Builder: Add all Modbus commands
    Note over Builder: For each command:<br/>telemetryData[cmd.key] = cmd.value
    
    Builder->>Builder: Add configKeyValues if provided
    Note over Builder: For finish/RPC actions:<br/>Include cleared config values
    
    Builder->>Dedup: Check for duplicate
    
    Dedup->>Dedup: Build hash from telemetry keys
    Note over Dedup: Exclude ts from hash
    
    Dedup->>Tracker: Get lastPublished key
    Note over Tracker: Key format:<br/>telemetryLastPublished_{name}_{action}
    
    Tracker-->>Dedup: Last published data or null
    
    alt Same hash && < 5 seconds ago
        Dedup-->>Builder: Skip (duplicate)
        Note over Builder: Skipping duplicate telemetry<br/>for {name} ({action})
    else New data or > 5 seconds
        Dedup-->>Builder: Allow publish
        
        Builder->>TB: Publish to ThingsBoard
        Note over TB: Topic: v1/devices/me/telemetry
        
        Builder->>EMQX: Publish to EMQX
        Note over EMQX: Topic: viis/things/v2/{deviceId}/telemetry
        
        Builder->>Tracker: Update lastPublished
        Note over Tracker: { hash: currentHash,<br/>  timestamp: now }
        
        Builder->>Builder: Log published keys count
    end
    
    alt Publish error
        Builder->>Builder: Log error (non-fatal)
        Note over Builder: Telemetry failure should not<br/>break schedule execution
    end
```

## Circuit Breaker State Transitions

```mermaid
sequenceDiagram
    participant Client as Operation Caller
    participant CB as CircuitBreakerManager
    participant Operation as Protected Operation
    
    Note over Client,Operation: Initial State: CLOSED (normal operation)
    
    Client->>CB: executeWithCircuitBreaker()
    CB->>CB: shouldAllowRequest()
    CB->>CB: state = CLOSED
    CB-->>Client: Allow request
    
    Client->>Operation: Execute operation
    Operation-->>Client: Success
    Client->>CB: recordSuccess()
    CB->>CB: failures = 0, state = CLOSED
    
    Note over Client,Operation: After multiple failures...
    
    Client->>CB: executeWithCircuitBreaker()
    CB->>CB: shouldAllowRequest()
    CB->>CB: state = CLOSED
    CB-->>Client: Allow request
    
    Client->>Operation: Execute operation
    Operation-->>Client: Error
    Client->>CB: recordFailure()
    CB->>CB: failures++
    
    CB->>CB: checkThreshold()
    alt failures >= failureThreshold
        CB->>CB: state = OPEN
        Note over CB: CIRCUIT TRIPPED
    end
    
    Note over Client,Operation: Circuit OPEN - requests rejected
    
    Client->>CB: executeWithCircuitBreaker()
    CB->>CB: shouldAllowRequest()
    CB->>CB: state = OPEN
    alt timeSinceLastFailure < resetTimeout
        CB-->>Client: REJECT (Circuit breaker OPEN)
    else timeSinceLastFailure >= resetTimeout
        CB->>CB: state = HALF-OPEN
        CB-->>Client: Allow test request
    end
    
    alt Test request succeeds
        Client->>Operation: Execute (test)
        Operation-->>Client: Success
        Client->>CB: recordSuccess()
        CB->>CB: failures = 0, state = CLOSED
        Note over CB: CIRCUIT RECOVERED
    else Test request fails
        Client->>Operation: Execute (test)
        Operation-->>Client: Error
        Client->>CB: recordFailure()
        CB->>CB: state = OPEN
        Note over CB: CIRCUIT RE-TRIPPED
    end
```

---

*Architecture diagrams generated on April 13, 2026*
