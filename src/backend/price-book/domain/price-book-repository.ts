
import { PriceBookItem } from './price-book-item';

/**
 * Repository Interface for Price Book Items.
 * Follows the Port pattern (driven port).
 */
export interface PriceBookRepository {
    /**
     * Saves a list of price book items.
     * @param items Array of PriceBookItem to save.
     */
    saveBatch(items: PriceBookItem[]): Promise<void>;

    /**
     * Finds items by year.
     * @param year The year of the price book.
     */
    findByYear(year: number): Promise<PriceBookItem[]>;

    /**
     * Searches for items using semantic search or keywords.
     * @param query The search query string.
     * @param limit Max number of results.
     */
    search(query: string, limit?: number): Promise<PriceBookItem[]>;

    /**
     * Performs a semantic search using vector embeddings.
     * @param embedding The vector embedding of the search query.
     * @param limit Number of results to return.
     * @param year Optional filter by year.
     */
    searchByVector(embedding: number[], limit: number, year?: number, keywordFilter?: string): Promise<PriceBookItem[]>;

    /**
     * Performs a hybrid search: Vector Similarity + Structured Filters.
     * requires Firestore Composite Indexes.
     */
    searchByVectorWithFilters(
        embedding: number[],
        filters: SearchFilters,
        limit?: number
    ): Promise<PriceBookItem[]>;
}

export interface SearchFilters {
    chapter?: string;
    section?: string;
    minPrice?: number;
    maxPrice?: number;
    year?: number;
}
