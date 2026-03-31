import { useQuery } from '@tanstack/react-query';
import { getPriceBookItems } from '@/actions/price-book/get-price-book-items.action';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';

export function usePriceBook(year: number = 2025, initialData?: PriceBookItem[]) {
    return useQuery({
        queryKey: ['price-book-items', year],
        queryFn: async () => {
            const result = await getPriceBookItems(year, 2000);
            if (!result.success) throw new Error(result.error);
            return result.items || [];
        },
        initialData: initialData,
        staleTime: 1000 * 60 * 60, // 1 hour - Price books don't change often
        refetchOnWindowFocus: false,
    });
}
