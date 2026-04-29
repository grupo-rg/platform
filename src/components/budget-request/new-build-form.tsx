'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useState } from 'react';
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SimpleFileUpload } from '@/components/ui/simple-file-upload';
import { createBudgetAction } from '@/actions/budget/create-budget.action';
import { useVerifiedLead } from '@/hooks/use-verified-lead';
import { VerifiedContactBanner, VerifiedFieldIcon } from '@/components/forms/verified-contact-banner';

// Schema
const newBuildSchema = z.object({
    hasLand: z.enum(['yes', 'no', 'searching'], { required_error: 'Por favor selecciona una opción.' }),
    hasProject: z.enum(['yes', 'no'], { required_error: 'Selecciona si tienes proyecto.' }).optional(),
    location: z.string().min(3, { message: 'La zona es obligatoria.' }),
    approxMeters: z.coerce.number().min(50, 'Mínimo 50m2'),
    name: z.string().min(2, 'Nombre obligatorio'),
    email: z.string().email('Email inválido'),
    phone: z.string().min(9, 'Teléfono válido requerido'),
    details: z.string().optional(),
    files: z.array(z.string()).optional(),
});

type NewBuildValues = z.infer<typeof newBuildSchema>;

export function NewBuildForm({ t, onSuccess, onBack }: { t: any, onSuccess?: () => void, onBack?: () => void }) {
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const { lead: verifiedLead, isReady: isLeadVerified } = useVerifiedLead();

    const form = useForm<NewBuildValues>({
        resolver: zodResolver(newBuildSchema),
        defaultValues: {
            hasLand: undefined,
            hasProject: undefined,
            location: '',
            approxMeters: 150,
            name: '',
            email: '',
            phone: '',
            details: '',
            files: []
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
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [verifiedLead?.id]);

    const { watch, trigger, handleSubmit } = form;
    const hasLand = watch('hasLand');

    // Steps Logic
    const nextStep = async () => {
        let fieldsToValidate: (keyof NewBuildValues)[] = [];
        if (step === 1) fieldsToValidate = ['hasLand'];
        if (step === 2) fieldsToValidate = ['location', 'approxMeters'];
        // if (step === 3) fieldsToValidate = ['name', 'email', 'phone']; // Final step validates on submit

        const isValid = await trigger(fieldsToValidate);
        if (isValid) setStep(prev => prev + 1);
    };

    const prevStep = () => setStep(prev => prev - 1);

    async function onSubmit(values: NewBuildValues) {
        setIsLoading(true);
        try {
            // Registra el lead. El listener NotifyAdminOnLeadCreatedUseCase
            // notifica al admin vía Resend.
            await createBudgetAction('new_build', {
                name: values.name,
                email: values.email,
                phone: values.phone,
                address: values.location,
                plotArea: values.approxMeters,
                buildingArea: values.approxMeters,
                floors: 1,
                description: `Obra Nueva en ${values.location}. Terreno: ${values.hasLand}. Proyecto: ${values.hasProject || 'N/A'}. Detalles: ${values.details}`,
                files: values.files || [],
            });

            toast({
                title: "Solicitud Recibida",
                description: "Un especialista en Obra Nueva te contactará en 24h.",
            });

            if (onSuccess) onSuccess();

        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: "Error", description: "Inténtalo de nuevo." });
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <FormField control={form.control} name="hasLand" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-lg">{t.budgetRequest.newBuild?.hasLand?.label}</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue placeholder={t.budgetRequest.form.quality.placeholder} /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="yes">{t.budgetRequest.newBuild?.hasLand?.yes}</SelectItem>
                                            <SelectItem value="no">{t.budgetRequest.newBuild?.hasLand?.no}</SelectItem>
                                            <SelectItem value="searching">{t.budgetRequest.newBuild?.hasLand?.searching}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            {hasLand === 'yes' && (
                                <FormField control={form.control} name="hasProject" render={({ field }) => (
                                    <FormItem className="mt-4">
                                        <FormLabel>{t.budgetRequest.newBuild?.hasProject?.label}</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl><SelectTrigger><SelectValue placeholder={t.budgetRequest.form.quality.placeholder} /></SelectTrigger></FormControl>
                                            <SelectContent>
                                                <SelectItem value="yes">{t.budgetRequest.newBuild?.hasProject?.yes}</SelectItem>
                                                <SelectItem value="no">{t.budgetRequest.newBuild?.hasProject?.no}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            )}
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                            <FormField control={form.control} name="location" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t.budgetRequest.newBuild?.location?.label}</FormLabel>
                                    <FormControl><Input placeholder={t.budgetRequest.newBuild?.location?.placeholder} {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="approxMeters" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t.budgetRequest.newBuild?.approxMeters?.label} ({field.value} m²)</FormLabel>
                                    <FormControl>
                                        <input
                                            type="range"
                                            min="50"
                                            max="1000"
                                            step="10"
                                            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="details" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t.budgetRequest.newBuild?.details?.label}</FormLabel>
                                    <FormControl><Input placeholder={t.budgetRequest.newBuild?.details?.placeholder} {...field} /></FormControl>
                                </FormItem>
                            )} />

                            <FormField
                                control={form.control}
                                name="files"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t.budgetRequest.multimedia.title}</FormLabel>
                                        <FormControl>
                                            <SimpleFileUpload
                                                value={field.value}
                                                onChange={field.onChange}
                                                maxFiles={5}
                                                accept={{
                                                    'image/*': [],
                                                    'application/pdf': []
                                                }}
                                                description={t.budgetRequest.multimedia.dragDrop}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </motion.div>
                    )}

                    {step === 3 && (
                        <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                            <VerifiedContactBanner show={isLeadVerified} />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="flex items-center gap-1.5">
                                            {t.budgetRequest.form.name.label} <VerifiedFieldIcon show={isLeadVerified} />
                                        </FormLabel>
                                        <FormControl><Input {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="phone" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="flex items-center gap-1.5">
                                            {t.budgetRequest.form.phone.label} <VerifiedFieldIcon show={isLeadVerified} />
                                        </FormLabel>
                                        <FormControl><Input {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center gap-1.5">
                                        {t.budgetRequest.form.email.label} <VerifiedFieldIcon show={isLeadVerified} />
                                    </FormLabel>
                                    <FormControl><Input {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </motion.div>
                    )}
                </AnimatePresence>



                <div className="flex justify-between pt-4 border-t">
                    {step > 1 ? (
                        <Button type="button" variant="ghost" onClick={prevStep}><ArrowLeft className="mr-2 h-4 w-4" /> {t.budgetRequest.form.buttons.prev}</Button>
                    ) : (
                        onBack && <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> {t.budgetRequest.form.buttons.prev}</Button>
                    )}

                    {step < 3 ? (
                        <Button type="button" onClick={nextStep}>{t.budgetRequest.form.buttons.next} <ArrowRight className="ml-2 h-4 w-4" /></Button>
                    ) : (
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t.budgetRequest.newBuild?.submit}
                        </Button>
                    )}
                </div>
            </form >
        </Form >
    );
}
