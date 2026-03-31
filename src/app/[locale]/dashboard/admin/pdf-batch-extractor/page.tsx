import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, Folder, ChevronRight, Activity } from 'lucide-react';
import Link from 'next/link';
import { PdfBatchConfigurator } from '@/components/admin/PdfBatchConfigurator';

export const metadata = {
    title: 'Extracción Batch PDF | NexoAI Admin',
    description: 'Configurador de extracción de Libro de Precios',
};

export default async function PdfExtractorDashboardPage() {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Hero Section */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-black p-8 text-white shadow-2xl border border-white/5">
                <div className="absolute top-0 right-0 -mt-20 -mr-20 h-80 w-80 rounded-full bg-blue-600/10 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl"></div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm text-indigo-200 font-medium">
                            <Link href="/dashboard/admin" className="hover:text-white transition-colors">Admin</Link>
                            <ChevronRight className="w-4 h-4" />
                            <span className="text-white">Batch Extractor</span>
                        </div>
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold font-headline tracking-tight text-white flex items-center gap-3">
                                <Database className="w-8 h-8 text-indigo-400" />
                                Ingesta de Catálogo PDF
                            </h1>
                            <p className="text-zinc-400 max-w-2xl mt-2 text-lg">
                                Configura la extracción estructural y económica del Libro de Precios 2025 usando Google Vertex Batch API y Gemini Flash 2.5.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 px-3 py-1 text-sm font-medium backdrop-blur-md">
                            <Activity className="w-3 h-3 mr-2 inline-block" /> Sistema Operativo
                        </Badge>
                    </div>
                </div>
            </div>

            {/* Interactive Client Component */}
            <PdfBatchConfigurator />

        </div>
    );
}
