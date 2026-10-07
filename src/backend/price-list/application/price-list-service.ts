import {
    PriceListInputSchema,
    type PriceList,
    type PriceListInput,
} from '../domain/price-list';

export interface PriceListRepository {
    newId(): string;
    listAll(): Promise<PriceList[]>;
    get(id: string): Promise<PriceList | null>;
    save(list: PriceList): Promise<void>;
    delete(id: string): Promise<void>;
    /** Reserva atómicamente la siguiente referencia `LP-YYYY-NNNN`. */
    nextReference(year: number): Promise<string>;
}

export class PriceListError extends Error {}

export class PriceListService {
    constructor(private readonly repo: PriceListRepository) {}

    async list(): Promise<PriceList[]> {
        const all = await this.repo.listAll();
        // Más recientes primero (fecha del documento y, a igualdad, creación).
        return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    }

    get(id: string): Promise<PriceList | null> {
        return this.repo.get(id);
    }

    async create(input: PriceListInput, who: string): Promise<PriceList> {
        const data = PriceListInputSchema.parse(input);
        const now = new Date().toISOString();
        const year = Number(data.date.slice(0, 4)) || new Date().getFullYear();
        const list: PriceList = {
            ...data,
            id: this.repo.newId(),
            reference: await this.repo.nextReference(year),
            createdAt: now,
            updatedAt: now,
            createdBy: who,
        };
        await this.repo.save(list);
        return list;
    }

    async update(id: string, input: PriceListInput): Promise<PriceList> {
        const current = await this.repo.get(id);
        if (!current) throw new PriceListError('La lista de precios no existe');
        const data = PriceListInputSchema.parse(input);
        const next: PriceList = {
            ...current,
            ...data,
            id: current.id,
            reference: current.reference,
            createdAt: current.createdAt,
            createdBy: current.createdBy,
            updatedAt: new Date().toISOString(),
        };
        await this.repo.save(next);
        return next;
    }

    async duplicate(id: string, who: string): Promise<PriceList> {
        const src = await this.repo.get(id);
        if (!src) throw new PriceListError('La lista de precios no existe');
        const { id: _id, reference: _ref, createdAt: _c, updatedAt: _u, createdBy: _b, ...rest } = src;
        return this.create(
            { ...rest, title: `Copia de ${src.title}`.slice(0, 200), status: 'draft' },
            who,
        );
    }

    delete(id: string): Promise<void> {
        return this.repo.delete(id);
    }
}
