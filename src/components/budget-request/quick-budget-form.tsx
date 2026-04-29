
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, MailCheck, RotateCw, Star } from 'lucide-react';
import Link from 'next/link';
import { SimpleFileUpload } from '@/components/ui/simple-file-upload';
import { createBudgetAction } from '@/actions/budget/create-budget.action';
import { useVerifiedLead } from '@/hooks/use-verified-lead';
import { VerifiedContactBanner, VerifiedFieldIcon } from '@/components/forms/verified-contact-banner';

const pricingConfig = {
  integral: { basic: 400, medium: 600, premium: 800 },
  bathrooms: { basic: 1100, medium: 1250, premium: 1750 },
  kitchen: { basic: 621, medium: 700, premium: 760 },
};

// Extend schema with files
const formSchema = z.object({
  name: z.string().min(2, { message: 'El nombre es obligatorio.' }),
  email: z.string().email({ message: 'Por favor, introduce un correo electrónico válido.' }),
  phone: z.string().min(9, { message: 'Por favor, introduce un número de teléfono válido.' }),
  address: z.string().min(5, { message: 'La dirección del proyecto es necesaria.' }),
  renovationType: z.enum(['integral', 'bathrooms', 'kitchen', 'pool']),
  squareMeters: z.coerce.number().min(1, 'La superficie debe ser de al menos 1 m²'),
  quality: z.enum(['basic', 'medium', 'premium']),
  testEmail: z.string().email({ message: 'Introduce un email de prueba válido.' }).optional().or(z.literal('')),
  files: z.array(z.string()).optional(),
  description: z.string().optional(),
});

type QuickFormValues = z.infer<typeof formSchema>;

