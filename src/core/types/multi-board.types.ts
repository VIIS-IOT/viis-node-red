/**
 * Shared Type Definitions for Multi-Board Modbus Support
 * Used by all VIIS nodes that support multi-board functionality
 */

/**
 * Board selection mode configuration
 */
export type BoardMode = 'auto' | 'single' | 'multi';

/**
 * Multi-board configuration structure
 */
export interface MultiBoardConfig {
    mode: 'multi';
    defaultBoard?: string;
    boards: ModbusBoardConfig[];
}

/**
 * Individual board configuration
 */
export interface ModbusBoardConfig {
    id: string;                    // Unique board identifier
    name?: string;                 // Human-readable name
    host: string;                  // IP address or hostname
    tcpPort: number;              // TCP port (default: 502)
    type: "TCP" | "RTU";          // Connection type
    unitId?: number;              // Modbus unit ID (default: 1)
    timeout?: number;             // Connection timeout in ms
    reconnectInterval?: number;   // Reconnect interval in ms
    // Board-specific settings
    boardType?: "STM32" | "ATMEGA" | "GENERIC";
    writeTimeout?: number;
    readTimeout?: number;
    connectionTimeout?: number;
    maxRetries?: number;
}

/**
 * Board mapping result with auto-detected board
 */
export interface BoardMappingResult {
    boardId: string;              // Auto-detected board ID
    address: number;              // Modbus address
    type: 'coil' | 'holding' | 'input' | 'discrete';
}

/**
 * Node configuration with multi-board support
 */
export interface MultiBoardNodeConfig {
    boardMode?: BoardMode;        // Board selection mode
    boardId?: string;            // Static board assignment (optional)
}

/**
 * Request payload with board selection
 */
export interface MultiBoardRequestPayload {
    boardId?: string;            // Dynamic board selection (overrides node config)
    [key: string]: any;         // Other payload properties
}

/**
 * Board selection priority (highest to lowest):
 * 1. msg.payload.boardId (dynamic)
 * 2. node.config.boardId (static)
 * 3. MODBUS_DEFAULT_BOARD (env)
 * 4. First board in MODBUS_BOARDS
 * 5. Single-board fallback
 */
export enum BoardSelectionPriority {
    DYNAMIC_PAYLOAD = 1,
    STATIC_CONFIG = 2,
    DEFAULT_ENV = 3,
    FIRST_BOARD = 4,
    SINGLE_FALLBACK = 5
}

/**
 * Board connection status
 */
export interface BoardConnectionStatus {
    boardId: string;
    connected: boolean;
    referenceCount: number;
    lastError?: string;
    lastConnected?: Date;
}

/**
 * Multi-board system status
 */
export interface MultiBoardSystemStatus {
    mode: 'single' | 'multi';
    boards: BoardConnectionStatus[];
    defaultBoard?: string;
    totalConnections: number;
}
