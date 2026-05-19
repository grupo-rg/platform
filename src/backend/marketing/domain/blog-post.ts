/**
 * Entidad de post de blog.
 * Usada por el SEO generator (creación asistida por IA) y por el blog público
 * (lectura ISR). Estados: draft → scheduled → published; error → failed.
 */
export type BlogPostStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export type BlogLocale = 'es' | 'en' | 'ca' | 'de' | 'nl';

export interface BlogPostAnalytics {
    views: number;
    readsTo80: number;
}

export interface BlogPost {
    id: string;
    slug: string;
    locale: BlogLocale;

    title: string;
    metaTitle?: string;
    metaDescription: string;
    keywords: string[];
    tags: string[];
    categoryId?: string;

    heroImageUrl?: string;
    ogImageUrl?: string;
    /** Texto alternativo de la imagen — accesibilidad + SEO. */
    imageAltText?: string;
    /**
     * Atribución de la imagen cuando viene de un stock (Unsplash, etc.).
     * Lo guardamos junto al post para poder renderizarlo al pie y cumplir
     * los ToS sin volver a consultar la API.
     */
    imageAttribution?: {
        photographerName: string;
        photographerUrl: string;
        source: 'unsplash' | 'generated' | 'manual';
        sourceId?: string;
    };

    /** Contenido principal en Markdown. */
    contentMarkdown: string;

    status: BlogPostStatus;
    /** Fecha programada de publicación. Solo válida si status === 'scheduled'. */
    publishAt?: Date;
    /** Fecha efectiva de publicación. Solo válida si status === 'published'. */
    publishedAt?: Date;

    authorId?: string;
    seoScore?: number;
    analytics?: BlogPostAnalytics;

    createdAt: Date;
    updatedAt: Date;

    /** Error message si el intento programado falló (status === 'failed'). */
    failureReason?: string;
    /**
     * Cuántas veces el cron de rescate ha tenido que reencolar este post
     * porque la Cloud Task original venció sin publicarlo. Si supera el
     * umbral configurado (3), el cron deja de reintentar y lo marca
     * `failed` con `failureReason` indicando el motivo.
     */
    recoveryAttempts?: number;
}

export interface BlogPostRepository {
    save(post: BlogPost): Promise<void>;
    findById(id: string): Promise<BlogPost | null>;
    findBySlug(locale: BlogLocale, slug: string): Promise<BlogPost | null>;
    listByStatus(status: BlogPostStatus, limit?: number): Promise<BlogPost[]>;
    listPublished(locale: BlogLocale, limit?: number): Promise<BlogPost[]>;
    listScheduled(): Promise<BlogPost[]>;
    delete(id: string): Promise<void>;

    /**
     * Transición atómica `draft|scheduled|failed → published`. Si el post ya
     * está `published`, devuelve `null` sin escribir (idempotente).
     *
     * Esta operación se introduce para evitar la race condition entre la
     * Cloud Task original (endpoint `/api/marketing/blog/publish`) y el
     * cron de rescate (`/api/cron/recover-scheduled-blog-posts`), que
     * pueden disparar publicación del mismo post con segundos de
     * diferencia. Sin atomicidad, ambos verían `status='scheduled'` y
     * ambos llamarían a `save()` — el último gana pero `publishedAt`
     * acaba siendo el segundo timestamp, lo cual confunde la auditoría.
     */
    publishAtomically(id: string): Promise<BlogPost | null>;
}

/** Slugify muy básico — sirve para placeholders mientras el modelo no devuelve uno. */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}
