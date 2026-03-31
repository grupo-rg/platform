'use client';

import { useState, useEffect } from 'react';
import { getLeadsAction, getLeadStatsAction, LeadTableRow } from '@/actions/lead/dashboard.action';
import { Users, UserCheck, Sparkles, Search, ChevronDown } from 'lucide-react';
import { LeadDetailsSheet } from './lead-details-sheet';

function StatusBadge({ verified, profiled }: { verified: boolean; profiled: boolean }) {
    if (profiled) {
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Sparkles className="w-3 h-3" /> Perfilado
            </span>
        );
    }
    if (verified) {
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <UserCheck className="w-3 h-3" /> Verificado
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Pendiente
        </span>
    );
}

const PAIN_LABELS: Record<string, string> = {
    'budgeting': 'Presupuestos',
    'cost-control': 'Control costes',
    'certifications': 'Certificaciones'
};

const ROLE_LABELS: Record<string, string> = {
    'owner': 'Gerente',
    'project-manager': 'Dir. Obra',
    'admin': 'Admin',
    'surveyor': 'Aparejador'
};

export function LeadsTable() {
    const [leads, setLeads] = useState<LeadTableRow[]>([]);
    const [stats, setStats] = useState({ verified: 0, unverified: 0, profiled: 0 });
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'verified' | 'profiled' | 'pending'>('all');
    const [search, setSearch] = useState('');
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            setLoading(true);
            const [leadsData, statsData] = await Promise.all([
                getLeadsAction(100, 0),
                getLeadStatsAction()
            ]);
            setLeads(leadsData);
            setStats(statsData);
            setLoading(false);
        }
        load();
    }, []);

    const filteredLeads = leads.filter(lead => {
        const matchesSearch = search === '' ||
            lead.name.toLowerCase().includes(search.toLowerCase()) ||
            lead.email.toLowerCase().includes(search.toLowerCase()) ||
            lead.companyName?.toLowerCase().includes(search.toLowerCase());

        const matchesFilter = filter === 'all' ||
            (filter === 'profiled' && lead.isProfiled) ||
            (filter === 'verified' && lead.isVerified && !lead.isProfiled) ||
            (filter === 'pending' && !lead.isVerified);

        return matchesSearch && matchesFilter;
    });

    const total = stats.verified + stats.unverified + stats.profiled;

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{total}</p>
                        <p className="text-sm text-muted-foreground">Total Leads</p>
                    </div>
                </div>
                <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
                        <UserCheck className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{stats.verified}</p>
                        <p className="text-sm text-muted-foreground">Verificados</p>
                    </div>
                </div>
                <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{stats.profiled}</p>
                        <p className="text-sm text-muted-foreground">Perfilados</p>
                    </div>
                </div>
            </div>

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, email o empresa…"
                        className="w-full pl-10 pr-4 py-2.5 bg-secondary/30 border border-border rounded-xl text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all text-sm"
                    />
                </div>
                <div className="relative">
                    <select
                        value={filter}
                        onChange={e => setFilter(e.target.value as any)}
                        className="appearance-none pl-4 pr-10 py-2.5 bg-secondary/30 border border-border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
                    >
                        <option value="all">Todos</option>
                        <option value="verified">Verificados</option>
                        <option value="profiled">Perfilados</option>
                        <option value="pending">Pendientes</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-secondary/20">
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Nombre</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Email</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teléfono</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Estado</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Dolor</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Rol</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Empresa</th>
                                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Fecha</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <td key={j} className="px-5 py-4">
                                                <div className="h-4 bg-secondary/50 rounded animate-pulse w-24" />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredLeads.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                                        No se encontraron leads.
                                    </td>
                                </tr>
                            ) : (
                                filteredLeads.map(lead => (
                                    <tr
                                        key={lead.id}
                                        className="hover:bg-secondary/10 transition-colors cursor-pointer"
                                        onClick={() => setSelectedLeadId(lead.id)}
                                    >
                                        <td className="px-5 py-4 font-medium text-sm">{lead.name}</td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground">{lead.email}</td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground hidden md:table-cell">{lead.phone || '—'}</td>
                                        <td className="px-5 py-4">
                                            <StatusBadge verified={lead.isVerified} profiled={lead.isProfiled} />
                                        </td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                                            {lead.biggestPain ? (
                                                <div className="flex gap-1 flex-wrap">
                                                    {lead.biggestPain.split(', ').map(p => (
                                                        <span key={p} className="px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-xs font-medium">
                                                            {PAIN_LABELS[p] || p}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                                            {lead.role ? (
                                                <span className="text-xs">{ROLE_LABELS[lead.role] || lead.role}</span>
                                            ) : '—'}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground hidden xl:table-cell">{lead.companyName || '—'}</td>
                                        <td className="px-5 py-4 text-sm text-muted-foreground hidden xl:table-cell">
                                            {new Date(lead.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Lead Details Slide-over */}
            <LeadDetailsSheet
                leadId={selectedLeadId}
                open={!!selectedLeadId}
                onOpenChange={(open) => !open && setSelectedLeadId(null)}
                onDeleted={(deletedId) => {
                    const deletedLead = leads.find(l => l.id === deletedId);
                    setLeads(prev => prev.filter(l => l.id !== deletedId));
                    if (deletedLead) {
                        setStats(prev => ({
                            verified: prev.verified - (deletedLead.isVerified && !deletedLead.isProfiled ? 1 : 0),
                            profiled: prev.profiled - (deletedLead.isProfiled ? 1 : 0),
                            unverified: prev.unverified - (!deletedLead.isVerified && !deletedLead.isProfiled ? 1 : 0)
                        }));
                    }
                }}
            />
        </div>
    );
}
