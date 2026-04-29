import { ProjectSpecs } from './project-specs';
import { PersonalInfo } from '@/backend/lead/domain/lead';

export type BudgetLineItemType = 'PARTIDA' | 'MATERIAL';

/**
 * Fase 5.E — trazabilidad auditable del Judge v005.
 * `bridge` es un dict abierto porque las claves canonical dependen del tipo de
 * conversión: `thickness_m`, `density_kg_m3`, `piece_length_m`.
 */
export type MatchKind = '1:1' | '1:N' | 'from_scratch';

export interface UnitConversionRecord {
  value: number;          // cantidad original (en la unidad de partida)
  from_unit: string;      // canonical: m2 / ml / kg / ...
  to_unit: string;        // canonical del candidato
  bridge: Record<string, number>; // {"thickness_m": 0.10} | {"density_kg_m3": 2400}
  result: number;         // resultado de la conversión (en to_unit)
}

export interface BudgetPartida {
  type: 'PARTIDA';
  id: string;
  order: number;
  code: string; // From PriceBook
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number; // Includes labor + materials
  totalPrice: number;
  originalTask?: string; // The user intent that generated this
  note?: string;
  ai_justification?: string; // Telemetry logic from the Judge Agent
  sourceDatabase?: string; // e.g. '2025_catalog'
  isEstimate?: boolean;
  isRealCost?: boolean; // True if recalculated by Construction Analyst
  matchConfidence?: number; // 0-100 Score from Vector Search
  alternativeCandidates?: any[]; // Unselected candidates from Vector Search
  reasoning?: string; // AI Chain of Thought
  needsHumanReview?: boolean; // Flag if AI failed to calculate properly
  aiResolution?: any; // The raw AI decision payload
  breakdown?: BudgetBreakdownComponent[]; // Detailed cost structure
  relatedMaterial?: {
    sku: string;
    name: string;
    merchant: string;
    unitPrice: number;
    url?: string;
  };
  // Fase 5.E — v005 trace fields (Optional; ausentes en presupuestos históricos).
  match_kind?: MatchKind;
  unit_conversion_applied?: UnitConversionRecord;
  // Fase 6.D — v006: IDs de HeuristicFragments inyectados al Pro al tasar.
  applied_fragments?: string[];
}

export interface BudgetBreakdownComponent {
  code?: string;
  concept: string; // e.g. "Mano de obra", "Material: Keraben Forest"
  type: 'LABOR' | 'MATERIAL' | 'MACHINERY' | 'OTHER';
  price: number; // Unit price of this component
  unitPrice?: number; // Alias for price used by AI occasionally
  yield?: number; // Rendimiento (e.g. 0.05 h/m2)
  quantity?: number; // Alias for yield used by AI occasionally
  waste?: number; // Merma % (only for materials)
  total: number; // price * yield * (1+waste)
  totalPrice?: number; // Alias for total
  is_variable?: boolean; // Flag para el modo Sólo Ejecución
  isSubstituted?: boolean; // True if this component was swapped by AI
  alternativeComponents?: any[]; // Unselected semantic candidates to swap this ingredient manually
}

export interface BudgetMaterial {
  type: 'MATERIAL';
  id: string;
  order: number;
  sku: string; // From MaterialCatalog (e.g. Obramat)
  name: string;
  description: string;
  merchant: string;
  unit: string;
  quantity: number;
  unitPrice: number; // Product cost only
  totalPrice: number;
  deliveryTime?: string;
  originalTask?: string;
  note?: string;
  isEstimate?: boolean;
}

export type BudgetLineItem = BudgetPartida | BudgetMaterial;

export interface BudgetChapter {
  id: string;
  name: string; // e.g. "01. Demoliciones"
  order: number;
  items: BudgetLineItem[];
  totalPrice: number;
}

export interface BudgetCostBreakdown {
  materialExecutionPrice: number; // PEM (Sum of chapters)
  overheadExpenses: number; // Gastos Generales (e.g. 13%)
  industrialBenefit: number; // Beneficio Industrial (e.g. 6%)
  tax: number; // IVA
  globalAdjustment: number;
  total: number; // PEC + IVA
  executionOnlyTotal?: number; // Total expícito SIN materiales variables
  completeTotal?: number; // Total explícito CON materiales variables
}

export interface BudgetTelemetryMetrics {
  generationTimeMs: number;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costs: {
    fiatAmount: number; // EUR
    fiatCurrency: string; // 'EUR'
  };
}

