import { ProjectSpecs } from './project-specs';
import { PersonalInfo } from '@/backend/lead/domain/lead';

export type BudgetLineItemType = 'PARTIDA' | 'MATERIAL';

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
  save(budget: Budget): Promise<void>;
  delete(id: string): Promise<void>;
}
