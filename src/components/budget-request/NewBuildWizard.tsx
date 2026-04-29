'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { newBuildSchema, NewBuildFormValues } from './schema';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleFileUpload } from '@/components/ui/simple-file-upload';
import { createBudgetAction } from '@/actions/budget/create-budget.action';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, ArrowRight, Building2, Ruler } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useVerifiedLead } from '@/hooks/use-verified-lead';
import { VerifiedContactBanner, VerifiedFieldIcon } from '@/components/forms/verified-contact-banner';

export function NewBuildWizard() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const { toast } = useToast();
    const { lead: verifiedLead, isReady: isLeadVerified } = useVerifiedLead();

    const form = useForm<NewBuildFormValues>({
        resolver: zodResolver(newBuildSchema),
        defaultValues: {
            files: [],
            description: '',
            name: '',
            email: '',
            phone: '',
            address: '',
            garage: false,
            pool: false
        }
    });

    useEffect(() => {
        if (!verifiedLead) return;
        const current = form.getValues();
        form.reset({
            ...current,
            name: current.name || verifiedLead.name || '',
            email: current.email || verifiedLead.email || '',
            phone: current.phone || verifiedLead.phone || '',
            address: current.address || verifiedLead.address || '',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [verifiedLead?.id]);

    const onSubmit = async (values: NewBuildFormValues) => {
        setIsSubmitting(true);
        try {
            const result = await createBudgetAction('new_build', values);
            if (result.success) {
                setIsSuccess(true);
            } else {
                toast({
                    title: "Error",
                    description: "No se pudo enviar la solicitud. Inténtalo de nuevo.",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Ocurrió un error inesperado.",
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md mx-auto mt-12 p-8 bg-white rounded-xl shadow-lg border border-green-100 text-center"
            >
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Proyecto Recibido!</h2>
                <p className="text-slate-600 mb-8">
                    Gracias por confiarnos tu proyecto de Obra Nueva. Estudiaremos la documentación y te contactaremos para una primera reunión.
                </p>
                <Link href="/">
                    <Button className="w-full">Volver al Inicio</Button>
                </Link>
            </motion.div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <div className="text-center mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Proyecto de Obra Nueva 🏗️</h1>
                <p className="mt-4 text-lg text-slate-600">
                    Facilita los detalles básicos de tu parcela y proyecto para que podamos valorar la construcción de tu nueva vivienda.
                </p>
            </div>

            <Card className="border-slate-200 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle>Datos Técnicos</CardTitle>
                    <CardDescription>Caracteristicas de la parcela y la vivienda deseada.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

                            {/* Plot & Building Specs */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="plotArea"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Superficie Parcela (m²)</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Ruler className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                                    <Input type="number" className="pl-9" {...field} />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="buildingArea"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>M² Construidos estimados</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Building2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                                    <Input type="number" className="pl-9" {...field} />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="floors"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nº Plantas</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Features Checkboxes */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="garage"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-lg bg-slate-50">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <div className="leading-none">
                                                <FormLabel>Incluir Garaje</FormLabel>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="pool"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-lg bg-slate-50">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <div className="leading-none">
                                                <FormLabel>Incluir Piscina</FormLabel>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Observaciones / Detalles adicionales</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="Cuéntanos más sobre el estilo que buscas, materiales preferidos..."
                                                className="min-h-[100px]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="files"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Documentación del Proyecto (Planos, Referencias)</FormLabel>
                                        <FormControl>
                                            <SimpleFileUpload
                                                value={field.value}
                                                onChange={field.onChange}
                                                accept={{
                                                    'application/pdf': [],
                                                    'image/*': []
                                                }}
                                                description="Sube planos, proyecto básico o referencias (PDF o Imágenes)"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="pt-6 border-t">
                                <h3 className="text-lg font-semibold mb-4">Datos de Contacto</h3>
                                <div className="mb-4">
                                    <VerifiedContactBanner show={isLeadVerified} />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5">
                                                    Nombre y Apellidos <VerifiedFieldIcon show={isLeadVerified} />
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Tu nombre" {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="phone"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5">
                                                    Teléfono <VerifiedFieldIcon show={isLeadVerified} />
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Ej: 600 000 000" {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5">
                                                    Email <VerifiedFieldIcon show={isLeadVerified} />
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder="tucorreo@ejemplo.com" {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="address"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Ubicación de la Parcela</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Dirección o Referencia Catastral" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-12 text-lg font-medium"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Enviando...
                                    </>
                                ) : (
                                    <>
                                        Enviar Proyecto
                                        <ArrowRight className="w-5 h-5 ml-2" />
                                    </>
                                )}
                            </Button>

                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
