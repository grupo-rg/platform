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
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getSafeAuth } from '@/lib/firebase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, use } from 'react';
import { getDictionary } from '@/lib/dictionaries';
import { createServerSession } from '@/context/auth-context';

const formSchema = z.object({
  email: z.string().email({ message: 'Por favor, introduce un correo electrónico válido.' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres.' }),
});

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    getDictionary(locale as any).then(d => setDict(d.login));
  }, [locale]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const auth = getSafeAuth();
      const cred = await signInWithEmailAndPassword(auth, values.email, values.password);
      // Esperamos a la cookie `session` antes de navegar: el middleware y el
      // layout del panel la exigen y, si no, rebotarían de vuelta al login.
      const { ok } = await createServerSession(cred.user);
      if (!ok) throw new Error('No se pudo crear la sesión en el servidor. Inténtalo de nuevo.');
      toast({
        title: '¡Éxito!',
        description: 'Has iniciado sesión correctamente.',
      });
      router.push(`/${locale}/dashboard`);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al iniciar sesión',
        description: error.message || 'Ha ocurrido un error. Por favor, inténtalo de nuevo.',
      });
    }
  }

  if (!dict) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline text-2xl">{dict.title}</CardTitle>
        <CardDescription>{dict.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{dict.emailLabel}</FormLabel>
                  <FormControl>
                    <Input placeholder="tu@email.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{dict.passwordLabel}</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="********" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Iniciando...' : dict.button}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-center text-sm">
          {dict.noAccount}{' '}
          <Link href="/signup" className="underline">
            {dict.signupLink}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
