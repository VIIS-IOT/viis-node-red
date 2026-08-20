/**
 * @fileoverview ThingsBoard RPC controller - Migrated to routing-controllers
 *
 * This controller demonstrates the enhanced patterns for VIIS API modules:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides ThingsBoard RPC processing functionality
 * - Serves as a template for other API module controllers
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - ThingsBoard RPC message processing
 * - MQTT integration with existing core services
 * - Telemetry data transformation with type detection
 * - Comprehensive error handling and response formatting
 * - Real-time device communication via RPC
 */

import 'reflect-metadata';
import { JsonController, Post, Get, Body, Param, Authorized, CurrentUser, QueryParam } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { ThingsBoardService } from '../services/thingsboard.service';
import { NODE_TOKEN } from '../container/container.setup';
import {
    ThingsBoardRpcRequestDto,
    RpcExecutionResultDto,
} from '../dto/thingsboard.dto';

/**
 * Enhanced ThingsBoard RPC controller class with comprehensive validation
 *
 * This controller demonstrates the enhanced patterns for VIIS API modules:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides full ThingsBoard RPC lifecycle management
 * - Serves as a template for other API module controllers
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - Comprehensive ThingsBoard RPC endpoints
 * - MQTT integration with existing core services
 * - Telemetry data transformation and type detection
 * - Consistent error handling and response formatting
 * - Real-time device communication capabilities
 */
@JsonController('/thingsboard')
@Service()
export class ThingsBoardController {
    constructor(
        @Inject() private thingsBoardService: ThingsBoardService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        // Validate that node is properly injected
        if (!this.node) {
            console.error('[VIIS-REST-API] ThingsBoardController: Node injection failed - node is undefined');
            throw new Error('ThingsBoardController initialization failed: Node dependency not properly injected');
        }

        logger.info(this.node, 'Enhanced ThingsBoardController initialized with routing-controllers and automatic validation');
    }

    /**
     * Enhanced one-way RPC endpoint with automatic validation
     * POST /api/v2/thingsboard/rpc/oneway/:id
     *
     * Features:
     * - Automatic request validation using enhanced ThingsBoardRpcRequestDto
     * - Support for multiple RPC methods (setTelemetry, controlDevice, etc.)
     * - Telemetry data transformation with type detection
     * - MQTT publishing with retry logic
     * - Comprehensive error handling and logging
     * - Standardized response format
     *
     * @param deviceId - Device ID from URL parameter
     * @param rpcData - Validated RPC request data from request body
     * @returns RPC execution result with processing details
     *
     * @example
     * Request URL: POST /api/v2/thingsboard/rpc/oneway/device123
     * Request body:
     * ```json
     * {
     *   "method": "setTelemetry",
     *   "params": {
     *     "temperature": 25.5,
     *     "humidity": "60",
     *     "status": "true",
     *     "metadata": {"location": "room1"}
     *   },
     *   "timeout": 30000,
     *   "retries": 3
     * }
     * ```
     *
     * Response:
     * ```json
     * {
     *   "success": true,
     *   "deviceId": "device123",
     *   "method": "setTelemetry",
     *   "telemetryRecordsCount": 4,
     *   "mqttPublished": true,
     *   "mqttTopic": "v1/device/device123/rpc/+",
     *   "processingTime": 150
     * }
     * ```
     */
    @Post('/rpc/oneway/:id')
    @Authorized()
    async processOneWayRpc(
        @Param('id') deviceId: string,
        @Body() rpcData: ThingsBoardRpcRequestDto,
        @CurrentUser() user: any
    ): Promise<RpcExecutionResultDto> {
        logger.info(this.node, `Enhanced one-way RPC request for device: ${deviceId}`, {
            method: rpcData.method,
            deviceId,
            hasParams: !!rpcData.params,
            userId: user?.user_id
        });

        try {
            // Process RPC request using service
            const responseDto = await this.thingsBoardService.processOneWayRpcFromDto(
                deviceId,
                rpcData,
                user
            );

            // Schedule activation logic is now handled within the service

            logger.info(this.node, `One-way RPC processed successfully for device: ${deviceId}`, {
                method: rpcData.method,
                requestId: responseDto.requestId,
                processingTime: responseDto.processingTime,
                recordsCount: responseDto.telemetryRecordsCount,
                mqttPublished: responseDto.mqttPublished,
                userId: user?.user_id
            });

            return responseDto;

        } catch (error) {
            logger.error(this.node, `One-way RPC failed for device: ${deviceId}`, {
                error: (error as Error).message,
                method: rpcData.method,
                deviceId,
                userId: user?.user_id
            });
            throw error;
        }
    }


    /**
     * Enhanced service health check endpoint
     * GET /api/v2/thingsboard/health
     *
     * Features:
     * - Service health status monitoring
     * - MQTT connection status
     * - Processing statistics
     * - Performance metrics
     *
     * @returns Service health information
     */
    @Get('/health')
    async getServiceHealth(): Promise<any> {
        logger.debug(this.node, 'ThingsBoard service health check requested');

        try {
            const healthInfo = await this.thingsBoardService.getServiceHealthInfo();

            logger.debug(this.node, 'ThingsBoard service health check completed', {
                status: healthInfo.status
            });

            return healthInfo;

        } catch (error) {
            logger.error(this.node, 'ThingsBoard service health check failed', {
                error: (error as Error).message
            });
            throw error;
        }
    }

}