export interface BudgetTelemetry {
  blueprint?: {
    originalRequest: string;
    decomposedTasks: {
      chapter: string;
      task: string;
      reasoning: string;
      estimatedParametricQuantity: number;
      estimatedParametricUnit?: string;
    }[];
  };
  executionLog?: {
    timestamp: Date;
    agent: 'Architect' | 'Surveyor' | 'Judge' | 'System';
    action: string;
    details: string;
  }[];
  metrics?: BudgetTelemetryMetrics;
}

/**
 * Represents the core Budget entity in the domain layer.
 * Now supports Chapters and Distinct Item Types.
 */
export interface Budget {
  id: string;

  // Owner Reference (Linked to Lead Module)
  leadId: string;

  // Snapshot of client data at budget creation time (Immutable record)
  clientSnapshot: PersonalInfo;

  // Metadata
  status: 'draft' | 'pending_review' | 'approved' | 'sent';
  createdAt: Date;
  updatedAt: Date;
  version: number;
  type?: 'renovation' | 'quick' | 'new_build';

  // Domain Project Data
  specs: ProjectSpecs;

  // Structure
  chapters: BudgetChapter[];

  // Financials
  costBreakdown: BudgetCostBreakdown;
  config?: {
    marginGG: number;
    marginBI: number;
    tax: number;
  };
  totalEstimated: number; // Deprecated, use costBreakdown.total

  // Origin & Metadata
  source?: 'wizard' | 'pdf_measurement' | 'manual';
  pricingMetadata?: {
    uploadedFileName?: string;
    pageCount?: number;
    extractionConfidence?: number;
  };

  /**
   * Phase 15 — versión de calibración con que fue producido este budget.
   * - 'phase14' o undefined: partidas almacenan precios all-in (markup baked-in
   *   por calibración). El editor debe forzar GG=BI=0 al renderizar para no
   *   double-countar.
   * - 'phase15': partidas almacenan raw PEM. El editor distribuye GG+BI según
   *   `config` para producir precios all-in al cliente.
   *
   * Nuevos budgets generados por la IA tras Phase 15 se stampean 'phase15'.
   */
  calibrationVersion?: 'phase14' | 'phase15';

  // Quick Consultation Response
  quickQuote?: {
    price: number;
    message: string;
    answeredAt: Date;
  };

  // AI Renders
  renders?: BudgetRender[];

  // AI Telemetry & Traceability
  telemetry?: BudgetTelemetry;

  // F6 — Cuando el admin envía el presupuesto al cliente.
  /** PDF subido a Storage cuando se envió al cliente final. */
  pdfUrl?: string;
  /** Timestamp del envío al cliente (transición approved → sent). */
  sentAt?: Date;

  // F7.B — Aceptación pública con token.
  /**
   * Token random opaque que el cliente recibe en el email de envío del
   * presupuesto. Permite acceder a la página pública de aceptación sin
   * autenticación. Se regenera si el admin reenvía el presupuesto.
   */
  acceptanceToken?: string;
  acceptanceTokenIssuedAt?: Date;
  /**
   * Aceptación firmada del cliente. Una vez registrada, el deal asociado
   * se mueve a CLOSED_WON. La firma es legalmente "electrónica simple"
   * (nombre + IP + timestamp) — suficiente para acuerdo comercial pero
   * no equivale a firma cualificada.
   */
  acceptance?: {
    acceptedAt: Date;
    signatureName: string;
    ipAddress?: string;
    userAgent?: string;
  };
  /**
   * Solicitudes de cambios del cliente desde la página pública. Cada
   * entrada vuelve el budget a `pending_review` y notifica al admin.
   */
  changeRequests?: {
    requestedAt: Date;
    comment: string;
    ipAddress?: string;
  }[];
}

export interface BudgetRender {
  id: string;
  url: string;
  originalUrl?: string;
  prompt: string;
  style: string;
  roomType: string;
  createdAt: Date;
  includeInPdf?: boolean;
}

/**
 * Represents a repository interface for budget data persistence.
 */
export interface BudgetRepository {
  findById(id: string): Promise<Budget | null>;
  findByLeadId(leadId: string): Promise<Budget[]>;
  findAll(): Promise<Budget[]>;
  /** Devuelve el budget asociado a un acceptanceToken activo, o null. */
  findByAcceptanceToken(token: string): Promise<Budget | null>;
  save(budget: Budget): Promise<void>;
  delete(id: string): Promise<void>;
}
