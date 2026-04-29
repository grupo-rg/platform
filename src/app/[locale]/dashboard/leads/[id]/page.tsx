import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    ArrowLeft,
    Mail,
    Phone,
    MapPin,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    ShieldAlert,
    FileText,
    ExternalLink,
    MessageSquare,
    User as UserIcon,
    Bot,
    Image as ImageIcon,
    Database,
    Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getAdminLeadDetailAction } from '@/actions/lead/get-admin-lead-detail.action';
import { getLeadConversationAction } from '@/actions/lead/get-lead-conversation.action';
import { RefineBudgetButton } from '@/components/leads/RefineBudgetButton';
import { DeleteLeadButton } from '@/components/leads/DeleteLeadButton';
import { LeadAttachmentsGallery } from '@/components/leads/LeadAttachmentsGallery';
import type { QualificationDecision } from '@/backend/lead/domain/lead';

const DECISION_META: Record<QualificationDecision, { label: string; className: string; Icon: any }> = {
    qualified: {
        label: 'Cualificado',
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300',
        Icon: CheckCircle2,
    },
    review_required: {
        label: 'Requiere revisión',
        className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300',
        Icon: AlertTriangle,
    },
    rejected: {
        label: 'Rechazado por reglas',
        className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300',
        Icon: XCircle,
    },
};

const PROJECT_TYPE_LABEL: Record<string, string> = {
    bathroom: 'Baño',
    kitchen: 'Cocina',
    integral: 'Reforma integral',
    new_build: 'Obra nueva',
    pool: 'Piscina',
    other: 'Otro',
};

const SOURCE_LABEL: Record<string, string> = {
    chat_public: 'Chat público',
    wizard: 'Wizard de presupuesto',
    quick_form: 'Formulario rápido',
    detailed_form: 'Formulario detallado',
    new_build_form: 'Formulario obra nueva',
    demo: 'Demo',
};

const TIMELINE_LABEL: Record<string, string> = {
    asap: 'Lo antes posible',
    '1-3m': 'En 1–3 meses',
    '3-6m': 'En 3–6 meses',
    '6m+': 'Más de 6 meses',
};

const QUALITY_LABEL: Record<string, string> = {
    basic: 'Básica',
    medium: 'Media',
    premium: 'Premium',
};

const PROPERTY_TYPE_LABEL: Record<string, string> = {
    residential: 'Vivienda',
    commercial: 'Local comercial',
    office: 'Oficina',
};

const PROJECT_SCOPE_LABEL: Record<string, string> = {
    integral: 'Reforma integral',
    partial: 'Reforma parcial',
};

const PARTIAL_SCOPE_LABEL: Record<string, string> = {
    bathroom: 'Baños',
    kitchen: 'Cocina',
    demolition: 'Demoliciones',
    ceilings: 'Techos',
    electricity: 'Electricidad',
    carpentry: 'Carpintería',
    workArea: 'Zona de trabajo',
    painting: 'Pintura',
};

const FLOOR_TYPE_LABEL: Record<string, string> = {
    parquet: 'Parquet / laminado',
    tile: 'Cerámico / gres',
    microcement: 'Microcemento',
    other: 'Otro',
};

const HVAC_TYPE_LABEL: Record<string, string> = {
    split: 'Split de pared',
    ducts: 'Conductos',
};

const DOOR_MATERIAL_LABEL: Record<string, string> = {
    lacquered: 'Lacadas blancas',
    wood: 'Madera / roble',
};

const PAINT_TYPE_LABEL: Record<string, string> = {
    white: 'Blanco',
    color: 'Color',
};

const WALL_THICKNESS_LABEL: Record<string, string> = {
    thin: 'Tabique fino (<10cm)',
    thick: 'Muro grueso (>10cm)',
};

const ELEC_SCOPE_LABEL: Record<string, string> = {
    total: 'Renovación total (cuadro + cableado)',
    partial: 'Sólo mecanismos',
};

const PLUMBING_SCOPE_LABEL: Record<string, string> = {
    total: 'Total',
    partial: 'Parcial',
};

