'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wand2, Upload, ImageIcon, Plus } from 'lucide-react';
import { generateRenovationAction } from '@/actions/ai/generate-renovation.action';
import Image from 'next/image';

import { useRouter } from 'next/navigation';
import { BudgetRender } from '@/backend/budget/domain/budget';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageComparisonSlider } from '@/components/ui/image-comparison';

interface RenovationGalleryProps {
    budgetId: string;
    renders?: BudgetRender[];
    items?: any[]; // To get context for prompt
}

export function RenovationGallery({ budgetId, renders = [], items = [] }: RenovationGalleryProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [generatedImages, setGeneratedImages] = useState<string[]>([]);
    const [viewingImage, setViewingImage] = useState<{ url: string, beforeUrls?: string[], originalUrl?: string, title: string } | null>(null);

    const [roomType, setRoomType] = useState('Salón');
    const [style, setStyle] = useState('Moderno');
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [requirements, setRequirements] = useState('');
    
    // Sync external renders to local state for optimistic UI updates
    const [localRenders, setLocalRenders] = useState<BudgetRender[]>(renders);
    
    useEffect(() => {
        setLocalRenders(renders);
    }, [renders]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            files.forEach(file => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setSelectedImages(prev => [...prev, reader.result as string]);
                };
                reader.readAsDataURL(file);
            });
        }
    };

    const handleGenerate = async () => {
        if (selectedImages.length === 0) return;

        setIsGenerating(true);
        try {
            // 1. Generate Image (Server Action returns Base64)
            const base64DataArray = selectedImages.map(img => img.split(',')[1]);
            const result = await generateRenovationAction({
                imageBuffer: base64DataArray[0], // MVP: Using only the first image
                roomType,
                style,
                additionalRequirements: requirements,
                budgetId,
                aspectRatio
            });

            if (!result.success || !result.base64) {
                toast({
                    title: "Error Generando",
                    description: result.error || "No se pudo crear la imagen.",
                    variant: "destructive"
                });
                return;
            }

            // 2. Upload to Firebase Storage (Client Side)
            const { getSafeStorage } = await import('@/lib/firebase/client'); // Dynamic import to ensure client-side
            const storage = getSafeStorage();
            const { ref, uploadString, getDownloadURL } = await import('firebase/storage');

            const timestamp = Date.now();

            // Upload Originals
            const originalUrls: string[] = [];
            for (let i = 0; i < selectedImages.length; i++) {
                const originalRef = ref(storage, `renders/${budgetId}/${timestamp}_original_${i}.jpg`);
                await uploadString(originalRef, selectedImages[i], 'data_url');
                const url = await getDownloadURL(originalRef);
                originalUrls.push(url);
            }

            // Upload Generated
            // For now, the flow generates a single After image summarizing the prompt, but returning mapping to the domain
            const generatedRef = ref(storage, `renders/${budgetId}/${timestamp}_${style}.png`);
            await uploadString(generatedRef, result.base64, 'base64', { contentType: 'image/png' });
            const generatedUrl = await getDownloadURL(generatedRef);

            // 3. Save Metadata to Budget (Server Action)
            const { addRenderAction } = await import('@/actions/budget/add-render.action');
            const saveResult = await addRenderAction({
                budgetId,
                render: {
                    id: `${timestamp}`,
                    url: generatedUrl,
                    originalUrl: originalUrls[0],
                    prompt: result.appliedPrompt || requirements || `Renovación estilo ${style}`,
                    style,
                    roomType
                }
            });

            if (saveResult.success) {
                setGeneratedImages([generatedUrl]);
                toast({
                    title: "¡Transformación Completa!",
                    description: "La imagen se ha guardado en la galería del presupuesto.",
                });
                router.refresh(); // Refresh to show new render in history
            } else {
                toast({
                    title: "Error Guardando",
                    description: "Se generó la imagen pero falló el guardado.",
                    variant: "destructive"
                });
            }

        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Ocurrió un fallo inesperado.",
                variant: "destructive"
            });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-purple-600" />
                        Dream Renovator
                    </CardTitle>
                    <CardDescription>
                        Genera visualizaciones fotorrealistas para este presupuesto.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Configuration */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>1. Sube la foto actual (&quot;Antes&quot;)</Label>
                                {selectedImages.length > 0 ? (
                                    <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center relative">
                                        <div className="w-full flex gap-2 overflow-x-auto pb-2 relative z-20">
                                            {selectedImages.map((img, idx) => (
                                                <div key={idx} className="relative w-24 h-24 shrink-0 rounded-md overflow-hidden border">
                                                    <Image src={img} alt={`Original ${idx}`} fill className="object-cover" />
                                                </div>
                                            ))}
                                            <label className="w-24 h-24 shrink-0 rounded-md border-2 border-dashed flex flex-col items-center justify-center relative hover:bg-slate-100 cursor-pointer">
                                                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                                                <Plus className="h-6 w-6 text-slate-400" />
                                            </label>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="border-2 border-dashed rounded-lg py-10 px-6 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer w-full">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={handleImageUpload}
                                        />
                                        <Upload className="h-8 w-8 text-slate-400 mb-2 pointer-events-none" />
                                        <span className="text-sm text-slate-500 pointer-events-none">Haz click para subir una o varias fotos de la estancia</span>
                                    </label>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Estancia</Label>
                                    <Select value={roomType} onValueChange={setRoomType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Salón">Salón</SelectItem>
                                            <SelectItem value="Cocina">Cocina</SelectItem>
                                            <SelectItem value="Baño">Baño</SelectItem>
                                            <SelectItem value="Dormitorio">Dormitorio</SelectItem>
                                            <SelectItem value="Terraza">Terraza</SelectItem>
                                            <SelectItem value="Fachada">Fachada</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Estilo</Label>
                                    <Select value={style} onValueChange={setStyle}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Moderno">Moderno</SelectItem>
                                            <SelectItem value="Rústico">Rústico</SelectItem>
                                            <SelectItem value="Industrial">Industrial</SelectItem>
                                            <SelectItem value="Escandinavo">Escandinavo</SelectItem>
                                            <SelectItem value="Clásico">Clásico</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Formato</Label>
                                    <Select value={aspectRatio} onValueChange={setAspectRatio}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="16:9">Apaisado (16:9)</SelectItem>
                                            <SelectItem value="1:1">Cuadrado (1:1)</SelectItem>
                                            <SelectItem value="9:16">Vertical (9:16)</SelectItem>
                                            <SelectItem value="4:3">Foto Clásica (4:3)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Detalles Adicionales</Label>
                                <Textarea
                                    placeholder="Ej: Suelo de madera clara, paredes blancas, mucha luz..."
                                    value={requirements}
                                    onChange={(e) => setRequirements(e.target.value)}
                                />
                            </div>

                            <Button
                                className="w-full bg-purple-600 hover:bg-purple-700"
                                disabled={selectedImages.length === 0 || isGenerating}
                                onClick={handleGenerate}
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Generando Sueños...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="mr-2 h-4 w-4" />
                                        Generar Transformación
                                    </>
                                )}
                            </Button>
                        </div>

                        {/* Result */}
                        <div className="space-y-4">
                            <Label>Resultado (&quot;Después&quot;)</Label>
                            <div className="w-full aspect-video bg-slate-100 rounded-lg flex items-center justify-center border overflow-hidden relative group">
                                {generatedImages.length > 0 ? (
                                    <>
                                        {/* Show first generated image for preview */}
                                        <img
                                            src={generatedImages[0]}
                                            alt="Renovación Generada"
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <Button variant="secondary" size="sm" onClick={() => setViewingImage({ url: generatedImages[0], beforeUrls: selectedImages, title: 'Resultado Generado' })}>
                                                Ampliar
                                            </Button>
                                            <Button variant="secondary" size="sm" onClick={() => window.open(generatedImages[0], '_blank')}>
                                                Descargar
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center text-slate-400">
                                        <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                        <p>La imagen generada aparecerá aquí</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* History Gallery */}
            {localRenders.length > 0 && (
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-slate-800">Galería de Transformaciones ({localRenders.length})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {localRenders.map((render) => (
                            <Card key={render.id} className="overflow-hidden group hover:shadow-lg transition-shadow">
                                <div className="relative aspect-video">
                                    <Image
                                        src={render.url}
                                        alt={render.prompt}
                                        fill
                                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                                    />
                                    <div className="absolute top-2 left-2 flex gap-2 w-[calc(100%-16px)] flex-wrap">
                                        <span className="bg-black/70 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm truncate max-w-[120px]">
                                            {render.roomType}
                                        </span>
                                        <span className="bg-purple-600/90 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm truncate max-w-[120px]">
                                            {render.style}
                                        </span>
                                    </div>
                                    {/* Action Text/Overlay */}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => setViewingImage({
                                                url: render.url,
                                                beforeUrls: render.originalUrl ? [render.originalUrl] : [],
                                                title: `Resultado: ${render.style} - ${render.roomType}`
                                            })}
                                        >
                                            Ver Comparativa
                                        </Button>
                                    </div>
                                    <div className="absolute bottom-2 right-2">
                                        <Button
                                            variant={render.includeInPdf ? "default" : "secondary"}
                                            size="icon"
                                            className="h-8 w-8 rounded-full shadow-md z-10"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                
                                                // Optimistic update
                                                const newValue = !render.includeInPdf;
                                                setLocalRenders(prev => prev.map(r => r.id === render.id ? { ...r, includeInPdf: newValue } : r));

                                                const { toggleRenderPdfAction } = await import('@/actions/budget/toggle-render-pdf.action');
                                                const res = await toggleRenderPdfAction({
                                                    budgetId,
                                                    renderId: render.id,
                                                    includeInPdf: newValue
                                                });
                                                
                                                if (!res.success) {
                                                    // Revert on failure
                                                    setLocalRenders(prev => prev.map(r => r.id === render.id ? { ...r, includeInPdf: !newValue } : r));
                                                    toast({
                                                        title: "Error",
                                                        description: "Fallo de conexión. No pudimos guardar la preferencia.",
                                                        variant: "destructive"
                                                    });
                                                }
                                            }}
                                            title={render.includeInPdf ? "En el PDF" : "Añadir a PDF"}
                                        >
                                            <span className="text-lg leading-none">{render.includeInPdf ? '⭐' : '☆'}</span>
                                        </Button>
                                    </div>
                                </div>
                                <div className={`p-3 border-t ${render.includeInPdf ? 'bg-yellow-50/50' : ''}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                         {render.includeInPdf && <span className="text-[10px] font-bold text-yellow-600 uppercase bg-yellow-100 px-2 py-0.5 rounded flex-shrink-0">PDF</span>}
                                         <p className="text-xs text-slate-500 line-clamp-2 leading-tight flex-1" title={render.prompt}>
                                            {render.prompt}
                                         </p>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-2 text-right">
                                        {new Date(render.createdAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Image Preview Modal */}
            <Dialog open={!!viewingImage} onOpenChange={(open) => !open && setViewingImage(null)}>
                <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/90 border-slate-800">
                    <DialogHeader className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm p-4 text-white">
                        <DialogTitle>{viewingImage?.title}</DialogTitle>
                    </DialogHeader>
                    {viewingImage && viewingImage.beforeUrls && viewingImage.beforeUrls.length > 0 ? (
                        <div className="flex flex-col relative w-full h-[80vh]">
                            <ImageComparisonSlider
                                beforeImage={viewingImage.beforeUrls[0]}
                                afterImage={viewingImage.url}
                                className="w-full flex-1"
                            />
                            {viewingImage.beforeUrls.length > 1 && (
                                <div className="absolute bottom-4 right-4 bg-black/50 text-white text-xs px-2 py-1 rounded-md">
                                    + {viewingImage.beforeUrls.length - 1} fotos previas
                                </div>
                            )}
                        </div>
                    ) : viewingImage && (
                        <div className="relative w-full h-[80vh]">
                            <Image
                                src={viewingImage.url}
                                alt={viewingImage.title}
                                fill
                                className="object-contain"
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
