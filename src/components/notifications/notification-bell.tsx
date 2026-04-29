'use client';

import { useState, useEffect, useCallback } from 'react';
import { getGlobalAnalyticsAction } from '@/actions/analytics/get-global-analytics.action';
import {
    Bell,
    AlertTriangle,
    TrendingDown,
    Building2,
    X,
    ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

interface Notification {
    id: string;
    type: 'deviation' | 'overbudget' | 'info';
    title: string;
    message: string;
    severity: 'warning' | 'danger' | 'info';
    projectId?: string;
}

interface NotificationBellProps {
    collapsed?: boolean;
}

export function NotificationBell({ collapsed = false }: NotificationBellProps) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    const fetchNotifications = useCallback(async () => {
        try {
            const analytics = await getGlobalAnalyticsAction();
            const alerts: Notification[] = [];

            analytics.projectSummaries.forEach(project => {
                if (Math.abs(project.deviationPercent) > 15) {
                    alerts.push({
                        id: `dev-${project.id}`,
                        type: 'overbudget',
                        title: `Desviación crítica`,
                        message: `${project.name}: ${project.deviationPercent > 0 ? '+' : ''}${project.deviationPercent.toFixed(1)}% sobre presupuesto`,
                        severity: 'danger',
                        projectId: project.id,
                    });
                } else if (Math.abs(project.deviationPercent) > 10) {
                    alerts.push({
                        id: `dev-${project.id}`,
                        type: 'deviation',
                        title: `Desviación moderada`,
                        message: `${project.name}: ${project.deviationPercent > 0 ? '+' : ''}${project.deviationPercent.toFixed(1)}% sobre presupuesto`,
                        severity: 'warning',
                        projectId: project.id,
                    });
                }
            });

            setNotifications(alerts);
        } catch {
            // Silently fail for notifications
        }
    }, []);

    useEffect(() => {
        fetchNotifications();
        // Refresh every 5 min
        const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchNotifications]);

    const activeNotifications = notifications.filter(n => !dismissed.has(n.id));
    const unreadCount = activeNotifications.length;

    const handleDismiss = (id: string) => {
        setDismissed(prev => new Set(prev).add(id));
    };

    const SEVERITY_STYLES = {
        danger: {
            bg: 'bg-red-50 dark:bg-red-950/30',
            border: 'border-red-200 dark:border-red-800',
            icon: 'text-red-500',
            dot: 'bg-red-500',
        },
        warning: {
            bg: 'bg-amber-50 dark:bg-amber-950/30',
            border: 'border-amber-200 dark:border-amber-800',
            icon: 'text-amber-500',
            dot: 'bg-amber-500',
        },
        info: {
            bg: 'bg-blue-50 dark:bg-blue-950/30',
            border: 'border-blue-200 dark:border-blue-800',
            icon: 'text-blue-500',
            dot: 'bg-blue-500',
        },
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "relative flex items-center justify-center rounded-lg transition-all duration-200",
                    collapsed ? "w-10 h-10" : "w-full gap-2 px-3 py-2",
                    open
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
            >
                <Bell className="w-4 h-4" />
                {!collapsed && <span className="text-sm font-medium">Alertas</span>}

                {/* Badge — corrección del bug de comma-typo que rompía la clase
                    `right-1` en modo expandido y dejaba el badge sobre el texto. */}
                {unreadCount > 0 && (
                    <span className={cn(
                        "absolute flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full shadow-md shadow-red-500/30 animate-in zoom-in duration-300 w-4 h-4",
                        collapsed ? "top-0.5 right-0.5" : "top-1 right-2"
                    )}>
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                            "absolute z-50 bottom-full mb-2 w-72 max-h-80 overflow-y-auto rounded-xl border bg-background shadow-xl scrollbar-hide",
                            collapsed ? "left-12" : "left-0"
                        )}
                    >
                        <div className="p-3 border-b flex items-center justify-between">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Alertas ({unreadCount})
                            </h4>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {activeNotifications.length === 0 ? (
                            <div className="p-6 text-center text-sm text-muted-foreground">
                                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                Sin alertas activas
                            </div>
                        ) : (
                            <div className="p-2 space-y-1.5">
                                {activeNotifications.map(notification => {
                                    const styles = SEVERITY_STYLES[notification.severity];
                                    return (
                                        <div
                                            key={notification.id}
                                            className={cn(
                                                "p-3 rounded-lg border transition-all",
                                                styles.bg, styles.border,
                                                "group"
                                            )}
                                        >
                                            <div className="flex items-start gap-2">
                                                <div className={cn("mt-0.5 shrink-0", styles.icon)}>
                                                    {notification.severity === 'danger' ? (
                                                        <AlertTriangle className="w-3.5 h-3.5" />
                                                    ) : (
                                                        <TrendingDown className="w-3.5 h-3.5" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-semibold">{notification.title}</p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">{notification.message}</p>
                                                </div>
                                                <button
                                                    onClick={() => handleDismiss(notification.id)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
