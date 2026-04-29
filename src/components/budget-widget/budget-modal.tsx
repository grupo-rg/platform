'use client';

import { useWidgetContext } from '@/context/budget-widget-context';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
    DrawerFooter,
    DrawerClose
} from "@/components/ui/drawer";
import { Button } from '@/components/ui/button';
import { NewBuildForm } from '@/components/budget-request/new-build-form';
import { QuickBudgetForm } from '@/components/budget-request/quick-budget-form';
import { Home, Hammer, Palmtree, Sparkles, Zap, CheckCircle2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BudgetRequestWizard } from '@/components/budget-request-wizard';
import { services } from '@/lib/services';
import { SmartTriggerContainer } from '@/components/smart-trigger/smart-trigger-container';
import { BudgetWizardChat } from '@/components/budget/wizard/BudgetWizardChat';
import { PublicCommercialChat } from '@/components/chat/PublicCommercialChat';

// Temporary mock for t translations
const mockT = {
    budgetRequest: {
        form: {
            name: { label: "Nombre", placeholder: "Tu nombre" },
            email: { label: "Email", placeholder: "tu@email.com" },
            phone: { label: "Teléfono", placeholder: "600..." },
            address: { label: "Dirección", placeholder: "Calle..." },
            contact: {
                banner: {
                    title: "Información de Contacto",
                    description: "Para enviarte la estimación personalizada."
                }
            },
            projectDefinition: {
                propertyType: {
                    label: "Tipo de Propiedad",
                    residential: "Residencial",
                    commercial: "Comercial",
                    office: "Oficina"
                },
                projectScope: {
                    label: "Alcance del Proyecto",
                    integral: "Reforma Integral",
                    integralDesc: "Renovación completa de la propiedad",
                    partial: "Reforma Parcial",
                    partialDesc: "Solo algunas estancias o zonas"
                },
                partialScope: {
                    label: "Zonas a Reformar",
                    description: "Selecciona todas las que apliquen",
                    options: {
                        bathroom: "Baños",
                        kitchen: "Cocina",
                        demolition: "Demoliciones",
                        ceilings: "Techos",
                        electricity: "Electricidad",
                        carpentry: "Carpintería"
                    }
                },
                totalAreaM2: { label: "Superficie Aprox. (m²)" },
                numberOfRooms: { label: "Habitaciones" },
                numberOfBathrooms: { label: "Baños" }
            },
            quality: { label: "Calidad", placeholder: "Selecciona...", options: { basic: "Básica", medium: "Media", premium: "Premium" } },
            buttons: { submit: "Calcular", loading: "Calculando...", prev: "Atrás", next: "Siguiente" },
            toast: { success: { title: "Enviado", description: "Recibido" }, error: { title: "Error", description: "Fallo" } }
        },
        steps: {
            contact: "Contacto",
            projectDefinition: "Proyecto",
            renovationDetails: "Detalles",
            stylePreferences: "Estilo",
            review: "Revisión",
            demolition: "Demolición",
            bathroom: "Baños",
            kitchen: "Cocina",
            workArea: "Zona Trabajo",
            ceilings: "Techos",
            electricity: "Electricidad",
            carpentry: "Carpintería",
            multimedia: "Multimedia",
            summary: "Resumen"
        },
        // Wizard Steps Specific Translations
        demolition: {
            elevator: "¿Hay ascensor?",
            furniture: "¿Retirar muebles?",
            demolishPartitions: { label: "Demoler Tabiques" },
            demolishPartitionsM2: { label: "M² a demoler" },
            thickWall: { label: "Grosor Muro", thin: "Fino (< 10cm)", thick: "Grueso (> 10cm)" },
            removeDoors: { label: "Quitar Puertas" },
            removeDoorsAmount: { label: "Cantidad puertas" },
            floors: "Levantar Suelos (m²)",
            wallTiles: "Picado Alicatados (m²)"
        },
        bathroom: {
            title: "Baño",
            remove: "Eliminar Baño",
            add: "Añadir Baño",
            quality: { label: "Calidad Acabados" },
            dimensions: "Dimensiones y Elementos",
            wallTiles: "Alicatado Pared (m²)",
            floor: "Suelo (m²)",
            showerTray: "Plato de Ducha",
            showerScreen: "Mampara",
            plumbing: "Fontanería Completa"
        },
        kitchen: {
            title: "Cocina",
            renovate: "¿Renovar Cocina?",
            quality: { label: "Calidad" },
            demolition: "Demolición previa",
            plumbing: "Fontanería",
            dimensions: "Dimensiones (m²)",
            wallTiles: "Alicatado Pared",
            floor: "Suelo"
        },
        workArea: {
            title: "Zona de Trabajo (Oficina)",
            workstations: "Puestos de trabajo",
            meetingRooms: "Salas de reuniones"
        },
        ceilings: {
            falseCeiling: "Falso Techo",
            falseCeilingM2: "M² Falso Techo",
            soundproof: "Insonorización",
            soundproofM2: "M² a insonorizar"
        },
        electricity: {
            title: "Instalación Eléctrica",
            newPanel: "Cuadro Eléctrico Nuevo",
            rooms: "Habitaciones / Estancias",
            sockets: "Enchufes",
            points: "Puntos de luz",
            climate: "Climatización",
            ac: "Instalar Aire Acondicionado",
            hvacCount: "Unidades",
            hvacType: { label: "Tipo", split: "Split Pared", ducts: "Conductos" },
            livingRoom: "Salón",
            kitchen: "Cocina"
        },
        carpentry: {
            flooring: "Suelos",
            floorType: { label: "Tipo de Suelo", parquet: "Parquet / Laminado", tile: "Cerámico / Gres", microcement: "Microcemento" },
            skirting: "Rodapié (m lineales)",
            interiorDoors: "Puertas de Paso",
            changeDoors: "Cambiar Puertas",
            doorCount: "Cantidad",
            doorMaterial: { label: "Material", lacquered: "Lacadas Blancas", wood: "Madera/Roble" },
            sliding: "Puerta Corredera",
            slidingCount: "Cantidad",
            windows: "Ventanas",
            changeWindows: "Cambiar Ventanas",
            windowCount: "Cantidad",
            painting: "Pintura",
            paintWalls: "Pintar Paredes",
            paintWallsM2: "M² Paredes",
            paintCeilings: "Pintar Techos",
            paintCeilingsM2: "M² Techos",
            removeGotele: "Quitar Gotelé",
            removeGoteleM2: "M² Gotelé",
            paintType: { label: "Tipo Pintura", white: "Blanco", color: "Color" }
        },
        multimedia: {
            title: "Archivos y Planos",
            description: "Sube planos o fotos del estado actual",
            upload: "Subir archivos",
            dragDrop: "Arrastra aquí o haz click"
        },
        summary: {
            title: "Resumen de Solicitud",
            description: "Revisa los datos antes de enviar",
            personalInfo: "Datos Personales",
            projectInfo: "Proyecto",
            submit: "Solicitar Presupuesto Gratis"
        },
        quickForm: {
            title: "Presupuesto Rápido",
            description: "Obtén un precio estimado en segundos.",
            renovationType: { label: "Tipo", options: { integral: "Integral", bathrooms: "Baños", kitchen: "Cocina", pool: "Piscina" } },
            squareMeters: { label: "Metros Cuadrados" },
            additionalDetails: { label: "Descripción Adicional", placeholder: "Detalles..." }
        },
        reformInclusions: {
            title: "Incluye:",
            kitchen: ["Demolición", "Fontanería", "Electricidad", "Mobiliario", "Alicatado"],
            bathrooms: ["Sanitarios", "Grifería", "Plato ducha", "Mampara"],
            integral: ["Todo incluído", "Llave en mano"],
            pool: ["Excavación", "Vaso", "Depuradora"]
        },
        selector: {
            title: "¿Cómo podemos ayudarte?",
            subtitle: "Elige la opción que mejor se adapte a tu proyecto.",
            options: {
                wizard: { title: "Presupuesto Inteligente", desc: "Analisis detallado 360º con IA", badge: "Recomendado" },
                newBuild: { title: "Obra Nueva", desc: "Construcción desde cero" },
                fast: { title: "Presupuesto Rápido", desc: "Estimación express para reformas" }
            }
        },
        premiumSelector: {
            badge: "Empieza tu proyecto",
            title: "Cómo podemos <br /> <span class=\"text-[#e8c42f]\">ayudarte?</span>",
            subtitle: "Elige la opción que mejor encaje con tu proyecto.",
            features: [
                "Consultoría gratuita",
                "Sin compromiso",
                "Respuesta en 24h"
            ],
            options: {
                smart: { badge: "Recomendado", title: "Presupuesto Smart", desc: "Análisis 360º con IA." },
                newBuild: { title: "Obra Nueva", desc: "Construcción desde cero." },
                quick: { title: "Presupuesto Rápido", desc: "Estimación exprés." }
            }
        },
        modal: {
            headers: {
                newBuild: { title: "Estudio de Obra Nueva", desc: "Déjanos analizar la viabilidad de tu proyecto." },
                wizard: { title: "Asistente de Presupuestos", desc: "Detalla tu visión paso a paso." },
                pool: { title: "Cotizador de Piscinas", desc: "Diseña tu oasis perfecto." },
                fast: { title: "Calculadora Rápida", desc: "Obtén una estimación inmediata." }
            },
            cancel: "Cancelar"
        },
        trigger: {
            title: "¿Pensando en renovar?",
            subtitle: "Obtén tu estimación gratuita en segundos.",
            mobileSubtitle: "Click para comenzar",
            modes: {
                general: "Solicitar Presupuesto",
                pool: "Cotizar Piscina",
                reform: "Precio Reforma",
                new_build: "Estudio Obra Nueva",
                kitchen: "Presupuesto Cocina",
                bathroom: "Presupuesto Baño",
                wizard: "Presupuesto 360º"
            }
        },
        confirmation: {
            title: "¡Listo!",
            description: "Aquí tienes tu estimación.",
            poolMessage: "Para piscinas necesitamos ver el terreno.",
            noCostMessage: "Precios orientativos sin IVA.",
            button: "Volver al inicio",
            restartForm: "Empezar de nuevo",
            reviewButton: "Ver opiniones"
        }
    }
};



