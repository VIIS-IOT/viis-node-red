"use strict";
/**
 * Fertilizer Module Entities
 *
 * Export all fertilizer-related TypeORM entities for use in:
 * - DataSource configuration
 * - Services (LookupTableService, IrrigationRunService)
 * - Node-RED custom nodes (viis-fertilizer-ec-control)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TabiotFertilizerIrrigationRun = exports.TabiotFertilizerLookupPoint = void 0;
var TabiotFertilizerLookupPoint_1 = require("./TabiotFertilizerLookupPoint");
Object.defineProperty(exports, "TabiotFertilizerLookupPoint", { enumerable: true, get: function () { return TabiotFertilizerLookupPoint_1.TabiotFertilizerLookupPoint; } });
var TabiotFertilizerIrrigationRun_1 = require("./TabiotFertilizerIrrigationRun");
Object.defineProperty(exports, "TabiotFertilizerIrrigationRun", { enumerable: true, get: function () { return TabiotFertilizerIrrigationRun_1.TabiotFertilizerIrrigationRun; } });
