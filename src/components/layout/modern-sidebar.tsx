'use client';

import React, { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard,
    FileText,
    DollarSign,
    Settings,
    Search,
    ChevronRight,
    LogOut,
    Sparkles,
    Briefcase,
    MessageSquare,
    FileUp,
    Package,
    Building2,
    Receipt,
    BarChart3,
    HardHat,
    PanelLeftClose,
    PanelLeftOpen,
    Users,
    CalendarDays,
    TrendingUp,
    Bot,
} from 'lucide-react';
import Image from 'next/image';
import { ModeToggle } from '@/components/mode-toggle';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Logo } from '@/components/logo';

interface ModernSidebarProps {
    t: any;
    className?: string;
}

export function ModernSidebar({ t, className }: ModernSidebarProps) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    // Asistente IA es el ítem destacado: vive fuera de cualquier grupo y se renderiza primero
    // con un acento visual (color primario + fondo suave). Resto de módulos agrupados por función.
    const highlightItem = {
        href: '/dashboard/assistant' as const,
        label: t.dashboard.nav.aiAssistant || 'Asistente IA',
        icon: Sparkles,
    };

    const navGroups = [
        {
            label: 'Operación',
            items: [
                { href: '/dashboard', label: t.dashboard.nav.dashboard, icon: LayoutDashboard },
                { href: '/dashboard/admin/budgets', label: t.dashboard.nav.myBudgets, icon: FileText },
                { href: '/dashboard/projects', label: 'Obras', icon: Building2 },
                { href: '/dashboard/expenses', label: 'Facturas', icon: Receipt },
            ]
        },
        {
            label: 'Ventas',
            items: [
                { href: '/dashboard/leads', label: 'Leads', icon: Users },
                { href: '/dashboard/agenda', label: 'Agenda', icon: CalendarDays },
            ]
        },
        {
            label: 'Contenido',
            items: [
                { href: '/dashboard/seo-generator', label: t.dashboard.nav.seoGenerator, icon: Search },
                { href: '/dashboard/marketing', label: 'Marketing', icon: TrendingUp },
            ]
        },
        {
            label: 'Analítica',
            items: [
                { href: '/dashboard/analytics', label: 'Analíticas', icon: BarChart3 },
                { href: '/dashboard/admin/pipelines', label: 'Pipelines IA', icon: Bot },
                { href: '/dashboard/admin/messages', label: 'Mensajes', icon: MessageSquare },
            ]
        },
        {
            label: 'Configuración',
            items: [
                { href: '/dashboard/settings/company', label: 'Empresa', icon: Building2 },
                { href: '/dashboard/admin/prices', label: t.dashboard.nav.priceBook, icon: Briefcase },
                { href: '/dashboard/admin/prices?view=catalog', label: 'Catálogo', icon: Package },
                { href: '/dashboard/settings', label: t.dashboard.nav.settings, icon: Settings },
            ]
        }
    ];

    return (
        <aside
            className={cn(
                "h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out relative group/sidebar",
                collapsed ? "w-[68px]" : "w-64",
                className
            )}
        >
            {/* Toggle Button */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                    "absolute -right-3 top-20 z-50 w-6 h-6 rounded-full bg-sidebar border border-sidebar-border",
                    "flex items-center justify-center shadow-md",
                    "hover:bg-primary hover:text-primary-foreground hover:border-primary",
                    "transition-all duration-200 opacity-0 group-hover/sidebar:opacity-100"
                )}
            >
                {collapsed ? (
                    <PanelLeftOpen className="w-3 h-3" />
                ) : (
                    <PanelLeftClose className="w-3 h-3" />
                )}
            </button>

            {/* Logo Area — altura fija y contenido centrado vertical + horizontal
                para que el logo no "baile" con el collapsed toggle. */}
            <div className={cn("flex items-center justify-center px-4 h-14 transition-all duration-300", collapsed ? "" : "")}>
                <AnimatePresence mode="wait">
                    {collapsed ? (
                        <motion.div
                            key="icon"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.2 }}
                            className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20"
                        >
                            <HardHat className="w-5 h-5 text-white" />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="logo"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center justify-center"
                        >
                            <Logo className="h-7 object-contain" width={110} height={28} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="mx-3 border-t border-sidebar-border/50 my-3" />

            {/* Navigation */}
            <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden custom-scrollbar px-2">
                {/* Highlighted Asistente IA (top-level, fuera de grupos) */}
                {(() => {
                    const isActive = pathname === highlightItem.href || pathname.startsWith(highlightItem.href);
                    const Icon = highlightItem.icon;
                    return (
                        <Link
                            href={highlightItem.href as any}
                            title={collapsed ? highlightItem.label : undefined}
                            className={cn(
                                "relative flex items-center rounded-xl font-semibold transition-all duration-200 group/item overflow-hidden border",
                                collapsed ? "justify-center px-0 py-2.5 mx-auto w-11 h-11" : "gap-3 px-3 py-3",
                                isActive
                                    ? "text-primary bg-primary/15 border-primary/30 shadow-sm shadow-primary/10"
                                    : "text-primary bg-primary/5 border-primary/10 hover:bg-primary/10 hover:border-primary/20"
                            )}
                        >
                            <Icon className={cn(
                                "shrink-0",
                                collapsed ? "h-5 w-5" : "h-4 w-4",
                                "text-primary"
                            )} />
                            {!collapsed && (
                                <span className="truncate text-sm">{highlightItem.label}</span>
                            )}
                            {!collapsed && !isActive && (
                                <span className="ml-auto text-[9px] font-bold tracking-wider uppercase bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                                    IA
                                </span>
                            )}
                        </Link>
                    );
                })()}

                {navGroups.map((group, idx) => (
                    <div key={idx} className="space-y-1">
                        {/* Group Label */}
                        <AnimatePresence>
                            {!collapsed && (
                                <motion.h3
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="px-2 mb-2 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em]"
                                >
                                    {group.label}
                                </motion.h3>
                            )}
                        </AnimatePresence>

                        {/* Nav Items */}
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                                const Icon = item.icon;

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href as any}
                                        title={collapsed ? item.label : undefined}
                                        className={cn(
                                            "relative flex items-center rounded-lg text-sm font-medium transition-all duration-200 group/item overflow-hidden",
                                            collapsed ? "justify-center px-0 py-2.5 mx-auto w-11 h-11" : "gap-3 px-3 py-2.5",
                                            isActive
                                                ? "text-primary bg-primary/10"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                        )}
                                    >
                                        {isActive && (
                                            <motion.div
                                                layoutId="sidebar-active-pill"
                                                className={cn(
                                                    "absolute bg-primary rounded-r-full",
                                                    collapsed ? "left-0 w-[3px] h-5" : "left-0 w-1 h-6"
                                                )}
                                                initial={false}
                                                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                            />
                                        )}
                                        <Icon className={cn(
                                            "shrink-0 transition-colors",
                                            collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
                                            isActive ? "text-primary" : "text-muted-foreground group-hover/item:text-foreground"
                                        )} />
                                        {!collapsed && (
                                            <motion.span
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                className="truncate"
                                            >
                                                {item.label}
                                            </motion.span>
                                        )}
                                        {!collapsed && isActive && <ChevronRight className="h-3 w-3 ml-auto text-primary/50" />}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Footer — filas consistentes en alineación: cuando está expandido
                cada fila ocupa px-3 uniforme para que tema, alertas y user queden
                en la misma columna vertical. */}
            <div className="mt-auto border-t border-sidebar-border pt-3 pb-3 px-2 space-y-2">

                {/* Mode Toggle */}
                <div className={cn("flex items-center h-9", collapsed ? "justify-center" : "justify-between px-3")}>
                    {!collapsed && <span className="text-xs font-medium text-muted-foreground tracking-wide">Tema</span>}
                    <ModeToggle />
                </div>

                {/* Notification Bell */}
                <NotificationBell collapsed={collapsed} />

                {/* User Card */}
                <div className={cn(
                    "bg-sidebar-accent/50 rounded-xl flex items-center border border-sidebar-border hover:border-sidebar-ring/50 transition-colors cursor-pointer group/user",
                    collapsed ? "justify-center p-2" : "gap-3 p-3"
                )}>
                    <div className={cn(
                        "rounded-full bg-gradient-to-tr from-amber-500 to-amber-700 border border-white/10 flex items-center justify-center font-bold text-white shadow-sm",
                        collapsed ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm"
                    )}>
                        U
                    </div>
                    {!collapsed && (
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-sidebar-foreground truncate group-hover/user:text-primary transition-colors">Usuario</p>
                            <p className="text-[10px] text-muted-foreground">Administrador</p>
                        </div>
                    )}
                    {!collapsed && <LogOut className="h-4 w-4 text-muted-foreground group-hover/user:text-foreground transition-colors" />}
                </div>
            </div>
        </aside>
    );
}
