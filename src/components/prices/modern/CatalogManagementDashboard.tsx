'use client';

import { useCallback, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LatestMaterialsList } from './LatestMaterialsList';
import { SearchMaterialParams } from '@/components/prices/modern/SearchMaterialParams';
import { MaterialCatalogBrowser } from '@/components/prices/modern/MaterialCatalogBrowser';
import { MaterialPriceRulesManager } from '@/components/prices/rules/MaterialPriceRulesManager';
import { ClientRulesSection } from '@/components/prices/rules/ClientRulesSection';
import { Package, SlidersHorizontal, Users } from 'lucide-react';

export function CatalogManagementDashboard() {
    // Bump para forzar el remount de las vistas que calculan precio efectivo
    // cuando cambian las reglas desde el gestor o la sección de cliente.
    const [rulesVersion, setRulesVersion] = useState(0);
    const bumpRules = useCallback(() => setRulesVersion((v) => v + 1), []);

    return (
        <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400">
                        <Package className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Catálogo de Materiales</h1>
                        <p className="text-muted-foreground">
                            Gestión y consulta de productos ingestados (Obramat) y reglas de ajuste de precio.
                        </p>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="materials" className="w-full">
                <TabsList>
                    <TabsTrigger value="materials" className="gap-2">
                        <Package className="h-4 w-4" /> Materiales
                    </TabsTrigger>
                    <TabsTrigger value="rules" className="gap-2">
                        <SlidersHorizontal className="h-4 w-4" /> Reglas de precio
                    </TabsTrigger>
                    <TabsTrigger value="clients" className="gap-2">
                        <Users className="h-4 w-4" /> Por cliente
                    </TabsTrigger>
                </TabsList>

                {/* Materiales: buscador + explorador paginado + últimos ingestados */}
                <TabsContent value="materials" className="mt-6 space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Buscador Semántico</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <SearchMaterialParams key={`search-${rulesVersion}`} />
                        </CardContent>
                    </Card>

                    <MaterialCatalogBrowser key={`browser-${rulesVersion}`} onRulesChanged={bumpRules} />

                    <LatestMaterialsList key={`latest-${rulesVersion}`} />
                </TabsContent>

                {/* Reglas de precio */}
                <TabsContent value="rules" className="mt-6">
                    <MaterialPriceRulesManager onRulesChanged={bumpRules} />
                </TabsContent>

                {/* Por cliente */}
                <TabsContent value="clients" className="mt-6">
                    <ClientRulesSection onRulesChanged={bumpRules} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
