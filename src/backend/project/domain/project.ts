import { ProjectPhase } from '@/backend/project/domain/project-phase';
import { ProjectTeamMember } from '@/backend/project/domain/project-team';
import { PersonalInfo } from '@/backend/lead/domain/lead';

// --- Status Machine ---
export type ProjectStatus =
    | 'preparacion'
    | 'ejecucion'
    | 'pausada'
    | 'finalizada'
    | 'cerrada';

/**
 * Valid status transitions for a Project.
 * Key = current status, Value = allowed next statuses.
 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
    preparacion: ['ejecucion', 'pausada'],
    ejecucion: ['pausada', 'finalizada'],
    pausada: ['ejecucion', 'finalizada'],
    finalizada: ['cerrada'],
    cerrada: [],
};

export function isValidStatusTransition(from: ProjectStatus, to: ProjectStatus): boolean {
    return PROJECT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Main Entity ---

/**
 * Represents a construction project (Obra) linked 1:1 to an approved Budget.
 */
export interface Project {
    id: string;

    // Linked Budget — opcional. Una obra puede crearse sin presupuesto aprobado
    // (caso "obra directa", típicamente cuando el cliente contrata sin presu
    // formal). Cuando es null, `clientSnapshot` proviene del Lead seleccionado
    // y `estimatedBudget` puede ser 0 hasta que se vincule un presupuesto.
    budgetId: string | null;
    leadId: string;

    // Client snapshot (immutable at creation time)
    clientSnapshot: PersonalInfo;

    // Project metadata
    name: string;
    description?: string;
    address?: string;

    // Financial
    estimatedBudget: number; // Total from budget at creation
    realCost: number;        // Accumulated from invoices (starts at 0)

    // Timeline
    startDate?: Date;
    estimatedEndDate?: Date;
    actualEndDate?: Date;

    // Status
    status: ProjectStatus;

    // Structure
    phases: ProjectPhase[];
    team: ProjectTeamMember[];

    // Audit
    createdAt: Date;
    updatedAt: Date;
}

// --- Repository Interface ---

export interface ProjectRepository {
    findById(id: string): Promise<Project | null>;
    findByBudgetId(budgetId: string): Promise<Project | null>;
    findAll(): Promise<Project[]>;
    save(project: Project): Promise<void>;
    delete(id: string): Promise<void>;
}