/** Etiquetas en español de los campos del rawFormData. Cae a humanizeKey si no está en el mapa. */
const RAW_FIELD_LABELS_ES: Record<string, string> = {
    propertyType: 'Tipo de inmueble',
    projectScope: 'Alcance',
    partialScope: 'Zonas a reformar',
    totalAreaM2: 'Superficie total',
    targetBudget: 'Presupuesto objetivo',
    urgency: 'Urgencia',
    numberOfRooms: 'Número de habitaciones',
    numberOfBathrooms: 'Número de baños',
    workstations: 'Puestos de trabajo',
    meetingRooms: 'Salas de reuniones',
    demolishPartitions: 'Demoler tabiques',
    demolishPartitionsM2: 'M² de tabique a demoler',
    wallThickness: 'Grosor del muro',
    demolishFloorsM2: 'M² de suelo a levantar',
    demolishWallTilesM2: 'M² de alicatado a picar',
    removeDoors: 'Retirar puertas',
    removeDoorsAmount: 'Cantidad de puertas',
    hasElevator: 'Hay ascensor',
    furnitureRemoval: 'Retirar mobiliario',
    bathrooms: 'Baños',
    kitchen: 'Cocina',
    installFalseCeiling: 'Instalar falso techo',
    falseCeilingM2: 'M² de falso techo',
    soundproofRoom: 'Insonorizar estancia',
    soundproofRoomM2: 'M² a insonorizar',
    elecScope: 'Alcance instalación eléctrica',
    plumbingScope: 'Alcance fontanería',
    renovateElectricalPanel: 'Renovar cuadro eléctrico',
    electricalKitchen: 'Cocina (eléctrico)',
    electricalLivingRoom: 'Salón (eléctrico)',
    electricalBedrooms: 'Habitaciones (eléctrico)',
    installAirConditioning: 'Instalar aire acondicionado',
    hvacCount: 'Unidades de climatización',
    hvacType: 'Tipo de climatización',
    floorType: 'Tipo de suelo',
    skirtingBoardLinearMeters: 'Rodapié (m lineales)',
    renovateInteriorDoors: 'Renovar puertas interiores',
    interiorDoorsAmount: 'Puertas interiores',
    doorsMaterial: 'Material de puertas',
    installSlidingDoor: 'Instalar puerta corredera',
    slidingDoorAmount: 'Cantidad de correderas',
    renovateExteriorCarpentry: 'Renovar carpintería exterior',
    externalWindowsCount: 'Ventanas exteriores',
    paintWalls: 'Pintar paredes',
    paintWallsM2: 'M² de paredes',
    paintCeilings: 'Pintar techos',
    paintCeilingsM2: 'M² de techos',
    paintType: 'Tipo de pintura',
    removeGotele: 'Quitar gotelé',
    removeGoteleM2: 'M² de gotelé',
    renovationType: 'Tipo de reforma',
    squareMeters: 'Metros cuadrados',
    quality: 'Calidad',
    plotArea: 'Superficie de la parcela',
    buildingArea: 'Superficie a construir',
    floors: 'Plantas',
    garage: 'Garaje',
    pool: 'Piscina',
    additionalDetails: 'Detalles adicionales',
};

const BUDGET_STATUS_META: Record<string, { label: string; className: string }> = {
    draft: {
        label: 'Borrador',
        className: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-300',
    },
    pending_review: {
        label: 'Pre-presupuesto',
        className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300',
    },
    approved: {
        label: 'Aprobado',
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300',
    },
    sent: {
        label: 'Enviado al cliente',
        className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300',
    },
};

