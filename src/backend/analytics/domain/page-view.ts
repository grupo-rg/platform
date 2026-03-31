/**
 * PageView Value Object
 * Represents a single page navigation within a session.
 */
export interface PageView {
    path: string;
    referrer: string | null;
    userAgent: string;
    locale: string;
    timestamp: Date;
    variantId?: string;
}
