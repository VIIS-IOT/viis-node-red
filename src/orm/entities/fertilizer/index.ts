/**
 * Fertilizer Module Entities
 *
 * Export all fertilizer-related TypeORM entities for use in:
 * - DataSource configuration
 * - Services (LookupTableService, IrrigationRunService)
 * - Node-RED custom nodes (viis-fertilizer-ec-control)
 */

export { TabiotFertilizerLookupPoint } from './TabiotFertilizerLookupPoint';
export { TabiotFertilizerIrrigationRun } from './TabiotFertilizerIrrigationRun';
