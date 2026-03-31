import { LeadsTable } from '@/components/dashboard/leads/leads-table';
import { CRMKanban } from '@/components/dashboard/leads/crm-kanban';
import { Users, Columns, List } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LeadsPage() {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-8 text-white shadow-2xl">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2">
                        <Badge className="bg-white/10 text-purple-200 hover:bg-white/20 border-purple-500/30 backdrop-blur-md mb-2">
                            <Users className="w-3 h-3 mr-1 text-purple-300" /> CRM
                        </Badge>
                        <h1 className="text-4xl font-bold font-headline tracking-tight">
                            Pipeline & <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-indigo-200">Leads</span>
                        </h1>
                        <p className="text-purple-100/80 max-w-xl text-lg">
                            Gestiona tu embudo de ventas y observa cómo los leads avanzan desde la Demo Pública al Cierre.
                        </p>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="kanban" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-md bg-slate-900/50 border border-slate-800">
                    <TabsTrigger value="kanban" className="data-[state=active]:bg-purple-600">
                        <Columns className="w-4 h-4 mr-2" />
                        Tablero Kanban
                    </TabsTrigger>
                    <TabsTrigger value="table" className="data-[state=active]:bg-purple-600">
                        <List className="w-4 h-4 mr-2" />
                        Tabla Tradicional
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="kanban" className="mt-6 border-none p-0">
                    <CRMKanban />
                </TabsContent>
                <TabsContent value="table" className="mt-6 border-none p-0">
                    <LeadsTable />
                </TabsContent>
            </Tabs>

        </div>
    );
}
