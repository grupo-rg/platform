import Link from 'next/link';
import { Users, Columns, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CRMKanban } from '@/components/dashboard/leads/crm-kanban';
import { LeadsInbox } from '@/components/dashboard/leads/leads-inbox';
import { cn } from '@/lib/utils';
import type { LeadIntakeSource, QualificationDecision } from '@/backend/lead/domain/lead';

interface PageProps {
    searchParams: Promise<{ tab?: string; decision?: string; source?: string; q?: string }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
    const sp = await searchParams;
    const activeTab = sp.tab === 'pipeline' ? 'pipeline' : 'inbox';

    const decisions = sp.decision
        ? (sp.decision.split(',').filter(Boolean) as QualificationDecision[])
        : undefined;
    const sources = sp.source
        ? (sp.source.split(',').filter(Boolean) as LeadIntakeSource[])
        : undefined;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-8 text-white shadow-2xl">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2">
                        <Badge className="bg-white/10 text-purple-200 hover:bg-white/20 border-purple-500/30 backdrop-blur-md mb-2">
                            <Users className="w-3 h-3 mr-1 text-purple-300" /> CRM
                        </Badge>
                        <h1 className="text-4xl font-bold font-headline tracking-tight">
                            Leads & <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-indigo-200">Pipeline</span>
                        </h1>
                        <p className="text-purple-100/80 max-w-xl text-lg">
                            Revisa solicitudes entrantes y haz avanzar las oportunidades por el pipeline comercial.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid w-full grid-cols-2 max-w-md rounded-md border bg-muted p-1 text-muted-foreground">
                <TabLink href="/dashboard/leads?tab=inbox" active={activeTab === 'inbox'}>
                    <Inbox className="w-4 h-4 mr-2" />
                    Inbox
                </TabLink>
                <TabLink href="/dashboard/leads?tab=pipeline" active={activeTab === 'pipeline'}>
                    <Columns className="w-4 h-4 mr-2" />
                    Pipeline
                </TabLink>
            </div>

            {activeTab === 'inbox' ? (
                <LeadsInbox decisions={decisions} sources={sources} textQuery={sp.q} />
            ) : (
                <CRMKanban />
            )}
        </div>
    );
}

function TabLink({
    href,
    active,
    children,
}: {
    href: string;
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'hover:bg-background/50 hover:text-foreground'
            )}
        >
            {children}
        </Link>
    );
}
