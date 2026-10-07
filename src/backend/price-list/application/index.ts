import 'server-only';
import { PriceListService } from './price-list-service';
import { FirestorePriceListRepository } from '../infrastructure/firestore-price-list-repository';

/** Instancia única cableada con el repositorio Firestore (admin SDK). */
export const priceListService = new PriceListService(new FirestorePriceListRepository());

export { PriceListError } from './price-list-service';
