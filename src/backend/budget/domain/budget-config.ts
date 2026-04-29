/**
 * Entidad que define la configuración global para el cálculo de presupuestos.
 * Estos valores se aplican sobre el coste de ejecución material (PEM) para obtener el precio de venta.
 */
export interface BudgetConfig {
    id: string; // Habitualmente 'default'

    // Porcentajes en formato decimal (ej: 0.13 para 13%)
    overheadExpenses: number; // Gastos Generales
    industrialBenefit: number; // Beneficio Industrial / Margen Comercial

    // Impuestos
    iva: number; // IVA aplicable por defecto (ej: 0.10 para reformas)

    // Ajustes Manuales
    globalAdjustmentFactor: number; // Factor multiplicador final (para ajuste fino)

    // Tarifas Base
    baseIntegralReformRateM2?: number; // Tarifa base por m2 para reformas integrales (ej: 650)

    // Márgenes específicos por tipo de recurso (antes de GG/BI)
    materialMargin?: number; // Margen comercial sobre materiales (ej: 0.10 para 10%)
    laborMargin?: number; // Margen sobre mano de obra (ej: 0.0)

    updatedAt: Date;
    updatedBy: string;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
    id: 'default',
    // Phase 15 — Defaults Grupo RG (convención de markup distribuido):
    // partidas almacenan raw PEM; el editor distribuye GG+BI equitativamente.
    overheadExpenses: 0.10, // 10% Gastos Generales (Grupo RG)
    industrialBenefit: 0.15, // 15% Beneficio Industrial (Grupo RG)
    iva: 0.10, // 10% IVA Reducido (reformas residenciales)
    globalAdjustmentFactor: 1.0, // Sin ajuste extra
    baseIntegralReformRateM2: 650, // 650€/m2 estandard
    materialMargin: 0.10, // 10% margen materiales por defecto
    laborMargin: 0.0, // Solo coste
    updatedAt: new Date(),
    updatedBy: 'system'
};

export interface BudgetConfigRepository {
    getConfig(): Promise<BudgetConfig>;
    saveConfig(config: BudgetConfig): Promise<void>;
}
