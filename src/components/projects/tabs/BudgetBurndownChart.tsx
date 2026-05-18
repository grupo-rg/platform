'use client';

/**
 * Curva de consumo de presupuesto: línea estimada (lineal del 0 al
 * estimatedBudget a lo largo de la duración planificada) vs línea real
 * (acumulado de gastos por fecha de factura). SVG inline — sin librerías,
 * sin viewport listeners.
 *
 * Se renderiza solo cuando hay al menos `startDate` y `estimatedEndDate`. Si
 * faltan, mostramos un placeholder discreto pidiendo definir esas fechas.
 */

import { useMemo } from 'react';
import type { Project } from '@/backend/project/domain/project';
import type { Expense } from '@/backend/expense/domain/expense';
import { AlertTriangle, TrendingUp } from 'lucide-react';

interface Props {
    project: Project;
    expenses: Expense[];
    locale: string;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 220;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 32;
const INNER_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const INNER_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthsBetween(start: Date, end: Date): Date[] {
    const months: Date[] = [];
    const cursor = startOfMonth(start);
    const last = startOfMonth(end);
    while (cursor <= last) {
        months.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
}

export function BudgetBurndownChart({ project, expenses, locale }: Props) {
    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    const data = useMemo(() => {
        const startDate = project.startDate ? new Date(project.startDate) : null;
        const endDate = project.estimatedEndDate ? new Date(project.estimatedEndDate) : null;
        if (!startDate || !endDate || endDate <= startDate) return null;

        const months = monthsBetween(startDate, endDate);
        if (months.length === 0) return null;

        // Construyo `realByMonth`: importe agregado de los expenses cuya
        // fecha de factura cae en ese mes (fallback a createdAt si no hay
        // invoiceDate).
        const realByMonth = new Map<number, number>();
        for (const e of expenses) {
            const d = e.invoiceDate ? new Date(e.invoiceDate) : new Date(e.createdAt);
            const key = startOfMonth(d).getTime();
            realByMonth.set(key, (realByMonth.get(key) || 0) + e.total);
        }

        // Pares (mes, importe acumulado real). Si el mes no tiene gasto pero
        // ya hubo gastos antes, se mantiene el acumulado anterior.
        let runningReal = 0;
        const realCumulative = months.map(m => {
            runningReal += realByMonth.get(m.getTime()) || 0;
            return runningReal;
        });

        const totalBudget = project.estimatedBudget || 0;
        const estimatedCumulative = months.map((_, i) => {
            const ratio = months.length === 1 ? 1 : i / (months.length - 1);
            return totalBudget * ratio;
        });

        const yMax = Math.max(totalBudget, runningReal) * 1.05 || 1;

        return { months, realCumulative, estimatedCumulative, yMax, totalBudget };
    }, [project, expenses]);

    if (!data) {
        return (
            <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 p-6 text-center">
                <TrendingUp className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">Curva de consumo no disponible</p>
                <p className="text-xs text-muted-foreground mt-1">
                    Define <strong>fecha de inicio</strong> y <strong>fecha estimada fin</strong>
                    {' '}en el header del proyecto para ver la línea estimada vs real.
                </p>
            </div>
        );
    }

    const { months, realCumulative, estimatedCumulative, yMax, totalBudget } = data;
    const stepX = months.length > 1 ? INNER_WIDTH / (months.length - 1) : 0;
    const yScale = (v: number) => PADDING_TOP + INNER_HEIGHT - (v / yMax) * INNER_HEIGHT;
    const xScale = (i: number) => PADDING_LEFT + i * stepX;

    const toPath = (points: number[]) =>
        points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`).join(' ');

    const monthLabel = (d: Date) =>
        d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });

    // Detecto el último mes en el que el real supera al estimado, para el
    // banner de "vas por encima del plan".
    const overPlan = realCumulative[realCumulative.length - 1] > estimatedCumulative[estimatedCumulative.length - 1];

    // Ticks Y: 0, 25%, 50%, 75%, 100%
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => p * yMax);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="inline-block w-3 h-0.5 bg-indigo-500" />
                        <span className="text-muted-foreground">Plan estimado</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="inline-block w-3 h-0.5 bg-emerald-500" />
                        <span className="text-muted-foreground">Gasto real acumulado</span>
                    </div>
                </div>
                {overPlan && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Gasto real por encima del plan
                    </div>
                )}
            </div>

            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                    className="w-full h-auto min-w-[500px]"
                    role="img"
                    aria-label="Curva de consumo de presupuesto"
                >
                    {/* Grid horizontal + ticks Y */}
                    {yTicks.map((v, i) => (
                        <g key={i}>
                            <line
                                x1={PADDING_LEFT}
                                x2={CHART_WIDTH - PADDING_RIGHT}
                                y1={yScale(v)}
                                y2={yScale(v)}
                                stroke="currentColor"
                                strokeOpacity="0.08"
                                strokeDasharray="3 3"
                            />
                            <text
                                x={PADDING_LEFT - 6}
                                y={yScale(v) + 3}
                                textAnchor="end"
                                fontSize="10"
                                fill="currentColor"
                                opacity="0.5"
                            >
                                {fmt(v)}
                            </text>
                        </g>
                    ))}

                    {/* Línea presupuesto total (referencia horizontal punteada) */}
                    <line
                        x1={PADDING_LEFT}
                        x2={CHART_WIDTH - PADDING_RIGHT}
                        y1={yScale(totalBudget)}
                        y2={yScale(totalBudget)}
                        stroke="rgb(239, 68, 68)"
                        strokeOpacity="0.4"
                        strokeWidth="1"
                        strokeDasharray="6 4"
                    />

                    {/* Línea estimada (lineal) */}
                    <path
                        d={toPath(estimatedCumulative)}
                        fill="none"
                        stroke="rgb(99, 102, 241)"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />

                    {/* Línea real (acumulado de gastos) */}
                    <path
                        d={toPath(realCumulative)}
                        fill="none"
                        stroke="rgb(16, 185, 129)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />

                    {/* Puntos del real para tooltip-ish hover (sin JS) */}
                    {realCumulative.map((v, i) => (
                        <circle
                            key={i}
                            cx={xScale(i)}
                            cy={yScale(v)}
                            r="3"
                            fill="rgb(16, 185, 129)"
                        >
                            <title>{`${monthLabel(months[i])}: ${fmt(v)} real`}</title>
                        </circle>
                    ))}

                    {/* Ticks X (meses) */}
                    {months.map((m, i) => (
                        <text
                            key={i}
                            x={xScale(i)}
                            y={CHART_HEIGHT - PADDING_BOTTOM + 16}
                            textAnchor="middle"
                            fontSize="10"
                            fill="currentColor"
                            opacity="0.6"
                        >
                            {monthLabel(m)}
                        </text>
                    ))}
                </svg>
            </div>
        </div>
    );
}
