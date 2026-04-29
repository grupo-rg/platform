from typing import List, Optional, Literal, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

# --- Enums & Literals ---
BudgetLineItemType = Literal['PARTIDA', 'MATERIAL']
BudgetStatus = Literal['draft', 'pending_review', 'approved', 'sent']
InterventionType = Literal['new_build', 'renovation', 'total', 'quick'] # Including values from TS type and specs
BudgetSource = Literal['wizard', 'pdf_measurement', 'manual']

# --- Value Objects ---
class ProjectSpecs(BaseModel):
    # Depending on the original ProjectSpecs from TS, this would contain interventionType, etc.
    interventionType: Optional[InterventionType] = None
    # Add other fields here as needed depending on the original TS interface.
    # To be extremely precise, we can keep the rest as **kwargs or dict if not fully mapped.
    class Config:
        extra = "allow"

class PersonalInfo(BaseModel):
    name: str = "Cliente Generico"
    email: str = ""
    phone: str = ""
    company: Optional[str] = None
    nif: Optional[str] = None

class BudgetBreakdownComponent(BaseModel):
    code: Optional[str] = None
    concept: str
    type: Literal['LABOR', 'MATERIAL', 'MACHINERY', 'OTHER']
    price: float
    yield_amount: Optional[float] = Field(None, alias="yield") # 'yield' is a reserved keyword in Python
    waste: Optional[float] = None
    total: float
    isSubstituted: Optional[bool] = None
    alternativeComponents: Optional[List[Dict[str, Any]]] = None
    # Fase 9.7 — flag heredado del catálogo. Optional para retrocompat con
    # presupuestos históricos que no lo tenían. El editor frontend (modos
    # Sólo Ejecución / Exclusivamente Mano de Obra) lo lee como `is_variable`.
    is_variable: Optional[bool] = None

class BudgetConfig(BaseModel):
    marginGG: float
    marginBI: float
    tax: float

class BudgetCostBreakdown(BaseModel):
    materialExecutionPrice: float
    overheadExpenses: float
    industrialBenefit: float
    tax: float
    globalAdjustment: float
    total: float

# --- HITL Structs ---
class OriginalItem(BaseModel):
    code: str
    description: str
    quantity: float
    unit: str
    chapter: str
    raw_table_data: Optional[str] = None

class AIResolution(BaseModel):
    selected_candidate: Optional[Dict[str, Any]] = None
    reasoning_trace: str
    calculated_unit_price: float
    calculated_total_price: float
    confidence_score: int
    is_estimated: bool
    needs_human_review: bool

# --- ICL & RLHF Fragment Entities (Many-Shot Engine) ---
class HeuristicContext(BaseModel):
    budgetId: str
    pdfOriginalText: Optional[str] = None
    originalDescription: Optional[str] = None
    originalQuantity: Optional[float] = None
    originalUnit: Optional[str] = None

class HeuristicAIInferenceTrace(BaseModel):
    proposedCandidateId: Optional[str] = None
    proposedUnitPrice: float
    aiReasoning: Optional[str] = None

class HeuristicHumanCorrection(BaseModel):
    selectedCandidateTuple: Optional[str] = None
    selectedCandidateCode: Optional[str] = None
    correctedUnitPrice: Optional[float] = None
    correctedUnit: Optional[str] = None
    heuristicRule: str
    correctedByUserId: Optional[str] = None

class HeuristicFragment(BaseModel):
    id: str
    sourceType: Literal['internal_admin', 'public_demo', 'baseline_migration']
    status: Literal['golden', 'pending_review', 'rejected']
    context: HeuristicContext
    aiInferenceTrace: HeuristicAIInferenceTrace
    humanCorrection: HeuristicHumanCorrection
    tags: List[str] = Field(default_factory=list)
    timestamp: datetime

