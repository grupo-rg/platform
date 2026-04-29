'use client';

import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { ModernSidebar } from '@/components/layout/modern-sidebar';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

export function DashboardLayout({ children, t }: { children: React.ReactNode, t: any }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  // Auto-close mobile menu on route change
  React.useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // Determine if the current page should be full-width/app-like (no default padding)
  const isBudgetsEditView = pathname.includes('/budgets/') && pathname.includes('/edit');
  const isAppPage = pathname.includes('/admin/messages') ||
    pathname.includes('/assistant') || pathname.includes('/asistente') ||
    pathname.includes('/projects') ||
    isBudgetsEditView ||
    pathname.includes('/presupuesto');

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Importante: NO sincronizamos `user.uid` con el `leadId` del widget context.
  // Son dominios distintos: el widget existe para visitantes públicos
  // OTP-verificados (lead anónimo), mientras que el admin tiene su propia
  // identidad por Firebase Auth. Mezclarlos hacía que al volver a la home
  // el formulario público fetcheara el lead del admin en vez del lead OTP
  // del visitante. Si un componente del dashboard necesita el UID, debe
  // leerlo de `useAuth()` directamente, no del widget context.

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-white">
        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-yellow-500"></div>
      </div>
    );
  }

  return (
    // Dashboard Layout with dynamic theme support
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-yellow-500/30">

      {/* Sidebar - Desktop */}
      <div className="hidden md:block">
        <ModernSidebar t={t} />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">

        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2">
            {mounted ? (
              <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="-ml-2">
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 border-r-0">
                  <SheetTitle className="sr-only">Menú de Navegación</SheetTitle>
                  <ModernSidebar t={t} className="w-full h-full border-none" />
                </SheetContent>
              </Sheet>
            ) : (
              <Button variant="ghost" size="icon" className="-ml-2">
                <Menu className="h-6 w-6" />
              </Button>
            )}
            <span className="font-semibold text-lg">Basis</span>
          </div>
          {/* We could add user menu or other actions here for mobile */}
        </div>

        {/* Children Content */}
        <div className={cn(
          "flex-1 min-h-0",
          isAppPage ? "overflow-hidden p-0" : "overflow-y-auto custom-scrollbar p-4 md:p-8 lg:p-10"
        )}>
          {children}
        </div>
      </main>
    </div>
  );
}
