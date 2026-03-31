import { Budget } from "@/backend/budget/domain/budget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FileText, Map, Phone, Mail, User, Image as ImageIcon, File } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { sendQuickQuoteAction } from "@/actions/budget/send-quick-quote.action";
import { convertToFullBudgetAction } from "@/actions/budget/convert-to-full.action";
import { Loader2, Send, FileCode, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface BudgetRequestViewerProps {
    budget: Budget;
    isAdmin?: boolean;
}

export function BudgetRequestViewer({ budget, isAdmin = false }: BudgetRequestViewerProps) {
    const { clientSnapshot, type, createdAt } = budget;
    // Cast clientData based on type for safety within this scope, though we handle properties generically where shared.
    const isNewBuild = type === 'new_build';
    // const isQuick = type === 'quick'; // Unused

    const { toast } = useToast();
    const [isSending, setIsSending] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [quotePrice, setQuotePrice] = useState<string>("");
    const [quoteMessage, setQuoteMessage] = useState<string>("");

    // Access specs directly
    const { specs } = budget;
    const description = specs.description;
    const files = specs.files || [];

    // Validating specific properties for new build if they exist in specs (custom casting might be needed if ProjectSpecs doesn't have them explicitly yet)
    const specsAny = specs as any;
    const plotArea = specsAny.plotArea || 0;
    const buildingArea = specsAny.buildingArea || specs.totalArea;
    const floors = specsAny.floors || 1;
    const hasGarage = specs.parking;
    const hasPool = specsAny.pool; // Not in ProjectSpecs yet

    const handleSendQuote = async () => {
        if (!quotePrice || !quoteMessage) {
            toast({
                title: "Faltan datos",
                description: "Por favor, introduce un precio y un mensaje.",
                variant: "destructive"
            });
            return;
        }

        setIsSending(true);
        try {
            const result = await sendQuickQuoteAction({
                budgetId: budget.id,
                price: Number(quotePrice),
                message: quoteMessage
            });

            if (result.success) {
                toast({
                    title: "Presupuesto enviado",
                    description: "El cliente recibirá la estimación por email.",
                });
            } else {
                toast({
                    title: "Error",
                    description: result.error || "No se pudo enviar el presupuesto.",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({ title: "Error", description: "Fallo inesperado.", variant: "destructive" });
        } finally {
            setIsSending(false);
        }
    };

    const handleConvertToFull = async () => {
        setIsConverting(true);
        try {
            const result = await convertToFullBudgetAction(budget.id);
            if (result.success) {
                toast({
                    title: "Convertido",
                    description: "Ahora puedes editar el presupuesto completo.",
                });
                // The page should refresh via server action revalidation
            } else {
                toast({
                    title: "Error",
                    description: result.error || "No se pudo convertir.",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({ title: "Error", description: "Fallo inesperado.", variant: "destructive" });
        } finally {
            setIsConverting(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                        {isNewBuild ? "Solicitud de Obra Nueva" : "Solicitud de Presupuesto Rápido"}
                    </h1>
                    <p className="text-slate-500 mt-1 flex items-center gap-2 text-sm">
                        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">Ref: {budget.id.substring(0, 8)}</span>
                        <span>•</span>
                        <span>{format(createdAt, "PPP 'a las' p", { locale: es })}</span>
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge className="text-base px-4 py-1" variant={budget.status === 'pending_review' ? 'destructive' : 'default'}>
                        {budget.status === 'pending_review' ? 'Pendiente de Revisión' : budget.status === 'sent' ? 'Enviado' : budget.status}
                    </Badge>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Main Info */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Project Description */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="w-5 h-5 text-primary" />
                                Descripción del Proyecto
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="prose prose-slate max-w-none">
                                {description ? (
                                    <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">{description}</p>
                                ) : (
                                    <p className="text-slate-400 italic">Sin descripción proporcionada.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* New Build Specifics */}
                    {isNewBuild && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Map className="w-5 h-5 text-primary" />
                                    Detalles de la Parcela y Construcción
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                                    <div>
                                        <dt className="text-sm font-medium text-slate-500">Parcela</dt>
                                        <dd className="text-xl font-semibold text-slate-900">{plotArea} m²</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-slate-500">Construcción</dt>
                                        <dd className="text-xl font-semibold text-slate-900">{buildingArea} m²</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-slate-500">Plantas</dt>
                                        <dd className="text-xl font-semibold text-slate-900">{floors}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-slate-500">Extras</dt>
                                        <dd className="text-sm font-semibold text-slate-900 flex flex-col">
                                            {hasGarage && <span>• Garaje</span>}
                                            {hasPool && <span>• Piscina</span>}
                                            {!hasGarage && !hasPool && <span className="text-slate-400">-</span>}
                                        </dd>
                                    </div>
                                </dl>
                            </CardContent>
                        </Card>
                    )}

                    {/* Multimedia Gallery */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-primary" />
                                Archivos Adjuntos ({files.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {files.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {files.map((file: string, index: number) => {
                                        // Simple extension check
                                        const isVideo = file.match(/\.(mp4|mov|webm)$/i);
                                        const isPdf = file.match(/\.pdf$/i);
                                        const isImage = !isVideo && !isPdf;

                                        return (
                                            <div key={index} className="group relative aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                                                {isImage && (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={file}
                                                        alt={`Adjunto ${index + 1}`}
                                                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                    />
                                                )}
                                                {isVideo && (
                                                    <video
                                                        src={file}
                                                        controls
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                                {isPdf && (
                                                    <div className="flex flex-col items-center justify-center h-full text-slate-500 hover:text-primary transition-colors">
                                                        <File className="w-12 h-12 mb-2" />
                                                        <span className="text-xs font-medium">Documento PDF</span>
                                                    </div>
                                                )}

                                                {/* Overlay / Link */}
                                                <a
                                                    href={file}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
                                                >
                                                    <span className="bg-white/90 text-xs font-medium px-2 py-1 rounded shadow-sm">Abrir</span>
                                                </a>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-400 border-2 border-dashed rounded-lg">
                                    <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    No hay archivos adjuntos.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Actions / Admin Panel */}
                <div className="space-y-6">
                    {/* Client Info Summary */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <User className="w-4 h-4 text-slate-500" />
                                Datos del Cliente
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
                                    {clientSnapshot.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900">{clientSnapshot.name}</p>
                                    <p className="text-slate-500 text-xs">Registrado el {format(new Date(), 'P', { locale: es })}</p>
                                </div>
                            </div>
                            <Separator />
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Mail className="w-3.5 h-3.5" />
                                    <a href={`mailto:${clientSnapshot.email}`} className="hover:text-primary transition-colors">{clientSnapshot.email}</a>
                                </div>
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Phone className="w-3.5 h-3.5" />
                                    <a href={`tel:${clientSnapshot.phone}`} className="hover:text-primary transition-colors">{clientSnapshot.phone}</a>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ADMIN ACTION PANEL */}
                    {isAdmin && (
                        <Card className="border-indigo-100 dark:border-indigo-900 shadow-md">
                            <CardHeader className="bg-indigo-50/50 dark:bg-indigo-900/10 pb-3">
                                <CardTitle className="text-base flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                                    <Send className="w-4 h-4" />
                                    Respuesta Rápida
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 space-y-4">
                                {budget.quickQuote ? (
                                    <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-lg p-4 space-y-2">
                                        <div className="flex items-center gap-2 text-green-700 font-semibold">
                                            <CheckCircle2 className="w-4 h-4" />
                                            Presupuesto Enviado
                                        </div>
                                        <div className="text-2xl font-bold text-slate-900 dark:text-white">
                                            {formatCurrency(budget.quickQuote.price)}
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-black/20 p-2 rounded border border-green-200/50">
                                            &quot;{budget.quickQuote.message}&quot;
                                        </div>
                                        <div className="text-xs text-slate-400 text-right">
                                            Enviado el {format(new Date(budget.quickQuote.answeredAt), 'PPP p', { locale: es })}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Precio Estimado (€)</label>
                                            <Input
                                                type="number"
                                                placeholder="Ej: 15000"
                                                value={quotePrice}
                                                onChange={(e) => setQuotePrice(e.target.value)}
                                                className="font-mono text-lg"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mensaje al Cliente</label>
                                            <Textarea
                                                placeholder="Hola, basándome en los m2 y calidades..."
                                                value={quoteMessage}
                                                onChange={(e) => setQuoteMessage(e.target.value)}
                                                rows={4}
                                            />
                                        </div>
                                        <Button
                                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                                            onClick={handleSendQuote}
                                            disabled={isSending}
                                        >
                                            {isSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                                            Enviar Estimación
                                        </Button>
                                    </>
                                )}

                                <Separator className="my-2" />

                                <div className="pt-2">
                                    <p className="text-xs text-slate-500 mb-3">
                                        Si el proyecto requiere un desglose detallado, conviértelo a formato completo.
                                    </p>
                                    <Button
                                        variant="outline"
                                        className="w-full border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400"
                                        onClick={handleConvertToFull}
                                        disabled={isConverting}
                                    >
                                        {isConverting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileCode className="w-4 h-4 mr-2" />}
                                        Convertir a Presupuesto Completo
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
