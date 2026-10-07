'use client';

import { useState, useTransition } from 'react';
import { Copy, Loader2, MailPlus, Ban, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
    ASSIGNABLE_ROLES,
    INVITABLE_ROLES,
    PLATFORM_ROLE_LABELS,
    canAssignRole,
    type PlatformRole,
} from '@/backend/auth/roles';
import {
    changeUserRoleAction,
    inviteUserAction,
    listUsersAction,
    revokeInvitationAction,
    setUserDisabledAction,
} from '@/actions/users/user-management.action';
import type { ManagedUser, PendingInvitation } from '@/backend/auth/user-management.service';

const dateFmt = (iso: string | number | null) =>
    iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const roleVariant = (role: PlatformRole): 'default' | 'secondary' | 'outline' | 'destructive' =>
    role === 'super-admin' ? 'default' : role === 'admin' ? 'secondary' : role === 'encargado' ? 'outline' : 'destructive';

export function UsersClient({
    locale,
    me,
    initialUsers,
    initialInvitations,
}: {
    locale: string;
    me: { uid: string; platformRole: PlatformRole };
    initialUsers: ManagedUser[];
    initialInvitations: PendingInvitation[];
}) {
    const { toast } = useToast();
    const [users, setUsers] = useState(initialUsers);
    const [invitations, setInvitations] = useState(initialInvitations);
    const [pending, startTransition] = useTransition();
    const [busyUid, setBusyUid] = useState<string | null>(null);

    const [email, setEmail] = useState('');
    const [role, setRole] = useState<PlatformRole>('encargado');
    const [sendEmail, setSendEmail] = useState(true);
    const [lastLink, setLastLink] = useState<string | null>(null);

    const invitableRoles = INVITABLE_ROLES.filter(r => canAssignRole(me.platformRole, r));

    const reload = async () => {
        const res = await listUsersAction();
        if (res.success) {
            setUsers(res.data.users);
            setInvitations(res.data.invitations);
        }
    };

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast({ title: 'Enlace copiado' });
        } catch {
            toast({ title: 'No se pudo copiar', description: 'Selecciona el enlace y cópialo a mano.', variant: 'destructive' });
        }
    };

    const onInvite = () => {
        startTransition(async () => {
            const res = await inviteUserAction({ email, role, locale, sendEmail });
            if (!res.success) {
                toast({ title: 'No se pudo invitar', description: res.error, variant: 'destructive' });
                return;
            }
            setLastLink(res.data.link);
            setEmail('');
            toast({
                title: 'Invitación creada',
                description: sendEmail
                    ? res.data.emailSent ? 'Email enviado. También puedes copiar el enlace.' : `No se pudo enviar el email (${res.data.emailError}). Copia el enlace y envíaselo.`
                    : 'Copia el enlace y envíaselo.',
                variant: sendEmail && !res.data.emailSent ? 'destructive' : undefined,
            });
            await reload();
        });
    };

    const onRevokeInvitation = (id: string) => {
        startTransition(async () => {
            const res = await revokeInvitationAction(id);
            if (!res.success) {
                toast({ title: 'No se pudo anular', description: res.error, variant: 'destructive' });
                return;
            }
            setInvitations(prev => prev.filter(i => i.id !== id));
        });
    };

    const onChangeRole = async (u: ManagedUser, next: PlatformRole) => {
        if (next === u.platformRole) return;
        if (!window.confirm(`¿Cambiar el rol de ${u.email} a "${PLATFORM_ROLE_LABELS[next]}"? Se cerrarán sus sesiones.`)) return;
        setBusyUid(u.uid);
        try {
            const res = await changeUserRoleAction(u.uid, next);
            if (!res.success) {
                toast({ title: 'No se pudo cambiar el rol', description: res.error, variant: 'destructive' });
                return;
            }
            setUsers(prev => prev.map(x => (x.uid === u.uid ? res.data : x)));
            toast({ title: 'Rol actualizado', description: `${u.email}: ${PLATFORM_ROLE_LABELS[next]}` });
        } finally {
            setBusyUid(null);
        }
    };

    const onToggleDisabled = async (u: ManagedUser) => {
        const next = !u.disabled;
        if (next && !window.confirm(`¿Desactivar a ${u.email}? No podrá iniciar sesión y se cerrarán sus sesiones.`)) return;
        setBusyUid(u.uid);
        try {
            const res = await setUserDisabledAction(u.uid, next);
            if (!res.success) {
                toast({ title: 'No se pudo actualizar', description: res.error, variant: 'destructive' });
                return;
            }
            setUsers(prev => prev.map(x => (x.uid === u.uid ? res.data : x)));
        } finally {
            setBusyUid(null);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Invitar usuario</CardTitle>
                    <CardDescription>
                        Genera un enlace personal (caduca en 7 días, de un solo uso) para el email indicado.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
                        <div className="space-y-2">
                            <Label htmlFor="invite-email">Email</Label>
                            <Input id="invite-email" type="email" placeholder="persona@empresa.com" value={email} onChange={e => setEmail(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Rol</Label>
                            <Select value={role} onValueChange={v => setRole(v as PlatformRole)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {invitableRoles.map(r => (
                                        <SelectItem key={r} value={r}>{PLATFORM_ROLE_LABELS[r]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={onInvite} disabled={pending || !email.trim()}>
                            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
                            Invitar
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch id="invite-send-email" checked={sendEmail} onCheckedChange={setSendEmail} />
                        <Label htmlFor="invite-send-email" className="font-normal">Enviar también por email</Label>
                    </div>
                    {lastLink && (
                        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                            <p className="text-xs text-muted-foreground">Enlace de invitación (solo se muestra ahora; no se puede recuperar después):</p>
                            <div className="flex gap-2">
                                <Input readOnly value={lastLink} onFocus={e => e.currentTarget.select()} className="font-mono text-xs" />
                                <Button variant="outline" size="icon" onClick={() => copy(lastLink)} aria-label="Copiar enlace">
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {invitations.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Invitaciones pendientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Rol</TableHead>
                                    <TableHead>Caduca</TableHead>
                                    <TableHead className="w-[60px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invitations.map(inv => (
                                    <TableRow key={inv.id}>
                                        <TableCell>{inv.email}</TableCell>
                                        <TableCell><Badge variant={roleVariant(inv.role)}>{PLATFORM_ROLE_LABELS[inv.role]}</Badge></TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{dateFmt(inv.expiresAt)}</TableCell>
                                        <TableCell>
                                            {canAssignRole(me.platformRole, inv.role) && (
                                                <Button variant="ghost" size="icon" onClick={() => onRevokeInvitation(inv.id)} disabled={pending} aria-label="Anular invitación">
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Usuarios ({users.length})</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Rol</TableHead>
                                <TableHead>Último acceso</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="w-[60px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map(u => {
                                const isMe = u.uid === me.uid;
                                const locked = isMe || !canAssignRole(me.platformRole, u.platformRole, u.platformRole);
                                const busy = busyUid === u.uid;
                                return (
                                    <TableRow key={u.uid} className={u.disabled ? 'opacity-60' : undefined}>
                                        <TableCell>
                                            <div className="font-medium">{u.email ?? u.uid}</div>
                                            {u.displayName && <div className="text-xs text-muted-foreground">{u.displayName}</div>}
                                            {isMe && <div className="text-xs text-muted-foreground">(tú)</div>}
                                        </TableCell>
                                        <TableCell className="min-w-[190px]">
                                            {locked ? (
                                                <Badge variant={roleVariant(u.platformRole)}>{PLATFORM_ROLE_LABELS[u.platformRole]}</Badge>
                                            ) : (
                                                <Select value={u.platformRole} onValueChange={v => onChangeRole(u, v as PlatformRole)} disabled={busy}>
                                                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {ASSIGNABLE_ROLES.filter(r => canAssignRole(me.platformRole, r, u.platformRole)).map(r => (
                                                            <SelectItem key={r} value={r}>{PLATFORM_ROLE_LABELS[r]}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{dateFmt(u.lastActiveAt ?? u.lastSignInAt)}</TableCell>
                                        <TableCell>
                                            {u.disabled ? <Badge variant="destructive">Desactivado</Badge> : <Badge variant="outline">Activo</Badge>}
                                        </TableCell>
                                        <TableCell>
                                            {!locked && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onToggleDisabled(u)}
                                                    disabled={busy}
                                                    aria-label={u.disabled ? 'Reactivar usuario' : 'Desactivar usuario'}
                                                    title={u.disabled ? 'Reactivar' : 'Desactivar'}
                                                >
                                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : u.disabled ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