# --- Entities: Line Items ---
class BudgetPartida(BaseModel):
    type: Literal['PARTIDA'] = 'PARTIDA'
    id: str
    order: int
    
    # HITL Nested Structure (New Standard)
    original_item: Optional[OriginalItem] = None
    ai_resolution: Optional[AIResolution] = None
    alternatives: Optional[List[Dict[str, Any]]] = None
    
    # Flat Structure (Backwards Compatibility with Next.js UI)
    code: str
    description: str
    unit: str
    quantity: float
    unitPrice: float
    totalPrice: float
    originalTask: Optional[str] = None
    note: Optional[str] = None
    ai_justification: Optional[str] = None
    sourceDatabase: Optional[str] = None
    isEstimate: Optional[bool] = None
    isRealCost: Optional[bool] = None
    matchConfidence: Optional[float] = None
    alternativeCandidates: Optional[List[Any]] = Field(default=None, exclude=True)
    reasoning: Optional[str] = None
    breakdown: Optional[List[BudgetBreakdownComponent]] = None
    relatedMaterial: Optional[Dict[str, Any]] = None # Could be strictly typed if needed
    # Fase 5.E — trazabilidad v005 del Judge hacia la UI. Ambos Optional para que
    # presupuestos históricos (sin estos campos en Firestore) sigan leyéndose sin
    # romper. `unit_conversion_applied` se guarda como dict plano (no como el
    # modelo pydantic original `UnitConversionRecord`) para serializar directo a
    # Firestore y ser consumible por la UI de Next.js sin conversiones.
    match_kind: Optional[Literal['1:1', '1:N', 'from_scratch']] = None
    unit_conversion_applied: Optional[Dict[str, Any]] = None
    # Fase 6.D — IDs de los HeuristicFragments (v006) que el Swarm inyectó en el
    # prompt del Pro al tasar esta partida. `None` = no se buscó fragments;
    # `[]` (no lo emitimos en este sprint) sería "se buscó y no había ninguno".
    applied_fragments: Optional[List[str]] = None

class BudgetMaterial(BaseModel):
    type: Literal['MATERIAL'] = 'MATERIAL'
    id: str
    order: int
    sku: str
    name: str
    description: str
    merchant: str
    unit: str
    quantity: float
    unitPrice: float
    totalPrice: float
    deliveryTime: Optional[str] = None
    originalTask: Optional[str] = None
    note: Optional[str] = None
    isEstimate: Optional[bool] = None

# Using Union to allow both forms in a chapter list
BudgetLineItem = BudgetPartida | BudgetMaterial

# --- Entities: Chapter ---
class BudgetChapter(BaseModel):
    id: str
    name: str
    order: int
    items: List[BudgetLineItem]
    totalPrice: float

# --- Telemetry & Analytics ---
class BudgetTelemetryMetrics(BaseModel):
    generationTimeMs: float
    tokens: Dict[str, float] # inputTokens, outputTokens, totalTokens
    costs: Dict[str, Any] # fiatAmount, fiatCurrency

class BudgetTelemetry(BaseModel):
    blueprint: Optional[Dict[str, Any]] = None
    executionLog: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[BudgetTelemetryMetrics] = None

class BudgetPricingMetadata(BaseModel):
    uploadedFileName: Optional[str] = None
    pageCount: Optional[int] = None
    extractionConfidence: Optional[float] = None

# --- Aggregate Root: Budget ---
class Budget(BaseModel):
    id: str
    leadId: str
    clientSnapshot: PersonalInfo
    status: BudgetStatus
    createdAt: datetime
    updatedAt: datetime
    version: int
    type: Optional[InterventionType] = None
    specs: ProjectSpecs
    chapters: List[BudgetChapter]
    costBreakdown: BudgetCostBreakdown
    config: Optional[BudgetConfig] = None
    totalEstimated: float # Deprecated in TS, but kept for signature parity
    source: Optional[BudgetSource] = None
    pricingMetadata: Optional[BudgetPricingMetadata] = None
    quickQuote: Optional[Dict[str, Any]] = None
    renders: Optional[List[Dict[str, Any]]] = None
    telemetry: Optional[BudgetTelemetry] = None
    # Phase 15 — versión de calibración con que fue producido este budget.
    # 'phase15' indica que partidas almacenan raw PEM (markup distribuido por editor).
    # Ausencia o 'phase14' indica calibración legacy (partidas all-in).
    calibrationVersion: Optional[str] = None
