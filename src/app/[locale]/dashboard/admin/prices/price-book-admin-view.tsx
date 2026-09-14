'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriceBookDashboard } from "@/components/prices/modern/PriceBookDashboard";
import { CatalogManagementDashboard } from "@/components/prices/modern/CatalogManagementDashboard";
import { PriceBookUpdateWizard } from "@/components/prices/PriceBookUpdateWizard";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function PriceBookAdminView({ locale }: { locale: string }) {
    const searchParams = useSearchParams();
    const viewParam = searchParams.get("view");
    const initialTab = viewParam === "catalog" ? "catalog" : viewParam === "update" ? "update" : "price-book";
    const [currentTab, setCurrentTab] = useState(initialTab);

    // Sync state if URL changes (optional, but good for back button if we were pushing state)
    // For now just initial load is enough, but let's be reactive
    useEffect(() => {
        const view = searchParams.get("view");
        if (view === "catalog") setCurrentTab("catalog");
        else if (view === "update") setCurrentTab("update");
        else if (view === "price-book") setCurrentTab("price-book");
    }, [searchParams]);

    return (
        <div className="w-full h-full p-4 md:p-6 bg-muted/10">
            <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                    <TabsList>
                        <TabsTrigger value="price-book">Base de Precios (Partidas)</TabsTrigger>
                        <TabsTrigger value="catalog">Catálogo Obramat (Materiales)</TabsTrigger>
                        <TabsTrigger value="update">Actualizar libro</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="price-book" className="h-full mt-0">
                    <PriceBookDashboard />
                </TabsContent>

                <TabsContent value="catalog" className="h-full mt-0">
                    <CatalogManagementDashboard />
                </TabsContent>

                <TabsContent value="update" className="h-full mt-0 overflow-y-auto">
                    <PriceBookUpdateWizard />
                </TabsContent>
            </Tabs>
        </div>
    );
}
