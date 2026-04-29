'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useState, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CompanyConfig } from '@/backend/platform/domain/company-config';
import { saveCompanyConfigAction } from '@/actions/platform/company-config.action';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload } from 'lucide-react';

// Validación relajada — permite guardar solo el logo (resto de datos opcionales).
// Los campos seguirán mostrándose marcados como "obligatorios" en la UI a modo de
// recomendación, pero el formulario no bloquea el submit si están vacíos.
// Email y URL solo se validan si tienen contenido (string vacío permitido).
const formSchema = z.object({
    name: z.string().optional(),
    legalName: z.string().optional(),
    cif: z.string().optional(),
    tagline: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email('Email inválido').or(z.literal('')).optional(),
    web: z.string().url('URL inválida').or(z.literal('')).optional(),
    ivaRate: z.coerce.number().min(0).max(100).optional(),
    regime: z.string().optional(),
    bankAccount: z.string().optional(),
    footerText: z.string().optional(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
});

interface CompanyConfigFormProps {
    initialConfig: CompanyConfig;
}

export function CompanyConfigForm({ initialConfig }: CompanyConfigFormProps) {
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const [logoUrl, setLogoUrl] = useState(initialConfig.logoUrl);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: initialConfig.name,
            legalName: initialConfig.legalName,
            cif: initialConfig.cif,
            tagline: initialConfig.tagline ?? '',
            address: initialConfig.address,
            phone: initialConfig.phone,
            email: initialConfig.email,
            web: initialConfig.web,
            ivaRate: (initialConfig.billing?.ivaRate ?? 0.10) * 100,
            regime: initialConfig.billing?.regime ?? '',
            bankAccount: initialConfig.billing?.bankAccount ?? '',
            footerText: initialConfig.footerText ?? '',
            instagram: initialConfig.social?.instagram ?? '',
            facebook: initialConfig.social?.facebook ?? '',
            linkedin: initialConfig.social?.linkedin ?? '',
        },
    });

    async function handleLogoUpload(file: File) {
        // @react-pdf/renderer solo soporta PNG/JPG/JPEG. AVIF, WebP, SVG fallan
        // silenciosamente al renderizar el PDF aunque la subida al Storage funcione.
        const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
        const supportedExts = ['png', 'jpg', 'jpeg'];
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const typeOk = supportedTypes.includes(file.type.toLowerCase());
        const extOk = supportedExts.includes(ext);
        if (!typeOk && !extOk) {
            toast({
                variant: 'destructive',
                title: 'Formato no compatible con PDF',
                description: `El archivo .${ext || file.type} no es válido para los presupuestos en PDF. Usa PNG o JPG.`,
            });
            return;
        }

        // Guard de tamaño — base64 inflará ~33% el peso. Limite blando 500 KB
        // para mantener el doc de companyConfig por debajo del límite Firestore (1MB).
        const MAX_LOGO_BYTES = 500 * 1024;
        if (file.size > MAX_LOGO_BYTES) {
            toast({
                variant: 'destructive',
                title: 'Logo demasiado grande',
                description: `Máximo permitido: 500 KB. Comprime el PNG (ej. tinypng.com) antes de subir.`,
            });
            return;
        }

        setIsUploading(true);
        try {
            // Leer como data URL base64 directamente. Lo guardamos en
            // companyConfig.logoUrl. Ventajas:
            //  1. Cero CORS — `@react-pdf/renderer` lo renderiza sin fetch externo.
            //  2. Sin dependencia de Firebase Storage rules para el render.
            //  3. Logo viaja con el doc de empresa (snapshot atómico).
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string') resolve(reader.result);
                    else reject(new Error('FileReader no devolvió un string'));
                };
                reader.onerror = () => reject(reader.error || new Error('Error leyendo el archivo'));
                reader.readAsDataURL(file);
            });
            setLogoUrl(dataUrl);
            toast({ title: 'Logo cargado', description: 'Recuerda guardar para aplicar los cambios.' });
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Error procesando el logo' });
        } finally {
            setIsUploading(false);
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setIsSaving(true);
        try {
            // Permitimos guardar con campos vacíos (validación relajada para
            // poder probar el logo en PDF sin completar todos los datos).
            // El interface CompanyConfig requiere strings, no undefined → default a ''.
            const toSave: CompanyConfig = {
                ...initialConfig,
                name: values.name ?? '',
                legalName: values.legalName ?? '',
                cif: values.cif ?? '',
                tagline: values.tagline || undefined,
                logoUrl,
                address: values.address ?? '',
                phone: values.phone ?? '',
                email: values.email ?? '',
                web: values.web ?? '',
                footerText: values.footerText || undefined,
                billing: {
                    ivaRate: values.ivaRate !== undefined ? values.ivaRate / 100 : undefined,
                    regime: values.regime || undefined,
                    bankAccount: values.bankAccount || undefined,
                },
                social: {
                    instagram: values.instagram || undefined,
                    facebook: values.facebook || undefined,
                    linkedin: values.linkedin || undefined,
                },
                updatedAt: new Date(),
            };

            await saveCompanyConfigAction(toSave);
            toast({
                title: 'Configuración guardada',
                description: 'Los datos de empresa se han actualizado.',
            });
        } catch (e) {
            console.error(e);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No se pudo guardar la configuración.',
            });
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Identidad</CardTitle>
                        <CardDescription>
                            Nombre comercial, razón social y logo que aparecerán en PDFs, emails y web.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-start gap-6">
                            <div className="shrink-0 w-32 h-32 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden">
                                {logoUrl ? (
                                    <Image src={logoUrl} alt="Logo" width={128} height={128} className="object-contain" />
                                ) : (
                                    <span className="text-xs text-muted-foreground">Sin logo</span>
                                )}
                            </div>
                            <div className="flex-1 space-y-2">
                                <FormLabel>Logo</FormLabel>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleLogoUpload(f);
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                    {logoUrl ? 'Cambiar logo' : 'Subir logo'}
                                </Button>
                                <FormDescription>Solo PNG o JPG (AVIF y WebP no son compatibles con el motor de PDF). Se recomienda fondo transparente.</FormDescription>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nombre comercial</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="legalName" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Razón social</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="cif" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>CIF / NIF</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="tagline" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Tagline (opcional)</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormDescription>Lema breve que aparece bajo el nombre.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Contacto</CardTitle>
                        <CardDescription>Datos visibles en la web pública, PDFs y emails.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField control={form.control} name="address" render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel>Dirección</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="phone" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Teléfono</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl><Input type="email" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="web" render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel>Sitio web</FormLabel>
                                    <FormControl><Input type="url" {...field} /></FormControl>
                                    <FormDescription>Se usa como baseUrl en sitemap, robots y datos estructurados.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Facturación</CardTitle>
                        <CardDescription>Datos fiscales por defecto para los PDFs de presupuesto.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField control={form.control} name="ivaRate" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>IVA por defecto (%)</FormLabel>
                                    <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                                    <FormDescription>10% para reformas de vivienda habitual, 21% general.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="regime" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Régimen fiscal</FormLabel>
                                    <FormControl><Input {...field} placeholder="General" /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="bankAccount" render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel>Cuenta bancaria (opcional)</FormLabel>
                                    <FormControl><Input {...field} placeholder="ES76 **** **** **** **** 1234" /></FormControl>
                                    <FormDescription>Aparece en el PDF para facilitar el pago.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="footerText" render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel>Texto de pie de página</FormLabel>
                                    <FormControl><Textarea rows={2} {...field} /></FormControl>
                                    <FormDescription>Se imprime en el footer del PDF y emails (p.ej. "Inscrita en el RM de...").</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Redes sociales</CardTitle>
                        <CardDescription>Enlaces opcionales para footer público y datos estructurados.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormField control={form.control} name="instagram" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Instagram</FormLabel>
                                    <FormControl><Input {...field} placeholder="https://instagram.com/..." /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="facebook" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Facebook</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="linkedin" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>LinkedIn</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </CardContent>
                </Card>

                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar configuración
                </Button>
            </form>
        </Form>
    );
}
