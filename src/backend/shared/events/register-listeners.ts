import 'server-only';
import { EventDispatcher } from './event-dispatcher';
import { HandleBookingConfirmedUseCase } from '@/backend/marketing/application/handle-booking-confirmed.usecase';
import { EnrollLeadInSequenceUseCase } from '@/backend/marketing/application/enroll-lead-in-sequence.usecase';
import { MoveDealStageUseCase } from '@/backend/crm/application/move-deal-stage.usecase';
import { FirebaseEnrollmentRepository } from '@/backend/marketing/infrastructure/persistence/firebase.enrollment.repository';
import { FirebaseSequenceRepository } from '@/backend/marketing/infrastructure/persistence/firebase.sequence.repository';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { NotifyAdminOnLeadCreatedUseCase } from '@/backend/lead/application/notify-admin-on-lead-created.usecase';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { CreateDealOnLeadCreatedUseCase } from '@/backend/crm/application/create-deal-on-lead-created.usecase';
import { MoveDealOnBudgetSentUseCase } from '@/backend/crm/application/move-deal-on-budget-sent.usecase';
import { MoveDealOnBudgetAcceptedUseCase } from '@/backend/crm/application/move-deal-on-budget-accepted.usecase';
import { AdjustScoreOnBookingConfirmed } from '@/backend/lead/application/listeners/adjust-score-on-booking.usecase';
import { AdjustScoreOnBudgetSent } from '@/backend/lead/application/listeners/adjust-score-on-budget-sent.usecase';
import { AdjustScoreOnBudgetAccepted } from '@/backend/lead/application/listeners/adjust-score-on-budget-accepted.usecase';
import { ScheduleReEngagementOnLeadCreated } from '@/backend/re-engagement/application/schedule-on-lead-created.usecase';
import {
    CancelReEngagementOnBookingConfirmed,
    CancelReEngagementOnBudgetSent,
    CancelReEngagementOnBudgetAccepted,
} from '@/backend/re-engagement/application/cancel-on-engagement.usecase';
import { FirestoreReEngagementScheduleRepository } from '@/backend/re-engagement/infrastructure/firestore-schedule-repository';

let registered = false;

/**
 * Registra los event handlers de dominio. Debe invocarse una vez por
 * proceso (typically desde `instrumentation.ts` de Next o al primer uso
 * del EventDispatcher). Es idempotente.
 */
export function registerEventListeners(): void {
    if (registered) return;
    registered = true;

    const dispatcher = EventDispatcher.getInstance();

    // Marketing: al confirmarse un booking, cancelar nurturing y meter en reminders
    const marketingHandler = new HandleBookingConfirmedUseCase(
        new FirebaseEnrollmentRepository(),
        new EnrollLeadInSequenceUseCase(new FirebaseSequenceRepository(), new FirebaseEnrollmentRepository()),
    );
    dispatcher.register('BookingConfirmedEvent', marketingHandler);

    // CRM: mover la oportunidad a SALES_CALL_SCHEDULED y adjuntar meetUrl
    const crmHandler = new MoveDealStageUseCase(new FirebaseDealRepository());
    dispatcher.register('BookingConfirmedEvent', crmHandler);

    // Lead: notificar al admin por email cuando entra una solicitud cualificable
    const adminNotifyHandler = new NotifyAdminOnLeadCreatedUseCase(new FirestoreLeadRepository());
    dispatcher.register('LeadCreatedEvent', adminNotifyHandler);

    // CRM: crear automáticamente un Deal en NEW_LEAD para que aparezca en el Kanban
    const createDealHandler = new CreateDealOnLeadCreatedUseCase(new FirebaseDealRepository());
    dispatcher.register('LeadCreatedEvent', createDealHandler);

    // CRM: cuando el admin envía un presupuesto al cliente, el deal salta a PROPOSAL_SENT
    const budgetSentHandler = new MoveDealOnBudgetSentUseCase(new FirebaseDealRepository());
    dispatcher.register('BudgetSentEvent', budgetSentHandler);

    // Lead scoring continuo: ajustar score con eventos del ciclo de venta.
    const sharedLeadRepo = new FirestoreLeadRepository();
    dispatcher.register('BookingConfirmedEvent', new AdjustScoreOnBookingConfirmed(sharedLeadRepo));
    dispatcher.register('BudgetSentEvent', new AdjustScoreOnBudgetSent(sharedLeadRepo));
    dispatcher.register('BudgetAcceptedEvent', new AdjustScoreOnBudgetAccepted(sharedLeadRepo));

    // CRM: cuando el cliente acepta el presupuesto, el deal cierra como ganado.
    dispatcher.register('BudgetAcceptedEvent', new MoveDealOnBudgetAcceptedUseCase(new FirebaseDealRepository()));

    // Re-engagement: programar 3 emails al crear un lead qualified, cancelar al primer
    // signal de engagement real (booking, propuesta enviada, propuesta aceptada).
    const reEngagementRepo = new FirestoreReEngagementScheduleRepository();
    dispatcher.register('LeadCreatedEvent', new ScheduleReEngagementOnLeadCreated(reEngagementRepo));
    dispatcher.register('BookingConfirmedEvent', new CancelReEngagementOnBookingConfirmed(reEngagementRepo));
    dispatcher.register('BudgetSentEvent', new CancelReEngagementOnBudgetSent(reEngagementRepo));
    dispatcher.register('BudgetAcceptedEvent', new CancelReEngagementOnBudgetAccepted(reEngagementRepo));

    console.log('[events] listeners registrados');
}
