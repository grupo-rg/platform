// src/backend/project/application/project-service.ts
import { Budget } from '@/backend/budget/domain/budget';
import { PersonalInfo } from '@/backend/lead/domain/lead';
import { Project, ProjectRepository, ProjectStatus, isValidStatusTransition } from '../domain/project';
import { ProjectPhase } from '../domain/project-phase';
import { v4 as uuidv4 } from 'uuid';

/**
 * Application service for Project (Obra) business logic.
 */
export class ProjectService {
    constructor(private readonly projectRepository: ProjectRepository) { }

    /**
     * Creates a new Project from an approved Budget.
     * Generates phases from the budget's unique chapters.
     */
    async createFromBudget(budget: Budget, overrides?: {
        name?: string;
        description?: string;
        address?: string;
        startDate?: Date;
        estimatedEndDate?: Date;
    }): Promise<Project> {
        // Validate budget is approved
        if (budget.status !== 'approved') {
            throw new Error(`Cannot create project from budget with status "${budget.status}". Budget must be "approved".`);
        }

        // Check if a project already exists for this budget
        const existing = await this.projectRepository.findByBudgetId(budget.id);
        if (existing) {
            throw new Error(`A project already exists for budget ${budget.id}: ${existing.id}`);
        }

        // Generate phases from budget chapters (unique chapter names)
        const phases = this.generatePhasesFromBudget(budget);

        const project: Project = {
            id: uuidv4(),
            budgetId: budget.id,
            leadId: budget.leadId || 'legacy-lead',
            clientSnapshot: budget.clientSnapshot || (budget as any).clientData,
            name: overrides?.name || `Obra - ${budget.clientSnapshot?.name || (budget as any).clientData?.name || budget.id}`,
            description: overrides?.description,
            address: overrides?.address,
            estimatedBudget: budget.totalEstimated || budget.costBreakdown?.total || 0,
            realCost: 0,
            startDate: overrides?.startDate,
            estimatedEndDate: overrides?.estimatedEndDate,
            status: 'preparacion',
            phases,
            team: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Crea una obra sin presupuesto vinculado. Usado cuando el cliente contrata
     * directamente y el contratista quiere abrir la obra ya, dejando el
     * presupuesto formal para después (o nunca). El snapshot del cliente
     * viene del Lead (clientSnapshot). El presupuesto puede vincularse más
     * adelante con `linkBudget(projectId, budgetId)`.
     */
    async createWithoutBudget(input: {
        leadId: string;
        clientSnapshot: PersonalInfo;
        name: string;
        description?: string;
        address?: string;
        startDate?: Date;
        estimatedEndDate?: Date;
        estimatedBudget?: number;
    }): Promise<Project> {
        const project: Project = {
            id: uuidv4(),
            budgetId: null,
            leadId: input.leadId,
            clientSnapshot: input.clientSnapshot,
            name: input.name,
            description: input.description,
            address: input.address,
            estimatedBudget: input.estimatedBudget ?? 0,
            realCost: 0,
            startDate: input.startDate,
            estimatedEndDate: input.estimatedEndDate,
            status: 'preparacion',
            phases: [],
            team: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Updates general project details.
     */
    async update(projectId: string, updates: {
        name?: string;
        description?: string;
        address?: string;
        startDate?: Date;
        estimatedEndDate?: Date;
        actualEndDate?: Date;
    }): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        if (updates.name !== undefined) project.name = updates.name;
        if (updates.description !== undefined) project.description = updates.description;
        if (updates.address !== undefined) project.address = updates.address;
        if (updates.startDate !== undefined) project.startDate = updates.startDate;
        if (updates.estimatedEndDate !== undefined) project.estimatedEndDate = updates.estimatedEndDate;
        if (updates.actualEndDate !== undefined) project.actualEndDate = updates.actualEndDate;

        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Updates the status of a project with state machine validation.
     */
    async updateStatus(projectId: string, newStatus: ProjectStatus): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        if (!isValidStatusTransition(project.status, newStatus)) {
            throw new Error(
                `Invalid status transition: "${project.status}" → "${newStatus}". ` +
                `Allowed transitions from "${project.status}": ${JSON.stringify(
                    (await import('../domain/project')).PROJECT_STATUS_TRANSITIONS[project.status]
                )}`
            );
        }

        project.status = newStatus;
        project.updatedAt = new Date();

        // Auto-set dates on certain transitions
        if (newStatus === 'ejecucion' && !project.startDate) {
            project.startDate = new Date();
        }
        if (newStatus === 'finalizada' || newStatus === 'cerrada') {
            project.actualEndDate = new Date();
        }

        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Updates a specific phase within a project.
     */
    async updatePhase(
        projectId: string,
        phaseId: string,
        updates: Partial<Pick<ProjectPhase, 'status' | 'progress' | 'notes' | 'actualStartDate' | 'actualEndDate' | 'realCost' | 'estimatedCost' | 'estimatedStartDate' | 'estimatedEndDate'>>
    ): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        const phaseIndex = project.phases.findIndex(p => p.id === phaseId);
        if (phaseIndex === -1) {
            throw new Error(`Phase not found: ${phaseId} in project ${projectId}`);
        }

        // Apply updates
        project.phases[phaseIndex] = {
            ...project.phases[phaseIndex],
            ...updates,
        };

        // Recalculate project.realCost from all phases
        project.realCost = project.phases.reduce((sum, p) => sum + (p.realCost || 0), 0);

        // Auto-set phase start date when moving to en_progreso
        if (updates.status === 'en_progreso' && !project.phases[phaseIndex].actualStartDate) {
            project.phases[phaseIndex].actualStartDate = new Date();
        }
        if (updates.status === 'completada' && !project.phases[phaseIndex].actualEndDate) {
            project.phases[phaseIndex].actualEndDate = new Date();
            project.phases[phaseIndex].progress = 100;
        }

        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Generates ProjectPhases from the unique chapters found in budget line items.
     */
    private generatePhasesFromBudget(budget: Budget): ProjectPhase[] {
        const chapterMap = new Map<string, { totalCost: number; order: number }>();

        // Iterate chapters and items to calculate total
        if (budget.chapters) {
            budget.chapters.forEach(chapter => {
                const chapterName = chapter.name || 'General';
                if (!chapterMap.has(chapterName)) {
                    chapterMap.set(chapterName, { totalCost: 0, order: chapterMap.size + 1 });
                }
                const entry = chapterMap.get(chapterName)!;

                chapter.items.forEach(item => {
                    const lineTotal = item.unitPrice * item.quantity;
                    entry.totalCost += lineTotal;
                });
            });
        }

        return Array.from(chapterMap.entries()).map(([name, data]) => ({
            id: uuidv4(),
            name,
            order: data.order,
            status: 'pendiente' as const,
            progress: 0,
            estimatedCost: data.totalCost,
            realCost: 0,
        }));
    }

    /**
     * Adds a new phase to the project.
     */
    async addPhase(projectId: string, phaseData: { name: string; estimatedCost: number; order?: number }): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);

        const newPhase: ProjectPhase = {
            id: uuidv4(),
            name: phaseData.name,
            order: phaseData.order ?? (project.phases.length > 0 ? Math.max(...project.phases.map(p => p.order)) + 1 : 1),
            status: 'pendiente',
            progress: 0,
            estimatedCost: phaseData.estimatedCost,
            realCost: 0,
        };

        project.phases.push(newPhase);
        // Sort by order
        project.phases.sort((a, b) => a.order - b.order);

        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Removes a phase from the project.
     */
    async removePhase(projectId: string, phaseId: string): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);

        project.phases = project.phases.filter(p => p.id !== phaseId);

        // Recalculate realCost
        project.realCost = project.phases.reduce((sum, p) => sum + (p.realCost || 0), 0);

        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return project;
    }

    /**
     * Reorders phases.
     */
    async reorderPhases(projectId: string, phaseIds: string[]): Promise<Project> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);

        // Create a map for O(1) lookup
        const orderMap = new Map(phaseIds.map((id, index) => [id, index + 1]));

        project.phases.forEach(p => {
            if (orderMap.has(p.id)) {
                p.order = orderMap.get(p.id)!;
            }
        });

        project.phases.sort((a, b) => a.order - b.order);
        project.updatedAt = new Date();
        await this.projectRepository.save(project);
        return project;
    }
}
