import 'server-only';
import { DocumentTemplateService } from './document-template-service';
import { FirestoreDocumentTemplateRepository } from '../infrastructure/firestore-document-template-repository';

/** Instancia única cableada con el repositorio Firestore (admin SDK). */
export const documentTemplateService = new DocumentTemplateService(new FirestoreDocumentTemplateRepository());

export { DocumentTemplateError } from './document-template-service';
