'use client';

import { useEffect } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { DetailedFormValues } from '../schema';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { User, Mail, Phone, MapPin } from 'lucide-react';
import { useVerifiedLead } from '@/hooks/use-verified-lead';
import { VerifiedContactBanner, VerifiedFieldIcon } from '@/components/forms/verified-contact-banner';
import { cn } from '@/lib/utils';

interface ContactStepProps {
  form: UseFormReturn<DetailedFormValues>;
  t: any;
}

export const ContactStep = ({ form, t }: ContactStepProps) => {
  const commonT = t.budgetRequest.form;
  const { lead: verifiedLead, isReady: isLeadVerified } = useVerifiedLead();

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

  const inputClass = cn('bg-white/50', isLeadVerified && 'bg-muted/40');

  return (
    <div className="space-y-6 text-left animate-in fade-in-50 duration-500">
      {isLeadVerified ? (
        <VerifiedContactBanner show />
      ) : (
        <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 mb-6">
          <h3 className="font-semibold text-blue-900 mb-1">{commonT.contact.banner.title}</h3>
          <p className="text-sm text-blue-700">{commonT.contact.banner.description}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className='flex-1'>
              <FormLabel className='flex items-center gap-2'>
                <User className="w-4 h-4 text-primary" /> {commonT.name.label}
                <VerifiedFieldIcon show={isLeadVerified} />
              </FormLabel>
              <FormControl><Input placeholder={commonT.name.placeholder} className={inputClass} {...field} readOnly={isLeadVerified} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className='flex-1'>
              <FormLabel className='flex items-center gap-2'>
                <Mail className="w-4 h-4 text-primary" /> {commonT.email.label}
                <VerifiedFieldIcon show={isLeadVerified} />
              </FormLabel>
              <FormControl><Input type="email" placeholder={commonT.email.placeholder} className={inputClass} {...field} readOnly={isLeadVerified} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel className='flex items-center gap-2'>
                <Phone className="w-4 h-4 text-primary" /> {commonT.phone.label}
                <VerifiedFieldIcon show={isLeadVerified} />
              </FormLabel>
              <FormControl><Input placeholder={commonT.phone.placeholder} className={inputClass} {...field} readOnly={isLeadVerified} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel className='flex items-center gap-2'><MapPin className="w-4 h-4 text-primary" /> {commonT.address.label}</FormLabel>
              <FormControl><Input placeholder={commonT.address.placeholder} className="bg-white/50" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
};
