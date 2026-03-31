import { Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AnalyticsPanel } from '@/components/dashboard/marketing/analytics-panel';

export default function MarketingDashboardPage() {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 p-8 text-white shadow-xl">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2">
                        <Badge className="bg-white/10 text-purple-200 hover:bg-white/20 border-purple-500/30 backdrop-blur-md mb-2">
                            <Target className="w-3 h-3 mr-1 text-purple-300" /> Automation
                        </Badge>
                        <h1 className="text-4xl font-bold font-headline tracking-tight">
                            Marketing & <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-indigo-200">Embudos</span>
                        </h1>
                        <p className="text-purple-100/80 max-w-xl text-lg">
                            Monitoriza los resultados del Test A/B de las secuencias de seguimiento (Email + WhatsApp) y controla la maquinaria de venta.
                        </p>
                    </div>
                </div>
            </div>

            <AnalyticsPanel />
        </div>
    );
}
