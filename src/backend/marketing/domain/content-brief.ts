import { BlogLocale } from './blog-post';

/**
 * Un `ContentBrief` representa una idea editorial **antes** de generar el
 * contenido completo. El EditorialPlannerAgent produce N briefs en bloque
 * y el admin los aprueba/edita; al aprobar, se dispara la generación full
 * del post (`generateAndSaveBlogPostAction`).
 *
 * Beneficio sobre "generar post directamente":
 *   - Coste mucho menor de aprobación humana (revisar 10 briefs es más
 *     rápido que revisar 10 posts de 900 palabras).
 *   - Visibilidad anticipada del plan editorial — el admin ve qué semanas
 *     están cubiertas antes de gastar tokens en redactar.
 *   - Permite estrategia de keywords sin duplicación accidental.
 */

export type ContentBriefStatus =
    | 'proposed'    // Propuesto por el agente, esperando revisión del admin.
    | 'approved'    // Admin aprobó: pendiente de generar el post.
    | 'rejected'    // Admin descartó: se queda en histórico para no reproponer.
    | 'generating'  // El generador está trabajando en él.
    | 'generated';  // Ya se creó el BlogPost (ver `generatedPostId`).

export type ContentBriefIntent = 'informational' | 'transactional' | 'navigational' | 'commercial';

export interface ContentBrief {
    id: string;
    /** ID de la sesión de planificación que lo generó (un batch agrupado). */
    planId?: string;

    locale: BlogLocale;
    title: string;
    /** Resumen 1-frase del ángulo del post (a desarrollar por el redactor). */
    angle?: string;
    /** Keyword principal sobre la que posicionar. */
    primaryKeyword: string;
    /** Keywords secundarias / long-tail. */
    secondaryKeywords: string[];
    intent: ContentBriefIntent;
    /** Fecha sugerida de publicación. Cuando se aprueba, esto pasa al scheduling. */
    proposedPublishAt?: Date;
    /** Por qué el agente sugiere este post (ej. "no hay artículo cubriendo este servicio"). */
    rationale?: string;
    /** Si el brief sugiere CTAs/links a una página de servicio concreta. */
    relatedServicePath?: string;

    status: ContentBriefStatus;
    /** Si status === 'generated', referencia al post creado. */
    generatedPostId?: string;
    /** Texto opcional añadido por el admin al aprobar o rechazar. */
    adminNote?: string;

    createdAt: Date;
    updatedAt: Date;
}

export interface ContentBriefRepository {
    save(brief: ContentBrief): Promise<void>;
    saveBatch(briefs: ContentBrief[]): Promise<void>;
    findById(id: string): Promise<ContentBrief | null>;
    listByPlan(planId: string): Promise<ContentBrief[]>;
    listByStatus(status: ContentBriefStatus, locale?: BlogLocale, limit?: number): Promise<ContentBrief[]>;
    delete(id: string): Promise<void>;
}

/**
 * `KeywordIdea` es la salida normalizada de cualquier herramienta de
 * keyword research (Google Trends en v1, SerpAPI/DataForSEO en el futuro).
 * No se persiste — vive solo durante la planificación.
 */
export interface KeywordIdea {
    keyword: string;
    /** 0-100 si la fuente da volumen o popularidad relativa; null si no. */
    trendScore?: number;
    relatedQueries: string[];
    /** Fuente que la sugirió, útil para depurar. */
    source: 'google-trends' | 'serpapi' | 'dataforseo' | 'manual';
    intent?: ContentBriefIntent;
}
