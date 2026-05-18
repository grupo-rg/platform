'use client';

import { Project } from '@/backend/project/domain/project';
import { Expense } from '@/backend/expense/domain/expense';
import { ProjectHeader } from '@/components/projects/project-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectOverviewTab } from '@/components/projects/tabs/project-overview-tab';
import { ProjectPhasesTab } from '@/components/projects/tabs/project-phases-tab';
import { ProjectFinancialsTab } from '@/components/projects/tabs/project-financials-tab';
import { ProjectTeamTab } from '@/components/projects/tabs/project-team-tab';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface ProjectManagerClientProps {
    project: Project;
    expenses: Expense[];
    locale: string;
}

export function ProjectManagerClient({ project, expenses, locale }: ProjectManagerClientProps) {
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const isNew = searchParams.get('new') === 'true';

    useEffect(() => {
        if (isNew) {
            toast({
                title: "¡Proyecto creado correctamente!",
                description: "Ya puedes empezar a gestionar la obra.",
            });
        }
    }, [isNew, toast]);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <ProjectHeader project={project} locale={locale} />

            <Tabs defaultValue="overview" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2 md:w-auto md:inline-grid md:grid-cols-4 bg-zinc-100 dark:bg-zinc-800/50 p-1 h-auto rounded-xl">
                    <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm transition-all py-2">
                        Visión General
                    </TabsTrigger>
                    <TabsTrigger value="phases" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm transition-all py-2">
                        Fases y Cronograma
                    </TabsTrigger>
                    <TabsTrigger value="financials" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm transition-all py-2">
                        Económico
                    </TabsTrigger>
                    <TabsTrigger value="team" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm transition-all py-2">
                        Equipo
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6 focus-visible:outline-none">
                    <ProjectOverviewTab project={project} expenses={expenses} locale={locale} />
                </TabsContent>

                <TabsContent value="phases" className="space-y-6 focus-visible:outline-none">
                    <ProjectPhasesTab project={project} expenses={expenses} locale={locale} />
                </TabsContent>

                <TabsContent value="financials" className="space-y-6 focus-visible:outline-none">
                    <ProjectFinancialsTab project={project} expenses={expenses} locale={locale} />
                </TabsContent>

                <TabsContent value="team" className="space-y-6 focus-visible:outline-none">
                    <ProjectTeamTab project={project} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