const DEAL_STAGE_META: Record<string, { label: string; className: string }> = {
    NEW_LEAD: { label: 'Nuevo', className: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300' },
    PUBLIC_DEMO_COMPLETED: { label: 'Jugó Demo', className: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300' },
    SALES_VIDEO_WATCHED: { label: 'Vio VSL', className: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-300' },
    SALES_CALL_SCHEDULED: { label: 'Reunión', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300' },
    PROPOSAL_SENT: { label: 'Propuesta', className: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300' },
    CLOSED_WON: { label: 'Ganado', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300' },
    CLOSED_LOST: { label: 'Perdido', className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300' },
};

const PROJECT_TYPE_LABEL_DEAL: Record<string, string> = {
    bathroom: 'Baño',
    kitchen: 'Cocina',
    integral: 'Integral',
    new_build: 'Obra nueva',
    pool: 'Piscina',
    other: 'Otro',
};

interface PageProps {
    params: Promise<{ locale: string; id: string }>;
    searchParams: Promise<{ dealId?: string }>;
}

export default async function AdminLeadDetailPage({ params, searchParams }: PageProps) {
    const { id } = await params;
    const { dealId: rawDealId } = await searchParams;

    const [detailResult, conversationResult] = await Promise.all([
        getAdminLeadDetailAction(id),
        getLeadConversationAction(id),
    ]);

    if (!detailResult.success || !detailResult.lead) {
        if (detailResult.error === 'Lead no encontrado') notFound();
        return (
            <div className="p-8 text-center">
                <p className="text-rose-600">{detailResult.error}</p>
            </div>
        );
    }

    const lead = detailResult.lead;
    const conversation = conversationResult.success ? conversationResult.conversation : null;
    const decision = lead.qualification?.decision || 'review_required';
    const decisionMeta = DECISION_META[decision];

    // Resolución del deal seleccionado vía ?dealId=. Si el id no existe entre
    // los deals del lead, ignoramos el query y volvemos al modo "lead actual".
    const selectedDeal = rawDealId
        ? lead.associatedDeals.find(d => d.id === rawDealId)
        : undefined;
    const dealId = selectedDeal?.id;

    // Cuando hay un deal seleccionado, mostramos su intakeSnapshot. Sin deal
    // seleccionado, mostramos el último intake del lead (comportamiento previo).
    const effectiveIntake = selectedDeal?.intakeSnapshot
        ? {
              projectType: selectedDeal.intakeSnapshot.projectType ?? lead.intake?.projectType,
              source: selectedDeal.intakeSnapshot.source ?? lead.intake?.source,
              description: selectedDeal.intakeSnapshot.description ?? lead.intake?.description ?? '',
              approxSquareMeters: selectedDeal.intakeSnapshot.approxSquareMeters,
              postalCode: selectedDeal.intakeSnapshot.postalCode,
              city: selectedDeal.intakeSnapshot.city,
              approxBudget: selectedDeal.intakeSnapshot.approxBudget,
              timeline: selectedDeal.intakeSnapshot.timeline,
              qualityLevel: selectedDeal.intakeSnapshot.qualityLevel,
              imageUrls: selectedDeal.intakeSnapshot.imageUrls || [],
              suspicious: !!selectedDeal.intakeSnapshot.suspicious,
              submittedAt: selectedDeal.intakeSnapshot.submittedAt || lead.intake?.submittedAt,
              rawFormData: selectedDeal.intakeSnapshot.rawFormData,
          }
        : lead.intake;

    const baseHref = `/dashboard/leads/${id}`;

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <Link
                    href="/dashboard/leads?tab=inbox"
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Volver al inbox
                </Link>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground font-mono">{lead.id}</span>
                    <DeleteLeadButton leadId={lead.id} />
                </div>
            </div>

            <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div className="space-y-2">
                    <h1 className="font-headline text-3xl">{lead.personalInfo.name}</h1>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <Mail className="h-4 w-4" /> {lead.personalInfo.email}
                        </span>
                        {lead.personalInfo.phone && (
                            <span className="inline-flex items-center gap-1">
                                <Phone className="h-4 w-4" /> {lead.personalInfo.phone}
                            </span>
                        )}
                        {lead.personalInfo.address && (
                            <span className="inline-flex items-center gap-1">
                                <MapPin className="h-4 w-4" /> {lead.personalInfo.address}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Recibido {format(new Date(lead.createdAt), "d 'de' MMMM 'a las' HH:mm", { locale: es })}
                        {' · '}
                        {effectiveIntake?.source ? SOURCE_LABEL[effectiveIntake.source] : 'Sin origen'}
                        {lead.preferences?.language && (
                            <>
                                {' · '}
                                <span className="inline-flex items-center gap-1">
                                    Idioma <code className="px-1 py-0.5 rounded bg-muted text-foreground text-[10px]">{lead.preferences.language}</code>
                                </span>
                            </>
                        )}
                    </p>
                </div>
                <RefineBudgetButton leadId={lead.id} decision={decision} dealId={dealId} />
            </header>

            {selectedDeal && (
                <div className="rounded-md border border-sky-200 bg-sky-50/70 dark:bg-sky-500/10 dark:border-sky-500/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-sm text-sky-900 dark:text-sky-100">
                        <Eye className="h-4 w-4" />
                        Estás viendo la solicitud de la oportunidad
                        <span className="font-mono text-xs">{selectedDeal.id.substring(0, 8)}</span>
                    </div>
                    <Link
                        href={baseHref}
                        className="text-xs font-medium text-sky-700 dark:text-sky-200 hover:underline"
                    >
                        Volver al intake del lead
                    </Link>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Cualificación */}
                <Card className="lg:col-span-1">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                            Cualificación
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {lead.qualification ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge className={decisionMeta.className}>
                                        <decisionMeta.Icon className="h-3 w-3 mr-1" />
                                        {decisionMeta.label}
                                    </Badge>
                                    {lead.qualification.lowTrust && (
                                        <Badge
                                            className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300"
                                            title={(lead.qualification.lowTrustReasons || []).join(' · ')}
                                        >
                                            Baja confianza
                                        </Badge>
                                    )}
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Score</p>
                                    <p className="text-3xl font-mono">{lead.qualification.score}<span className="text-sm text-muted-foreground">/100</span></p>
                                </div>
                                {lead.qualification.lowTrust && (lead.qualification.lowTrustReasons || []).length > 0 && (
                                    <div className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200">
                                        <p className="font-semibold mb-0.5">Señales de baja confianza:</p>
                                        <ul className="list-disc list-inside space-y-0.5">
                                            {lead.qualification.lowTrustReasons!.map((r, i) => (
                                                <li key={i}>{r}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {lead.qualification.reasons.length > 0 && (
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-1">Razones</p>
                                        <ul className="text-xs space-y-1 list-disc list-inside">
                                            {lead.qualification.reasons.map((r, i) => (
                                                <li key={i}>{r}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div>
                                    <p className="text-xs text-muted-foreground mb-1">Reglas evaluadas</p>
                                    <div className="flex flex-wrap gap-1">
                                        {lead.qualification.rules.map(r => (
                                            <Badge key={r} variant="outline" className="font-mono text-[10px]">
                                                {r}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Evaluado por {lead.qualification.evaluatedBy}{' · '}
                                    {format(new Date(lead.qualification.evaluatedAt), 'dd MMM HH:mm', { locale: es })}
                                </p>
                                {(lead.qualification.scoreHistory || []).length > 0 && (
                                    <div className="border-t pt-3">
                                        <p className="text-xs text-muted-foreground mb-2">Historial de score</p>
                                        <ul className="space-y-1.5">
                                            {lead.qualification.scoreHistory!.map((h, i) => (
                                                <li key={i} className="flex items-start gap-2 text-xs">
                                                    <Badge
                                                        variant="outline"
                                                        className={`shrink-0 font-mono text-[10px] ${
                                                            h.delta > 0
                                                                ? 'text-emerald-600 border-emerald-200 dark:text-emerald-300'
                                                                : 'text-rose-600 border-rose-200 dark:text-rose-300'
                                                        }`}
                                                    >
                                                        {h.delta > 0 ? '+' : ''}{h.delta}
                                                    </Badge>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="leading-tight">{h.reason}</p>
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {format(new Date(h.timestamp), 'dd MMM HH:mm', { locale: es })}
                                                            {' · score → '}
                                                            <span className="font-mono">{h.score}</span>
                                                        </p>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">No cualificado todavía.</p>
                        )}
                    </CardContent>
                </Card>

                {/* Intake (del deal seleccionado o del lead) */}
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                            Solicitud {selectedDeal && <span className="text-[11px] font-normal normal-case">— oportunidad seleccionada</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {effectiveIntake ? (
                            <>
                                {effectiveIntake.suspicious && (
                                    <div className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-500/10 p-3 text-sm flex gap-2">
                                        <ShieldAlert className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                                        <span className="text-indigo-800 dark:text-indigo-200">
                                            El sanitizer detectó patrones de prompt injection en este lead.
                                            Revisa la descripción antes de aprobar nada.
                                        </span>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                    {effectiveIntake.projectType && (
                                        <Field
                                            label="Tipo"
                                            value={PROJECT_TYPE_LABEL[effectiveIntake.projectType] || effectiveIntake.projectType}
                                        />
                                    )}
                                    {effectiveIntake.approxSquareMeters && (
                                        <Field label="Superficie" value={`${effectiveIntake.approxSquareMeters} m²`} />
                                    )}
                                    {effectiveIntake.qualityLevel && (
                                        <Field
                                            label="Calidad"
                                            value={QUALITY_LABEL[effectiveIntake.qualityLevel] || effectiveIntake.qualityLevel}
                                        />
                                    )}
                                    {effectiveIntake.postalCode && (
                                        <Field label="Código postal" value={effectiveIntake.postalCode} />
                                    )}
                                    {effectiveIntake.city && <Field label="Ciudad" value={effectiveIntake.city} />}
                                    {effectiveIntake.timeline && (
                                        <Field
                                            label="Plazo"
                                            value={TIMELINE_LABEL[effectiveIntake.timeline] || effectiveIntake.timeline}
                                        />
                                    )}
                                    {effectiveIntake.approxBudget && (
                                        <Field
                                            label="Presupuesto cliente"
                                            value={`${effectiveIntake.approxBudget.toLocaleString('es-ES')} €`}
                                        />
                                    )}
                                </div>
                                <Separator />
                                <div>
                                    <p className="text-xs text-muted-foreground mb-1">Descripción del cliente</p>
                                    <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-wrap">
                                        {effectiveIntake.description || '—'}
                                    </blockquote>
                                </div>
                                {(effectiveIntake.imageUrls || []).length > 0 && (
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-2">
                                            Archivos adjuntos ({effectiveIntake.imageUrls!.length})
                                        </p>
                                        <LeadAttachmentsGallery urls={effectiveIntake.imageUrls!} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">Este lead no tiene intake.</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Datos crudos del formulario (si vino por form) */}
            {effectiveIntake?.rawFormData && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                            <Database className="h-4 w-4" />
                            Datos del formulario tal como los rellenó el cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <IntakeRawFormDetails data={effectiveIntake.rawFormData} />
                    </CardContent>
                </Card>
            )}

            {/* Conversación del chat público (si vino por chat) */}
            {conversation && conversation.messages.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" />
                            Conversación con el agente ({conversation.messages.length} mensajes)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {conversation.messages.map(msg => (
                                <ConversationMessage key={msg.id} msg={msg} />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Aviso si esperamos conversación pero no llegó (chat aún no cableado) */}
            {!conversation && lead.intake?.source === 'chat_public' && (
                <Card>
                    <CardContent className="pt-6 text-sm text-muted-foreground">
                        Este lead viene del chat público pero no se ha persistido la conversación.
                        Comprueba que el frontend esté enviando <code>chatSessionId</code> a <code>processPublicChatAction</code>.
                    </CardContent>
                </Card>
            )}

            {/* Oportunidades (deals) — un mismo lead puede tener múltiples obras distintas */}
            {lead.associatedDeals.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                            Oportunidades / Obras ({lead.associatedDeals.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {lead.associatedDeals.map((d, idx) => {
                                const stageMeta = DEAL_STAGE_META[d.stage] || DEAL_STAGE_META.NEW_LEAD;
                                const intake = d.intakeSnapshot;
                                const isLatest = idx === 0;
                                const isSelected = selectedDeal?.id === d.id;
                                const href = isSelected ? baseHref : `${baseHref}?dealId=${d.id}`;
                                return (
                                    <Link
                                        href={href}
                                        key={d.id}
                                        className={`block rounded-md border p-3 transition-colors ${
                                            isSelected
                                                ? 'border-sky-300 bg-sky-50/50 dark:bg-sky-500/5 dark:border-sky-500/40 ring-1 ring-sky-200 dark:ring-sky-500/30'
                                                : 'hover:bg-muted/50'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge className={stageMeta.className}>{stageMeta.label}</Badge>
                                                {isLatest && (
                                                    <Badge variant="outline" className="text-[10px]">Más reciente</Badge>
                                                )}
                                                {isSelected && (
                                                    <Badge className="bg-sky-600 text-white text-[10px]">Viendo</Badge>
                                                )}
                                                <span className="text-xs font-mono text-muted-foreground">
                                                    {d.id.substring(0, 8)}
                                                </span>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(d.createdAt), "d MMM HH:mm", { locale: es })}
                                            </span>
                                        </div>
                                        {intake && (
                                            <div className="space-y-1 text-xs">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {intake.projectType && (
                                                        <Badge variant="outline" className="text-[10px] font-normal">
                                                            {PROJECT_TYPE_LABEL_DEAL[intake.projectType] || intake.projectType}
                                                        </Badge>
                                                    )}
                                                    {intake.approxSquareMeters && (
                                                        <span className="text-muted-foreground">{intake.approxSquareMeters} m²</span>
                                                    )}
                                                    {intake.qualityLevel && (
                                                        <span className="text-muted-foreground">
                                                            calidad {QUALITY_LABEL[intake.qualityLevel] || intake.qualityLevel}
                                                        </span>
                                                    )}
                                                    {(intake.postalCode || intake.city) && (
                                                        <span className="text-muted-foreground">
                                                            {[intake.postalCode, intake.city].filter(Boolean).join(' · ')}
                                                        </span>
                                                    )}
                                                </div>
                                                {intake.description && (
                                                    <p className="text-muted-foreground line-clamp-2">
                                                        {intake.description}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Presupuestos asociados */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                        Presupuestos asociados ({lead.associatedBudgets.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {lead.associatedBudgets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Aún no se ha generado ningún presupuesto. Pulsa "Refinar y generar pre-presupuesto" arriba para iniciar el motor IA.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {lead.associatedBudgets.map(b => {
                                const meta = BUDGET_STATUS_META[b.status] || BUDGET_STATUS_META.draft;
                                return (
                                    <Link
                                        key={b.id}
                                        href={`/dashboard/admin/budgets/${b.id}/edit`}
                                        className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Badge className={meta.className}>{meta.label}</Badge>
                                            <span className="text-sm font-mono text-muted-foreground">
                                                {b.id.substring(0, 8)}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(b.createdAt), 'dd MMM HH:mm', { locale: es })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium">
                                                {b.total > 0
                                                    ? `${b.total.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
                                                    : '—'}
                                            </span>
                                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-medium">{value}</p>
        </div>
    );
}

function humanizeKey(key: string): string {
    if (RAW_FIELD_LABELS_ES[key]) return RAW_FIELD_LABELS_ES[key];
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^./, c => c.toUpperCase())
        .trim();
}

function formatScalar(key: string, value: any): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    // Diccionarios de valores enum por clave conocida
    if (typeof value === 'string') {
        if (key === 'propertyType' && PROPERTY_TYPE_LABEL[value]) return PROPERTY_TYPE_LABEL[value];
        if (key === 'projectScope' && PROJECT_SCOPE_LABEL[value]) return PROJECT_SCOPE_LABEL[value];
        if ((key === 'quality' || key === 'qualityLevel') && QUALITY_LABEL[value]) return QUALITY_LABEL[value];
        if (key === 'floorType' && FLOOR_TYPE_LABEL[value]) return FLOOR_TYPE_LABEL[value];
        if (key === 'hvacType' && HVAC_TYPE_LABEL[value]) return HVAC_TYPE_LABEL[value];
        if (key === 'doorsMaterial' && DOOR_MATERIAL_LABEL[value]) return DOOR_MATERIAL_LABEL[value];
        if (key === 'paintType' && PAINT_TYPE_LABEL[value]) return PAINT_TYPE_LABEL[value];
        if (key === 'wallThickness' && WALL_THICKNESS_LABEL[value]) return WALL_THICKNESS_LABEL[value];
        if (key === 'elecScope' && ELEC_SCOPE_LABEL[value]) return ELEC_SCOPE_LABEL[value];
        if (key === 'plumbingScope' && PLUMBING_SCOPE_LABEL[value]) return PLUMBING_SCOPE_LABEL[value];
        if (key === 'urgency' && TIMELINE_LABEL[value]) return TIMELINE_LABEL[value];
        if (key === 'renovationType' && PROJECT_TYPE_LABEL[value === 'bathrooms' ? 'bathroom' : value]) {
            return PROJECT_TYPE_LABEL[value === 'bathrooms' ? 'bathroom' : value];
        }
    }
    if (typeof value === 'number') {
        // Heurística: m² o m lineales muestran sufijo si la key contiene "M2" o "linear"
        if (/M2$/i.test(key)) return `${value} m²`;
        if (/linearMeters$/i.test(key)) return `${value} m`;
        if (key === 'totalAreaM2' || key === 'plotArea' || key === 'buildingArea' || key === 'squareMeters') {
            return `${value} m²`;
        }
        return String(value);
    }
    return String(value);
}

/** Campos del rawFormData que no merecen renderizarse (ya están arriba o son ruido). */
const HIDDEN_KEYS = new Set([
    'name',
    'email',
    'phone',
    'address',
    'description',
    'files',
    'visualizations',
    'testEmail',
]);

const SCOPE_VALUE_MAP: Record<string, string> = {
    bathroom: 'Baños',
    bathrooms: 'Baños',
    kitchen: 'Cocina',
    integral: 'Integral',
    pool: 'Piscina',
    new_build: 'Obra nueva',
};

/**
 * Render principal de los datos crudos del formulario público. Cada sección
 * conocida (baños, cocina, eléctrico…) tiene su propio renderer humanizado
 * para evitar dump JSON crudo. Los campos no reconocidos caen al fallback.
 */
function IntakeRawFormDetails({ data }: { data: Record<string, any> }) {
    const filtered = Object.fromEntries(
        Object.entries(data).filter(([k, v]) => {
            if (HIDDEN_KEYS.has(k)) return false;
            if (v === null || v === undefined || v === '') return false;
            if (Array.isArray(v) && v.length === 0) return false;
            if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
            return true;
        })
    );
    if (Object.keys(filtered).length === 0) {
        return <p className="text-sm text-muted-foreground">No hay datos adicionales del formulario.</p>;
    }

    // Campos especiales que usan renderer dedicado.
    const SPECIAL_KEYS = new Set([
        'bathrooms',
        'kitchen',
        'electricalKitchen',
        'electricalLivingRoom',
        'electricalBedrooms',
        'partialScope',
    ]);

    const scalarEntries = Object.entries(filtered).filter(([k]) => !SPECIAL_KEYS.has(k));

    return (
        <div className="space-y-6">
            {/* Tabla de campos escalares */}
            {scalarEntries.length > 0 && (
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {scalarEntries.map(([key, value]) => {
                        const isComplex = typeof value === 'object' && value !== null;
                        return (
                            <div
                                key={key}
                                className="flex justify-between items-start gap-3 py-1.5 border-b border-border/50 last:border-0"
                            >
                                <dt className="text-muted-foreground shrink-0">{humanizeKey(key)}</dt>
                                <dd className="text-right font-medium">
                                    {isComplex ? (
                                        <pre className="whitespace-pre-wrap text-left bg-muted px-2 py-1 rounded text-[10px] font-mono">
                                            {JSON.stringify(value, null, 2)}
                                        </pre>
                                    ) : (
                                        formatScalar(key, value)
                                    )}
                                </dd>
                            </div>
                        );
                    })}
                </dl>
            )}

            {/* Zonas a reformar (chips) */}
            {Array.isArray(filtered.partialScope) && filtered.partialScope.length > 0 && (
                <SectionWrapper title="Zonas a reformar">
                    <div className="flex flex-wrap gap-1.5">
                        {filtered.partialScope.map((s: string, i: number) => (
                            <Badge key={i} variant="outline" className="font-normal">
                                {PARTIAL_SCOPE_LABEL[s] || SCOPE_VALUE_MAP[s] || s}
                            </Badge>
                        ))}
                    </div>
                </SectionWrapper>
            )}

            {/* Baños (tabla) */}
            {Array.isArray(filtered.bathrooms) && filtered.bathrooms.length > 0 && (
                <SectionWrapper title={`Baños (${filtered.bathrooms.length})`}>
                    <BathroomsTable bathrooms={filtered.bathrooms} />
                </SectionWrapper>
            )}

            {/* Cocina */}
            {filtered.kitchen && typeof filtered.kitchen === 'object' && (
                <SectionWrapper title="Cocina">
                    <KitchenBlock kitchen={filtered.kitchen} />
                </SectionWrapper>
            )}

            {/* Cocina (eléctrico) y Salón (eléctrico) */}
            {(filtered.electricalKitchen || filtered.electricalLivingRoom) && (
                <SectionWrapper title="Instalación eléctrica · estancias">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {filtered.electricalKitchen && (
                            <ElectricalBlock title="Cocina" data={filtered.electricalKitchen} />
                        )}
                        {filtered.electricalLivingRoom && (
                            <ElectricalBlock title="Salón" data={filtered.electricalLivingRoom} />
                        )}
                    </div>
                </SectionWrapper>
            )}

            {/* Habitaciones (eléctrico) */}
            {Array.isArray(filtered.electricalBedrooms) && filtered.electricalBedrooms.length > 0 && (
                <SectionWrapper title={`Habitaciones · eléctrico (${filtered.electricalBedrooms.length})`}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {filtered.electricalBedrooms.map((b: any, i: number) => (
                            <ElectricalBlock key={i} title={`Habitación ${i + 1}`} data={b} />
                        ))}
                    </div>
                </SectionWrapper>
            )}
        </div>
    );
}

function SectionWrapper({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {title}
            </p>
            {children}
        </div>
    );
}

function BathroomsTable({ bathrooms }: { bathrooms: any[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-muted-foreground border-b border-border/60">
                        <th className="text-left font-medium py-1.5 pr-2">#</th>
                        <th className="text-left font-medium py-1.5 pr-2">Calidad</th>
                        <th className="text-right font-medium py-1.5 pr-2">Alicatado</th>
                        <th className="text-right font-medium py-1.5 pr-2">Suelo</th>
                        <th className="text-center font-medium py-1.5 pr-2">Plato</th>
                        <th className="text-center font-medium py-1.5 pr-2">Mampara</th>
                        <th className="text-center font-medium py-1.5">Fontanería</th>
                    </tr>
                </thead>
                <tbody>
                    {bathrooms.map((b, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                            <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-1.5 pr-2">{QUALITY_LABEL[b.quality] || b.quality || '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono">{b.wallTilesM2 ? `${b.wallTilesM2} m²` : '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono">{b.floorM2 ? `${b.floorM2} m²` : '—'}</td>
                            <td className="py-1.5 pr-2 text-center">{b.installShowerTray ? '✓' : '—'}</td>
                            <td className="py-1.5 pr-2 text-center">{b.installShowerScreen ? '✓' : '—'}</td>
                            <td className="py-1.5 text-center">{b.plumbing ? '✓' : '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function KitchenBlock({ kitchen }: { kitchen: any }) {
    const items: { label: string; value: string }[] = [];
    items.push({ label: 'Renovar', value: kitchen.renovate ? 'Sí' : 'No' });
    if (kitchen.quality) items.push({ label: 'Calidad', value: QUALITY_LABEL[kitchen.quality] || kitchen.quality });
    if (kitchen.demolition !== undefined) items.push({ label: 'Demolición previa', value: kitchen.demolition ? 'Sí' : 'No' });
    if (kitchen.plumbing !== undefined) items.push({ label: 'Fontanería', value: kitchen.plumbing ? 'Sí' : 'No' });
    if (kitchen.wallTilesM2) items.push({ label: 'Alicatado', value: `${kitchen.wallTilesM2} m²` });
    if (kitchen.floorM2) items.push({ label: 'Suelo', value: `${kitchen.floorM2} m²` });
    return (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {items.map((it, i) => (
                <div key={i}>
                    <dt className="text-muted-foreground">{it.label}</dt>
                    <dd className="font-medium">{it.value}</dd>
                </div>
            ))}
        </dl>
    );
}

function ElectricalBlock({ title, data }: { title: string; data: any }) {
    const parts: string[] = [];
    if (typeof data.sockets === 'number') parts.push(`${data.sockets} enchufes`);
    if (typeof data.lights === 'number') parts.push(`${data.lights} ${data.lights === 1 ? 'punto de luz' : 'puntos de luz'}`);
    if (data.tv) parts.push('TV');
    return (
        <div className="rounded-md border border-border/40 bg-background px-3 py-2 text-xs">
            <p className="font-medium mb-0.5">{title}</p>
            <p className="text-muted-foreground">{parts.length > 0 ? parts.join(' · ') : '—'}</p>
        </div>
    );
}

function ConversationMessage({
    msg,
}: {
    msg: {
        id: string;
        senderType: string;
        senderName?: string;
        content: string;
        createdAt: string;
        attachments: { type: string; url: string; name?: string }[];
    };
}) {
    const isLead = msg.senderType === 'lead';
    const Icon = isLead ? UserIcon : Bot;

    return (
        <div className={`flex gap-3 ${isLead ? 'flex-row' : 'flex-row-reverse'}`}>
            <div className="flex-shrink-0">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                    isLead ? 'bg-muted' : 'bg-emerald-100 dark:bg-emerald-500/20'
                }`}>
                    <Icon className={`h-4 w-4 ${isLead ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300'}`} />
                </div>
            </div>
            <div className={`flex-1 max-w-[80%] ${isLead ? '' : 'text-right'}`}>
                <div className={`inline-block px-4 py-2 rounded-2xl text-sm ${
                    isLead
                        ? 'bg-muted text-foreground rounded-bl-sm'
                        : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 rounded-br-sm'
                }`}>
                    <p className="whitespace-pre-wrap text-left">{msg.content}</p>
                    {msg.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {msg.attachments.map((a, i) => (
                                <a
                                    key={i}
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-background/50 hover:bg-background border border-border"
                                >
                                    <ImageIcon className="h-3 w-3" />
                                    {a.name || `Adjunto ${i + 1}`}
                                </a>
                            ))}
                        </div>
                    )}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                    {format(new Date(msg.createdAt), "HH:mm:ss · dd MMM", { locale: es })}
                </div>
            </div>
        </div>
    );
}
