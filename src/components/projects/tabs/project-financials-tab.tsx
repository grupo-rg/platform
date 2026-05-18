'use client';

import { useState } from 'react';
import { Project } from '@/backend/project/domain/project';
import { Expense } from '@/backend/expense/domain/expense';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExpenseCard } from '@/components/expenses/expense-card';
import { CreateExpenseModal } from '@/components/expenses/create-expense-modal';
import { BudgetBurndownChart } from './BudgetBurndownChart';
import { Receipt, Upload, LineChart } from 'lucide-react';

interface ProjectFinancialsTabProps {
    project: Project;
    expenses: Expense[];
    locale: string;
}

export function ProjectFinancialsTab({ project, expenses, locale }: ProjectFinancialsTabProps) {
    const [createOpen, setCreateOpen] = useState(false);
    const totalExpenses = expenses.reduce((acc, e) => acc + e.total, 0);

    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Presupuesto Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{fmt(project.estimatedBudget)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Gastos Reales</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${totalExpenses > project.estimatedBudget ? 'text-red-500' : 'text-foreground'}`}>
                            {fmt(totalExpenses)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Margen Disponible</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${project.estimatedBudget - totalExpenses < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {fmt(project.estimatedBudget - totalExpenses)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <LineChart className="w-5 h-5" />
                        Consumo de Presupuesto
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <BudgetBurndownChart project={project} expenses={expenses} locale={locale} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="flex items-center gap-2">
                        <Receipt className="w-5 h-5" />
                        Historial de Gastos
                    </CardTitle>
                    <Button
                        size="sm"
                        onClick={() => setCreateOpen(true)}
                        className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                    >
                        <Upload className="w-4 h-4" />
                        Subir factura
                    </Button>
                </CardHeader>
                <CardContent>
                    {expenses.length > 0 ? (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {expenses.map(expense => (
                                <ExpenseCard key={expense.id} expense={expense} locale={locale} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <Receipt className="w-10 h-10 mb-2 opacity-20" />
                            <p>No hay gastos registrados para esta obra.</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCreateOpen(true)}
                                className="mt-4 gap-2"
                            >
                                <Upload className="w-4 h-4" />
                                Subir la primera factura
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <CreateExpenseModal
                open={createOpen}
                onOpenChange={setCreateOpen}
                projects={[project]}
                locale={locale}
                lockedProjectId={project.id}
            />
        </div>
    );
}