// ... (mockT remains the same, omitted for brevity if no changes needed, but replace_file_content needs full block if I replace whole file. 
// CHECK: Is mockT huge? Yes. I should try to preserve it or just replace the component logic part.
// But I need to add PremiumBudgetSelector. I'll add it before SmartBudgetModal.

// ... mockT ... (I will assume mockT is unchanged and focus on replacing the components below it 
// or I can target the specific function if I look at line numbers, but indentation is tricky.
// Better to replace from 'function BudgetSelector' onwards.)



export function SmartBudgetModal({ dictionary }: { dictionary?: any }) {
    const { isOpen, closeWidget, activeMode, openWidget, leadId } = useWidgetContext();
    const isDesktop = useMediaQuery("(min-width: 768px)");

    // Use dictionary if available, otherwise mockT
    const t = dictionary ? { budgetRequest: dictionary } : mockT;

    // Define render content
    const renderContent = () => {
        // If not verified and trying to access a specific mode, show identity form via SmartTriggerContainer
        if (!leadId && activeMode !== 'general') {
            return <SmartTriggerContainer dictionary={dictionary} intent={activeMode} />;
        }

        if (activeMode === 'general') {
            return <SmartTriggerContainer dictionary={dictionary} />;
        }
        if (activeMode === 'new-build') {
            return <NewBuildForm t={t} onSuccess={closeWidget} onBack={() => openWidget('general')} />;
        }
        if (activeMode === 'wizard') {
            return <BudgetRequestWizard t={t} services={services} onBack={() => openWidget('general')} isWidget={true} />;
        }
        if (activeMode === 'chat') {
            // Chat público comercial: cualifica leads y persiste la conversación
            // (chatSessionId en sessionStorage). Cuando el agente decide hacer
            // handoff, la conversación se vincula al lead real en el dashboard.
            return <PublicCommercialChat />;
        }
        // Fallback for Quick Budget or others
        return <QuickBudgetForm t={t} onBack={() => openWidget('general')} />;
    };

    const header = activeMode !== 'general' && activeMode !== 'chat'
        ? t.budgetRequest.modal.headers[activeMode === 'wizard' ? 'wizard' : activeMode === 'new-build' ? 'newBuild' : 'fast']
        : { title: '', desc: '' };

    // Los formularios largos (wizard detallado, obra nueva, chat) se muestran a
    // pantalla completa para aprovechar el espacio. Los más cortos (quick,
    // selector general) se mantienen centrados con un ancho cómodo de lectura.
    const isFullscreen = activeMode === 'wizard' || activeMode === 'new-build';
    const isChatFullscreen = activeMode === 'chat';

    if (isDesktop) {
        return (
            <Dialog open={isOpen} onOpenChange={closeWidget}>
                <DialogContent className={cn(
                    "transition-all duration-300 overflow-hidden",
                    activeMode === 'general'
                        ? "sm:max-w-[850px] p-0 bg-[#FBFBFB] border-none shadow-2xl rounded-3xl overflow-y-auto"
                        : isChatFullscreen
                            ? "!w-screen !h-screen !max-w-none !left-0 !top-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 bg-background flex flex-col"
                            : isFullscreen
                                ? "!w-screen !h-screen !max-w-none !left-0 !top-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 bg-background flex flex-col"
                                : "sm:max-w-2xl max-h-[90vh] bg-background border-border overflow-y-auto"
                )}>
                    {isFullscreen ? (
                        <>
                            <DialogHeader className="shrink-0 sticky top-0 z-20 border-b border-border bg-background px-6 py-4">
                                <DialogTitle className="font-headline text-xl md:text-2xl tracking-tight text-foreground">
                                    {header.title}
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground">
                                    {header.desc}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="flex-1 overflow-y-auto">
                                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
                                    {renderContent()}
                                </div>
                            </div>
                        </>
                    ) : isChatFullscreen ? (
                        <>
                            <DialogHeader className="sr-only">
                                <DialogTitle>Asistente Grupo RG</DialogTitle>
                                <DialogDescription>Chat con el asistente comercial</DialogDescription>
                            </DialogHeader>
                            <div className="flex-1 min-h-0 overflow-hidden">
                                {renderContent()}
                            </div>
                        </>
                    ) : (
                        <>
                            <DialogHeader className={cn(activeMode === 'general' && "sr-only")}>
                                <DialogTitle className="font-headline text-3xl">
                                    {activeMode === 'general' ? "Asistente Grupo RG" : header.title}
                                </DialogTitle>
                                <DialogDescription className="text-lg">
                                    {activeMode === 'general' ? "Solicitud de presupuesto y asistencia" : header.desc}
                                </DialogDescription>
                            </DialogHeader>

                            <div className={cn(activeMode === 'general' ? "" : "pt-6 px-2", "h-full")}>
                                {renderContent()}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        );
    }

    // ... mobile drawer implementation ...
    const isFullscreenMobile = isFullscreen || isChatFullscreen;
    return (
        <Drawer open={isOpen} onOpenChange={closeWidget}>
            <DrawerContent
                className={cn(
                    "flex flex-col bg-[#FBFBFB]",
                    isFullscreenMobile
                        ? "h-[100dvh] !max-h-[100dvh] rounded-none"
                        : "max-h-[95vh]"
                )}
            >
                <DrawerHeader className={cn("text-left shrink-0", (activeMode === 'general' || isChatFullscreen) && "sr-only")}>
                    <DrawerTitle className="font-headline text-2xl">
                        {activeMode === 'general' || isChatFullscreen ? "Asistente Grupo RG" : header.title}
                    </DrawerTitle>
                    <DrawerDescription>
                        {activeMode === 'general' || isChatFullscreen ? "Solicitud de presupuesto y asistencia" : header.desc}
                    </DrawerDescription>
                </DrawerHeader>

                <div className={cn("overflow-y-auto flex-1", activeMode === 'general' || isChatFullscreen ? "p-0" : "p-4")}>
                    {renderContent()}
                </div>

                {activeMode !== 'general' && !isFullscreenMobile && (
                    <DrawerFooter className="pt-2 shrink-0">
                        <DrawerClose asChild>
                            <Button variant="outline">Cancelar</Button>
                        </DrawerClose>
                    </DrawerFooter>
                )}
            </DrawerContent>
        </Drawer>
    );
}
