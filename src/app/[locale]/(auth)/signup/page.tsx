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
import { useAuth } from '@/hooks/use-auth';
import {
  acceptInvitationForExistingUserAction,
  acceptInvitationWithSignupAction,
  getInvitationPreviewAction,
  type InvitationPreview,
} from '@/actions/users/invitation-accept.action';

/**
 * Alta SOLO por invitación. Sin `?invite=<token>` válido no hay formulario.
 * La cuenta nueva se crea en servidor (admin SDK) al aceptar la invitación,
 * para que funcione aunque el alta pública esté desactivada en Firebase Auth.
 */

const newAccountSchema = z
  .object({
    password: z.string().min(8, { message: 'La contraseña debe tener al menos 8 caracteres.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

const existingAccountSchema = z.object({
  password: z.string().min(1, { message: 'Introduce tu contraseña.' }),
  confirmPassword: z.string().optional(),
});

export default function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const { locale } = use(params);
  const sp = use(searchParams);
  const token = typeof sp.invite === 'string' ? sp.invite : null;

  const [dict, setDict] = useState<any>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [checking, setChecking] = useState(!!token);

  useEffect(() => {
    getDictionary(locale as any).then(d => setDict(d.signup));
  }, [locale]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInvitationPreviewAction(token)
      .then(p => { if (!cancelled) setPreview(p); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (!dict) return null;

  const loginLink = (
    <div className="mt-4 text-center text-sm">
      {dict.hasAccount}{' '}
      <Link href="/login" className="underline">
        {dict.loginLink}
      </Link>
    </div>
  );

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-2xl">{dict.title}</CardTitle>
          <CardDescription>
            El acceso es solo por invitación. Si necesitas una cuenta, pide a un administrador que te envíe un enlace de invitación.
          </CardDescription>
        </CardHeader>
        <CardContent>{loginLink}</CardContent>
      </Card>
    );
  }

  if (checking || !preview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-2xl">{dict.title}</CardTitle>
          <CardDescription>Comprobando la invitación…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!preview.valid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-2xl">Invitación no válida</CardTitle>
          <CardDescription>{preview.message} El acceso es solo por invitación.</CardDescription>
        </CardHeader>
        <CardContent>{loginLink}</CardContent>
      </Card>
    );
  }

  return <InvitationForm token={token} locale={locale} preview={preview} dict={dict} footer={loginLink} />;
}

function InvitationForm({
  token,
  locale,
  preview,
  dict,
  footer,
}: {
  token: string;
  locale: string;
  preview: Extract<InvitationPreview, { valid: true }>;
  dict: any;
  footer: React.ReactNode;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const { refreshSession } = useAuth();
  const accountExists = preview.accountExists;

  const form = useForm<{ password: string; confirmPassword?: string }>({
    resolver: zodResolver(accountExists ? existingAccountSchema : newAccountSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: { password: string }) {
    const auth = getSafeAuth();
    try {
      if (accountExists) {
        // Demuestra la identidad con la contraseña actual y acepta.
        const cred = await signInWithEmailAndPassword(auth, preview.email, values.password);
        const idToken = await cred.user.getIdToken(true);
        const res = await acceptInvitationForExistingUserAction({ token, idToken });
        if (!res.success) throw new Error(res.error);
      } else {
        const res = await acceptInvitationWithSignupAction({ token, email: preview.email, password: values.password });
        if (!res.success) throw new Error(res.error);
      }
      // Aceptar revoca las sesiones previas: iniciamos sesión de nuevo para
      // obtener un token con el rol nuevo y crear la cookie de sesión.
      await signInWithEmailAndPassword(auth, preview.email, values.password);
      const ok = await refreshSession();
      if (!ok) throw new Error('No se pudo iniciar la sesión. Prueba a entrar desde el login.');
      toast({ title: 'Acceso activado', description: `Rol: ${preview.roleLabel}` });
      router.push(`/${locale}/dashboard`);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo aceptar la invitación',
        description: error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password'
          ? 'Contraseña incorrecta.'
          : error?.message || 'Ha ocurrido un error. Por favor, inténtalo de nuevo.',
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline text-2xl">{accountExists ? 'Aceptar invitación' : dict.title}</CardTitle>
        <CardDescription>
          Invitación para <strong>{preview.email}</strong> con el rol <strong>{preview.roleLabel}</strong>.
          {accountExists ? ' Ya tienes cuenta: introduce tu contraseña para aceptarla.' : ' Elige una contraseña para crear tu acceso.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{dict.emailLabel}</label>
              <Input value={preview.email} readOnly disabled />
            </div>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{dict.passwordLabel}</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="********" autoComplete={accountExists ? 'current-password' : 'new-password'} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!accountExists && (
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{dict.confirmPasswordLabel}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="********" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Activando acceso...' : accountExists ? 'Aceptar invitación' : dict.button}
            </Button>
          </form>
        </Form>
        {footer}
      </CardContent>
    </Card>
  );
}
