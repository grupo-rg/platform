// src/backend/expense/application/expense-service.ts
import { Expense, ExpenseRepository, ExpenseStatus, isValidExpenseTransition } from '../domain/expense';
import { InvoiceLine } from '../domain/invoice-line';
import { Provider, ProviderRepository } from '../domain/provider';
import { Project, ProjectRepository } from '@/backend/project/domain/project';
import { ExtractedInvoice } from '@/backend/ai/private-core/flows/extract-invoice.flow';
import { v4 as uuidv4 } from 'uuid';

/**
 * Application service for Expense business logic.
 * Handles creation, validation (with real cost propagation), and rejection.
 */
export class ExpenseService {
    constructor(
        private readonly expenseRepository: ExpenseRepository,
        private readonly providerRepository: ProviderRepository,
        private readonly projectRepository: ProjectRepository,
    ) { }

    /**
     * Creates an expense manually with provided data.
     * Auto-registers provider if CIF is provided and not found.
     */
    async createExpense(projectId: string, data: {
        providerName: string;
        providerCif?: string;
        invoiceNumber?: string;
        invoiceDate?: Date;
        lines: Omit<InvoiceLine, 'id'>[];
        subtotal: number;
        taxRate: number;
        taxAmount: number;
        total: number;
        pdfUrl?: string;
        notes?: string;
    }): Promise<Expense> {
        // Verify project exists
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        // Auto-register provider if CIF provided
        let providerId: string | undefined;
        if (data.providerCif) {
            providerId = await this.ensureProvider(data.providerName, data.providerCif);
        }

        const expense: Expense = {
            id: uuidv4(),
            projectId,
            providerId,
            providerName: data.providerName,
            providerCif: data.providerCif,
            invoiceNumber: data.invoiceNumber,
            invoiceDate: data.invoiceDate,
            subtotal: data.subtotal,
            taxRate: data.taxRate,
            taxAmount: data.taxAmount,
            total: data.total,
            lines: data.lines.map(line => ({ ...line, id: uuidv4() })),
            status: 'pendiente',
            pdfUrl: data.pdfUrl,
            extractedByAI: false,
            notes: data.notes,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.expenseRepository.save(expense);
        return expense;
    }

    /**
     * Creates an expense from AI extraction results.
     * Pre-fills with extracted data, status = pendiente (human-in-the-loop).
     */
    async createFromAIExtraction(projectId: string, extracted: ExtractedInvoice, pdfUrl?: string): Promise<Expense> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        // Auto-register provider
        let providerId: string | undefined;
        if (extracted.provider.cif) {
            providerId = await this.ensureProvider(extracted.provider.name, extracted.provider.cif);
        }

        const expense: Expense = {
            id: uuidv4(),
            projectId,
            providerId,
            providerName: extracted.provider.name,
            providerCif: extracted.provider.cif,
            invoiceNumber: extracted.invoiceNumber,
            invoiceDate: extracted.invoiceDate ? new Date(extracted.invoiceDate) : undefined,
            subtotal: extracted.subtotal,
            taxRate: extracted.taxRate,
            taxAmount: extracted.taxAmount,
            total: extracted.total,
            lines: extracted.lines.map(line => ({
                id: uuidv4(),
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                total: line.total,
                suggestedChapter: line.suggestedChapter,
            })),
            status: 'pendiente',
            pdfUrl,
            extractedByAI: true,
            extractionConfidence: extracted.confidence,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.expenseRepository.save(expense);
        return expense;
    }

    /**
     * Validates an expense: changes to 'validada' and propagates realCost
     * to the linked Project and its ProjectPhases.
     */
    async validateExpense(expenseId: string): Promise<Expense> {
        const expense = await this.expenseRepository.findById(expenseId);
        if (!expense) throw new Error(`Expense not found: ${expenseId}`);

        if (!isValidExpenseTransition(expense.status, 'validada')) {
            throw new Error(`Cannot validate expense with status "${expense.status}"`);
        }

        // Propagate costs to project
        const project = await this.projectRepository.findById(expense.projectId);
        if (project) {
            project.realCost += expense.total;

            // Propagate to phases based on line assignments
            for (const line of expense.lines) {
                if (line.phaseId) {
                    const phase = project.phases.find(p => p.id === line.phaseId);
                    if (phase) {
                        phase.realCost += line.total;
                    }
                }
            }

            project.updatedAt = new Date();
            await this.projectRepository.save(project);
        }

        expense.status = 'validada';
        expense.updatedAt = new Date();
        await this.expenseRepository.save(expense);

        return expense;
    }

    /**
     * Rejects an expense.
     */
    async rejectExpense(expenseId: string): Promise<Expense> {
        const expense = await this.expenseRepository.findById(expenseId);
        if (!expense) throw new Error(`Expense not found: ${expenseId}`);

        if (!isValidExpenseTransition(expense.status, 'rechazada')) {
            throw new Error(`Cannot reject expense with status "${expense.status}"`);
        }

        expense.status = 'rechazada';
        expense.updatedAt = new Date();
        await this.expenseRepository.save(expense);

        return expense;
    }

    /**
     * Ensures a provider exists by CIF. Creates if not found.
     */
    private async ensureProvider(name: string, cif: string): Promise<string> {
        const existing = await this.providerRepository.findByCif(cif);
        if (existing) return existing.id;

        const provider: Provider = {
            id: uuidv4(),
            name,
            cif,
            createdAt: new Date(),
        };

        await this.providerRepository.save(provider);
        return provider.id;
    }
}
