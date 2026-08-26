import { getDictionary } from '@/lib/dictionaries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle, Users, GitMerge, Bot, BarChart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

const phases = [
    {
        week: 1,
        title: "Fase 1: Cimientos y Plataforma de Control",
        startDate: "12/12/2025",
        endDate: "19/12/2025",
        icon: <GitMerge className="h-8 w-8 text-primary" />,
        objectives: [
            "Despliegue del Web Site Pro optimizado para SEO con la estructura base.",
            "Desarrollo del núcleo de la Plataforma de Control (Backend).",
            "Creación de módulos para gestión de clientes y estructura de presupuestos/facturas.",
        ],
        deliverables: [
            { item: "Acceso al sitio web en un entorno de desarrollo.", status: "Pendiente" },
            { item: "Primer borrador del panel de control con gestión de clientes.", status: "Pendiente" },
            { item: "Definición conjunta de la estructura de datos para facturas (Verifactu).", status: "Pendiente" },
        ]
    },
    {
        week: 2,
        title: "Fase 2: Inteligencia Artificial y Automatización de Presupuestos",
        startDate: "20/12/2025",
        endDate: "27/12/2025",
        icon: <Bot className="h-8 w-8 text-primary" />,
        objectives: [
            "Integración de la IA para la generación de presupuestos inteligentes.",
            "Desarrollo del Sistema de Presupuestos Ágiles (Full) en el frontend.",
            "Inicio del desarrollo del Portal de Cliente: subida de documentos y visualización de datos.",
            "Configuración del sistema de cumplimiento con Verifactu."
        ],
        deliverables: [
            { item: "Demo funcional del generador de presupuestos con IA.", status: "Pendiente" },
            { item: "Acceso al portal de cliente (versión inicial).", status: "Pendiente" },
            { item: "Plan de integración final para Verifactu.", status: "Pendiente" },
        ]
    },
    {
        week: 3,
        title: "Fase 3: Proyectos WOW y Reputación Online",
        startDate: "28/12/2025",
        endDate: "03/01/2026",
        icon: <Users className="h-8 w-8 text-primary" />,
        objectives: [
            "Implementación de la IA generativa para la creación de renders de proyectos.",
            "Desarrollo del Sistema de Reseñas Inteligente y Respondedor Automático.",
            "Integración del Portal de Cliente con firma digital de documentos.",
            "Optimización y conexión con la Ficha de Google (GMB)."
        ],
        deliverables: [
            { item: "Prototipo para generar renders a partir de descripciones.", status: "Pendiente" },
            { item: "Panel de gestión de reseñas y configuración del respondedor.", status: "Pendiente" },
            { item: "Funcionalidad de firma digital implementada en el portal.", status: "Pendiente" },
        ]
    },
    {
        week: 4,
        title: "Fase 4: Optimización, Informes y Entrega Final",
        startDate: "04/01/2026",
        endDate: "11/01/2026",
        icon: <BarChart className="h-8 w-8 text-primary" />,
        objectives: [
            "Desarrollo de los Informes de Rendimiento Automatizados.",
            "Implementación de las automatizaciones de seguimiento de presupuestos.",
            "Implementación del Protocolo de Publicaciones GMB Inteligentes.",
            "Desarrollo de la automatización a medida y entrega del bono (Vídeo y Reels)."
        ],
        deliverables: [
            { item: "Dashboard de informes de rendimiento.", status: "Pendiente" },
            { item: "Demo de la automatización de seguimiento.", status: "Pendiente" },
            { item: "Entrega de material audiovisual (Bono).", status: "Pendiente" },
            { item: "Capacitación y entrega final del 'Plan Constructor Total'.", status: "Pendiente" },
        ]
    }
];

export default async function RoadmapPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const dict = await getDictionary(locale as any);
    const logoUrl = "/images/logo.avif";

    return (
        <>
            <main className="flex-1 bg-gray-50 dark:bg-gray-900">
                <section className="w-full py-16 md:py-24 bg-secondary/50">
                    <div className="container-limited text-center">
                        <div className="relative w-64 h-auto mx-auto mb-8">
                            <Image
                                src={logoUrl}
                                alt="Logo Grupo RG"
                                width={276}
                                height={116}
                                className="object-contain"
                                priority
                            />
                        </div>
                        <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                            Plan Constructor Total Grupo RG
                        </h1>
                        <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                            El sistema completo para visualizar, presupuestar y cerrar más proyectos en automático. A continuación, nuestra hoja de ruta detallada para hacerlo realidad.
                        </p>
                    </div>
                </section>

                <section className="w-full py-16 md:py-24">
                    <div className="container-limited">
                        <Card className="mb-12">
                            <CardHeader>
                                <CardTitle>Filosofía de Trabajo y Comunicación</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 text-muted-foreground">
                                <p>Creemos en una colaboración transparente y ágil. Esta hoja de ruta no es solo un plan, sino un pacto de comunicación. Cada fase finaliza con una entrega clave y una sesión de feedback, asegurando que el producto final no solo cumpla, sino que supere tus expectativas.</p>
                                <p>Utilizaremos metodologías ágiles, lo que nos permite ser flexibles ante cambios y asegurar un progreso constante y visible. Tu participación activa es fundamental para el éxito.</p>
                            </CardContent>
                        </Card>

                        <div className="space-y-8">
                            <Accordion type="single" collapsible className="w-full space-y-8" defaultValue="week-1">
                                {phases.map((phase) => (
                                    <AccordionItem value={`week-${phase.week}`} key={phase.week} className="border-0">
                                        <Card className="overflow-hidden">
                                            <AccordionTrigger className="p-6 hover:no-underline">
                                                <div className="flex items-center gap-4 text-left w-full">
                                                    {phase.icon}
                                                    <div className="flex-1">
                                                        <div className="flex justify-between items-center">
                                                            <h3 className="font-headline text-xl md:text-2xl font-bold">{phase.title}</h3>
                                                            <Badge variant="outline" className="hidden md:inline-flex">Semana {phase.week}</Badge>
                                                        </div>
                                                        <p className="text-sm text-muted-foreground mt-1">
                                                            {phase.startDate} - {phase.endDate}
                                                        </p>
                                                    </div>
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="p-6 pt-0">
                                                <div className="grid md:grid-cols-2 gap-8 pt-4 border-t">
                                                    <div className="space-y-4">
                                                        <h4 className="font-semibold text-lg">Objetivos de la Fase</h4>
                                                        <ul className="space-y-3">
                                                            {phase.objectives.map((obj, index) => (
                                                                <li key={index} className="flex items-start">
                                                                    <CheckCircle className="h-5 w-5 text-green-500 mr-2 mt-0.5 shrink-0" />
                                                                    <span className="text-muted-foreground">{obj}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                    <div className="space-y-4">
                                                        <h4 className="font-semibold text-lg">Entregables y Puntos de Feedback</h4>
                                                        <ul className="space-y-2">
                                                            {phase.deliverables.map((del, index) => (
                                                                <li key={index} className="flex justify-between items-center text-sm p-2 rounded-md bg-secondary/50">
                                                                    <span className="text-muted-foreground">{del.item}</span>
                                                                    <Badge variant={del.status === 'Completado' ? 'default' : 'secondary'}>{del.status}</Badge>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                </div>
                                            </AccordionContent>
                                        </Card>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </div>
                    </div>
                </section>

            </main>
        </>
    );
}
