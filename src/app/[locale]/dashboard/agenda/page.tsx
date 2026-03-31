'use client';

import { CalendarDays, Settings, Calendar as CalendarIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookingCalendar } from '@/components/dashboard/agenda/booking-calendar';
import { AvailabilitySettings } from '@/components/dashboard/agenda/availability-settings';

export default function AgendaDashboardPage() {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-7xl mx-auto">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-8 text-white shadow-2xl">
                <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
                <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-2">
                        <Badge className="bg-white/10 text-purple-200 hover:bg-white/20 border-purple-500/30 backdrop-blur-md mb-2">
                            <CalendarDays className="w-3 h-3 mr-1 text-purple-300" /> CRM
                        </Badge>
                        <h1 className="text-4xl font-bold font-headline tracking-tight">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-indigo-200">Agenda</span>
                        </h1>
                        <p className="text-purple-100/80 max-w-xl text-lg">
                            Gestiona las reservas de reuniones y configura tu disponibilidad.
                        </p>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="calendar" className="w-full">
                <div className="flex items-center justify-between mb-8">
                    <TabsList className="bg-muted/50 p-1 w-full max-w-md grid grid-cols-2 rounded-xl">
                        <TabsTrigger value="calendar" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2.5">
                            <CalendarIcon className="w-4 h-4 mr-2" />
                            Calendario
                        </TabsTrigger>
                        <TabsTrigger value="config" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2.5">
                            <Settings className="w-4 h-4 mr-2" />
                            Configuración
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="calendar" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                    <BookingCalendar />
                </TabsContent>

                <TabsContent value="config" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                    <AvailabilitySettings />
                </TabsContent>
            </Tabs>
        </div>
    );
}
