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

    const navGroups = [
        {
            label: 'Gestión',
            items: [
                { href: '/dashboard', label: t.dashboard.nav.dashboard, icon: LayoutDashboard },
                { href: '/dashboard/projects', label: 'Obras', icon: Building2 },
                { href: '/dashboard/expenses', label: 'Facturas', icon: Receipt },
                { href: '/dashboard/analytics', label: 'Analíticas', icon: BarChart3 },
                { href: '/dashboard/admin/budgets', label: t.dashboard.nav.myBudgets, icon: FileText },
                { href: '/dashboard/admin/messages', label: 'Mensajes', icon: MessageSquare },
            ]
        },
        {
            label: 'Herramientas',
            items: [
                { href: '/dashboard/wizard', label: 'AI Budget Wizard', icon: Sparkles },
                { href: '/dashboard/seo-generator', label: t.dashboard.nav.seoGenerator, icon: Search },
            ]
        },
        {
            label: 'CRM',
            items: [
                { href: '/dashboard/leads', label: 'Leads', icon: Users },
                { href: '/dashboard/agenda', label: 'Agenda', icon: CalendarDays },
                { href: '/dashboard/marketing', label: 'Marketing', icon: TrendingUp },
            ]
        },
        {
            label: 'Configuración',
            items: [
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

            {/* Logo Area */}
            <div className={cn("flex items-center px-4 mb-4 mt-4 transition-all duration-300", collapsed ? "justify-center" : "")}>
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
                            className="relative w-full h-12 flex items-center justify-start pl-1 shrink-0"
                        >
                            <Logo className="h-8 md:h-9 object-contain" width={140} height={36} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="mx-3 border-t border-sidebar-border/50 mb-4" />

            {/* Navigation */}
            <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden scrollbar-hide px-2">
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

            {/* Footer */}
            <div className="mt-auto border-t border-sidebar-border pt-3 pb-3 px-2 space-y-3">

                {/* Mode Toggle */}
                <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between px-2")}>
                    {!collapsed && <span className="text-[10px] text-muted-foreground tracking-wide">Tema</span>}
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