export function QuickBudgetForm({ t, onBack }: { t: any; onBack?: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [calculatedBudget, setCalculatedBudget] = useState<number | null>(null);

  // Precarga datos del lead verificado por OTP (si existen).
  const { lead: verifiedLead, isReady: isLeadVerified } = useVerifiedLead();

  const form = useForm<QuickFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      address: '',
      renovationType: 'kitchen',
      squareMeters: 1,
      quality: 'basic',
      testEmail: '',
      files: [],
      description: ''
    },
  });

  // Precarga campos cuando el lead verificado llega (solo si están vacíos).
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
    // No queremos re-trigger por cambios del form mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedLead?.id]);

  const watchRenovationType = form.watch('renovationType');
  const tInclusions = t.budgetRequest.reformInclusions;
  const inclusionItems = tInclusions[watchRenovationType] || [];


  async function handleFormSubmit(values: QuickFormValues) {
    setIsLoading(true);
    try {
      let budget = null;
      if (values.renovationType !== 'pool') {
        const prices = pricingConfig[values.renovationType as keyof typeof pricingConfig];
        budget = values.squareMeters * prices[values.quality as keyof typeof prices];
        setCalculatedBudget(budget);
      }

      // Registra la solicitud como Lead cualificable. El listener
      // NotifyAdminOnLeadCreatedUseCase envía el email al admin vía Resend.
      await createBudgetAction('quick', {
        name: values.name,
        email: values.email,
        phone: values.phone,
        address: values.address,
        description: values.description || `Solicitud Web: ${values.renovationType} - ${values.squareMeters}m2 - ${values.quality}`,
        files: values.files || [],
        renovationType: values.renovationType,
        squareMeters: values.squareMeters,
        quality: values.quality,
      } as any);

      toast({
        title: t.budgetRequest.form.toast.success.title,
        description: t.budgetRequest.form.toast.success.description,
      });
      setIsSubmitted(true);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: t.budgetRequest.form.toast.error.title,
        description: t.budgetRequest.form.toast.error.description,
      });
    } finally {
      setIsLoading(false);
    }
  }

  const handleRestart = () => {
    form.reset();
    setIsSubmitted(false);
    setCalculatedBudget(null);
  }

  if (isSubmitted) {
    const isPool = watchRenovationType === 'pool';
    const reviewLink = "#"; // Replace with your GMB review link

    return (
      <div className="text-center max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <div className='mx-auto bg-primary/10 p-4 rounded-full w-fit mb-4'>
              <MailCheck className='w-12 h-12 text-primary' />
            </div>
            <CardTitle className="font-headline text-3xl">{t.budgetRequest.confirmation.title}</CardTitle>
            <CardDescription className="text-lg">{t.budgetRequest.confirmation.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {isPool ? (
              <p className="text-muted-foreground mt-4">{t.budgetRequest.confirmation.poolMessage}</p>
            ) : (
              <>
                <p className='text-muted-foreground text-lg'>Tu presupuesto estimado es:</p>
                <p className='font-headline text-4xl font-bold text-primary my-4'>
                  {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(calculatedBudget || 0)}
                </p>
                <p className="text-muted-foreground mt-4 text-sm">{t.budgetRequest.confirmation.noCostMessage}</p>
              </>
            )}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
              <Button asChild>
                <a href='/'>{t.budgetRequest.confirmation.button}</a>
              </Button>
              <Button variant="outline" onClick={handleRestart}>
                <RotateCw className="mr-2 h-4 w-4" />
                {t.budgetRequest.confirmation.restartForm}
              </Button>
            </div>
            <div className="mt-8">
              <Button asChild variant="secondary">
                <Link href={reviewLink} target="_blank" rel="noopener noreferrer">
                  <Star className="mr-2 h-4 w-4" />
                  {t.budgetRequest.confirmation.reviewButton}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='w-full max-w-5xl mx-auto text-left'>
      <Card>
        <CardHeader className="relative">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="absolute left-4 top-4 md:left-6 md:top-6"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <CardTitle className='font-headline text-2xl text-center pt-2'>{t.budgetRequest.quickForm.title}</CardTitle>
          <CardDescription className='text-center'>{t.budgetRequest.quickForm.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-8">
              <VerifiedContactBanner show={isLeadVerified} />

              <div className="grid md:grid-cols-2 gap-6">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      {t.budgetRequest.form.name.label}
                      <VerifiedFieldIcon show={isLeadVerified} />
                    </FormLabel>
                    <FormControl><Input placeholder={t.budgetRequest.form.name.placeholder} {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      {t.budgetRequest.form.email.label}
                      <VerifiedFieldIcon show={isLeadVerified} />
                    </FormLabel>
                    <FormControl><Input type="email" placeholder={t.budgetRequest.form.email.placeholder} {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      {t.budgetRequest.form.phone.label}
                      <VerifiedFieldIcon show={isLeadVerified} />
                    </FormLabel>
                    <FormControl><Input placeholder={t.budgetRequest.form.phone.placeholder} {...field} readOnly={isLeadVerified} className={isLeadVerified ? 'bg-muted/40' : ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem><FormLabel>{t.budgetRequest.form.address.label}</FormLabel><FormControl><Input placeholder={t.budgetRequest.form.address.placeholder} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className={`grid ${watchRenovationType === 'pool' ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-6`}>
                <FormField control={form.control} name="renovationType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.budgetRequest.quickForm.renovationType.label}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="integral">{t.budgetRequest.quickForm.renovationType.options.integral}</SelectItem>
                        <SelectItem value="bathrooms">{t.budgetRequest.quickForm.renovationType.options.bathrooms}</SelectItem>
                        <SelectItem value="kitchen">{t.budgetRequest.quickForm.renovationType.options.kitchen}</SelectItem>
                        <SelectItem value="pool">{t.budgetRequest.quickForm.renovationType.options.pool}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="squareMeters" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.budgetRequest.quickForm.squareMeters.label}</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {watchRenovationType !== 'pool' && (
                  <FormField control={form.control} name="quality" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.budgetRequest.form.quality.label}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t.budgetRequest.form.quality.placeholder} /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="basic">{t.budgetRequest.form.quality.options.basic}</SelectItem>
                          <SelectItem value="medium">{t.budgetRequest.form.quality.options.medium}</SelectItem>
                          <SelectItem value="premium">{t.budgetRequest.form.quality.options.premium}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              {inclusionItems.length > 0 && (
                <div className='p-6 bg-secondary/50 rounded-lg'>
                  <h3 className='font-semibold mb-4 text-center'>{tInclusions.title} {t.budgetRequest.quickForm.renovationType.options[watchRenovationType as keyof typeof t.budgetRequest.quickForm.renovationType.options]}:</h3>
                  <ul className='grid md:grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted-foreground'>
                    {inclusionItems.map((item: string, index: number) => (
                      <li key={index} className='flex items-start'>
                        <Check className='w-4 h-4 mr-2 mt-0.5 text-primary flex-shrink-0' />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.budgetRequest.quickForm.additionalDetails.label}</FormLabel>
                      <FormControl><Input placeholder={t.budgetRequest.quickForm.additionalDetails.placeholder} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          description={t.budgetRequest.multimedia.dragDrop}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end items-center gap-4 mt-8">
                <FormField control={form.control} name="testEmail" render={({ field }) => (
                  <FormItem className="w-full sm:w-auto sm:min-w-64">
                    <FormControl><Input type="email" placeholder="email@de-prueba.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={isLoading} size="lg" className='w-full sm:w-auto'>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isLoading ? t.budgetRequest.form.buttons.loading : t.budgetRequest.form.buttons.submit}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
