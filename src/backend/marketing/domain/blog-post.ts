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
}

export interface BlogPostRepository {
    save(post: BlogPost): Promise<void>;
    findById(id: string): Promise<BlogPost | null>;
    findBySlug(locale: BlogLocale, slug: string): Promise<BlogPost | null>;
    listByStatus(status: BlogPostStatus, limit?: number): Promise<BlogPost[]>;
    listPublished(locale: BlogLocale, limit?: number): Promise<BlogPost[]>;
    listScheduled(): Promise<BlogPost[]>;
    delete(id: string): Promise<void>;
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
