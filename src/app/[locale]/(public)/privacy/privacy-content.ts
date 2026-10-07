/**
 * Contenido localizado de la Política de Privacidad y Cookies.
 *
 * ⚠️ BORRADOR — REVISIÓN LEGAL PENDIENTE (Fase 0-C, 2026-10-07).
 * Recoge los tratamientos reales (Firebase/Google Cloud, Vertex AI/Gemini,
 * Resend, Google Calendar, Vercel, futuro WhatsApp/Meta), plazos, derechos,
 * transferencias y cookies técnicas reales (no hay cookies analíticas ni
 * banner). Los marcadores [REVISAR]/[PROPUESTA] deben validarse.
 *
 * ⚠️ AVISO IMPORTANTE (leer antes de publicar):
 * Este texto es una PLANTILLA base RGPD/LOPD-GDD razonable para una empresa
 * constructora radicada en las Islas Baleares (España). NO constituye
 * asesoramiento jurídico ni un documento legal definitivo. Antes de darle
 * carácter oficial DEBE ser revisado y validado por un profesional del derecho
 * y adaptado a los tratamientos reales de la empresa (finalidades concretas,
 * encargados de tratamiento, transferencias internacionales, plazos de
 * conservación, cookies realmente instaladas, etc.).
 *
 * Los datos identificativos del responsable (razón social, CIF, domicilio,
 * email, teléfono, web) NO se hardcodean aquí: se leen de CompanyConfig
 * (Firestore → Ajustes > Empresa) y se inyectan en la página.
 */

export const PRIVACY_LAST_UPDATED = '2026-10-07';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface PrivacyContent {
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  updatedLabel: string;
  templateNotice: string;
  responsible: {
    heading: string;
    intro: string;
    labels: {
      legalName: string;
      cif: string;
      address: string;
      email: string;
      phone: string;
      web: string;
    };
    fallbackNote: string;
  };
  sections: LegalSection[];
}

export const privacyContent: Record<string, PrivacyContent> = {
  es: {
    metaTitle: 'Política de Privacidad y Cookies',
    metaDescription:
      'Política de privacidad y de cookies: responsable del tratamiento, finalidades, base jurídica, conservación, derechos RGPD y uso de cookies.',
    title: 'Política de Privacidad y Cookies',
    intro:
      'En cumplimiento del Reglamento (UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD), le informamos sobre el tratamiento de sus datos personales a través de este sitio web.',
    updatedLabel: 'Última actualización',
    templateNotice:
      'BORRADOR pendiente de revisión jurídica (Fase 0-C, octubre 2026). Los apartados marcados [REVISAR] o [PROPUESTA] deben validarse con un profesional antes de considerar este texto definitivo.',
    responsible: {
      heading: '1. Responsable del tratamiento',
      intro: 'El responsable del tratamiento de sus datos personales es:',
      labels: {
        legalName: 'Razón social',
        cif: 'CIF / NIF',
        address: 'Domicilio',
        email: 'Correo electrónico',
        phone: 'Teléfono',
        web: 'Sitio web',
      },
      fallbackNote:
        'Si algún dato de contacto no figura, puede solicitarlo a través de los canales de contacto publicados en el sitio web.',
    },
    sections: [
      {
        heading: '2. Datos que tratamos',
        paragraphs: [
          'Tratamos los datos que usted nos facilita voluntariamente a través de los formularios del sitio (solicitud de presupuesto rápida, detallada u obra nueva), del chat con nuestro asistente de IA, de la verificación de email y de la agenda de videollamadas, así como los generados durante la relación comercial.',
        ],
        list: [
          'Identificativos y de contacto: nombre, email, teléfono y, si la facilita, dirección.',
          'Datos del proyecto: tipo de obra, descripción, superficie, ubicación (ciudad / código postal), plazo, presupuesto orientativo y las fotos, planos o documentos que adjunte.',
          'Conversación con el asistente de IA: los mensajes e imágenes que envíe en el chat.',
          'Citas: fecha y hora de las videollamadas que reserve.',
          'Datos técnicos y de seguridad: dirección IP (para limitar abusos y proteger los formularios), registros de seguridad y la cookie técnica de sesión descrita en el apartado 10.',
          'Consentimientos: qué casillas ha marcado, cuándo, desde qué formulario y la versión del texto aceptado.',
        ],
      },
      {
        heading: '3. Finalidades',
        paragraphs: [
          'Sus datos se tratan para:',
        ],
        list: [
          'Atender su solicitud y elaborar un presupuesto de construcción o reforma (incluida la estimación preliminar asistida por IA, que siempre revisa una persona de nuestro equipo antes de enviársela).',
          'Verificar su email mediante un código de un solo uso y mantener su sesión en este navegador para que no tenga que volver a identificarse.',
          'Gestionar las videollamadas que reserve (confirmación, cambios y cancelaciones).',
          'Gestionar la relación precontractual y contractual (presupuestos, obras, facturación).',
          'Solo si lo acepta expresamente con la casilla correspondiente: enviarle comunicaciones comerciales sobre nuestros servicios.',
          'Proteger el sitio frente a abusos (límites de envío, detección de intentos de manipulación del asistente).',
          'Cumplir obligaciones legales, fiscales y contables.',
        ],
      },
      {
        heading: '4. Base jurídica (legitimación)',
        list: [
          'Aplicación de medidas precontractuales solicitadas por usted y, en su caso, ejecución del contrato (art. 6.1.b RGPD): presupuesto, citas y obra.',
          'Consentimiento (art. 6.1.a RGPD): comunicaciones comerciales. Puede retirarlo en cualquier momento sin que afecte a la licitud del tratamiento previo.',
          'Interés legítimo (art. 6.1.f RGPD): seguridad del sitio y prevención del fraude.',
          'Cumplimiento de obligaciones legales (art. 6.1.c RGPD): fiscales y contables.',
        ],
      },
      {
        heading: '5. Inteligencia artificial',
        paragraphs: [
          'El chat de este sitio es un asistente de inteligencia artificial, no una persona; se lo indicamos al abrirlo y en la cabecera del chat (Reglamento (UE) 2024/1689 de IA, art. 50). En cualquier momento puede pulsar "Hablar con una persona" y un miembro del equipo revisará la conversación.',
          'Utilizamos modelos Gemini de Google a través de Google Cloud Vertex AI, que actúa como encargado del tratamiento, en servidores de la Unión Europea [REVISAR región configurada, p. ej. europe-southwest1 (Madrid)]. Según las condiciones del proveedor, los datos que enviamos no se utilizan para entrenar sus modelos [REVISAR contrato].',
          'El sistema asigna una puntuación orientativa a cada solicitud para priorizarla. No se toman decisiones basadas únicamente en tratamiento automatizado que le produzcan efectos jurídicos: una persona revisa siempre la solicitud y el presupuesto.',
        ],
      },
      {
        heading: '6. Destinatarios y encargados del tratamiento',
        paragraphs: [
          'No cedemos sus datos a terceros salvo obligación legal. Acceden a ellos, como encargados del tratamiento y con contrato conforme al art. 28 RGPD, los siguientes proveedores [REVISAR lista definitiva]:',
        ],
        list: [
          'Google Cloud / Firebase (Google Ireland Ltd.): base de datos, almacenamiento privado de adjuntos, autenticación y servidores de cálculo. Región UE [REVISAR].',
          'Google Cloud Vertex AI — Gemini (Google Ireland Ltd.): asistente de IA y análisis de la solicitud. Región UE [REVISAR].',
          'Google Workspace / Google Calendar y Meet (Google Ireland Ltd.): agenda e invitaciones a videollamadas.',
          'Resend (Resend, Inc., EE. UU.): envío de emails transaccionales (código de verificación, confirmación de citas, notificaciones).',
          'Vercel (Vercel Inc., EE. UU.): alojamiento y entrega del sitio web [REVISAR si se confirma el hosting].',
          'Gestoría / asesoría fiscal, cuando exista relación contractual.',
          'Próximamente, si se habilita la atención por WhatsApp: Meta Platforms Ireland Ltd. (WhatsApp Business). Le informaremos antes de usar ese canal.',
        ],
      },
      {
        heading: '7. Transferencias internacionales',
        paragraphs: [
          'Algunos proveedores (Resend, Vercel y, en su caso, Google LLC como subencargado) pueden tratar datos fuera del Espacio Económico Europeo, principalmente en EE. UU. Estas transferencias se amparan en el Marco de Privacidad de Datos UE-EE. UU. (decisión de adecuación de 10-07-2023) para las empresas adheridas y/o en las Cláusulas Contractuales Tipo de la Comisión Europea [REVISAR certificación de cada proveedor].',
        ],
      },
      {
        heading: '8. Plazos de conservación',
        paragraphs: [
          '[PROPUESTA — REVISAR con asesoría legal]',
        ],
        list: [
          'Solicitudes de presupuesto y conversaciones del chat sin contratación: 12 meses desde el último contacto; después se suprimen o anonimizan.',
          'Clientes: durante la relación contractual y, después, los plazos legales (6 años documentación mercantil — art. 30 Código de Comercio; 4 años obligaciones tributarias; hasta 10 años por responsabilidades de la edificación — Ley 38/1999 LOE).',
          'Código de verificación: se guarda solo cifrado (hash) y caduca a los 10 minutos.',
          'Sesión de lead en el navegador: 30 días.',
          'Registros de seguridad y límites de uso (incluyen IP): hasta 6 meses.',
          'Comunicaciones comerciales: hasta que retire el consentimiento. Conservamos la prueba del consentimiento o de su retirada mientras puedan exigirse responsabilidades.',
        ],
      },
      {
        heading: '9. Sus derechos',
        paragraphs: [
          'Puede ejercer sus derechos escribiendo al email del responsable indicado arriba, acreditando su identidad:',
        ],
        list: [
          'Acceso, rectificación y supresión de sus datos.',
          'Oposición y limitación del tratamiento.',
          'Portabilidad de los datos.',
          'Retirar en cualquier momento el consentimiento para comunicaciones comerciales.',
          'No ser objeto de decisiones basadas únicamente en tratamiento automatizado.',
          'Presentar una reclamación ante la Agencia Española de Protección de Datos (www.aepd.es).',
        ],
      },
      {
        heading: '10. Cookies y almacenamiento local',
        paragraphs: [
          'Este sitio solo utiliza cookies y almacenamiento local técnicos, necesarios para prestar el servicio que usted solicita, exentos de consentimiento (art. 22.2 LSSI). No usamos cookies analíticas, publicitarias ni de terceros con esas finalidades; por eso no mostramos un banner de cookies. Si en el futuro se incorporan, se pedirá su consentimiento previo.',
        ],
        list: [
          'rg_lead_session (propia, httpOnly, 30 días): recuerda de forma segura que ha verificado su email para gestionar sus solicitudes y citas.',
          'session (propia, httpOnly): sesión de los usuarios del panel profesional.',
          'NEXT_LOCALE (propia, 1 año): idioma elegido.',
          'sidebar_state (propia): preferencia de la interfaz del panel profesional.',
          'Almacenamiento local / de sesión del navegador: estado del chat (historial de la sesión actual, casillas marcadas) y del asistente de presupuesto.',
        ],
      },
      {
        heading: '11. Medidas de seguridad',
        paragraphs: [
          'Aplicamos medidas técnicas y organizativas apropiadas: cifrado en tránsito, adjuntos en almacenamiento privado con enlaces temporales, códigos de verificación cifrados con límite de intentos, sesiones firmadas, control de accesos y límites de uso frente a abusos.',
        ],
      },
      {
        heading: '12. Cambios y legislación aplicable',
        paragraphs: [
          'Esta política puede actualizarse para adaptarse a novedades legislativas o a cambios en los tratamientos. Se rige por el RGPD, la LOPDGDD, la LSSI y el Reglamento (UE) 2024/1689 de Inteligencia Artificial.',
        ],
      },
    ],
  },

  en: {
    metaTitle: 'Privacy and Cookies Policy',
    metaDescription:
      'Privacy and cookies policy: data controller, purposes, legal basis, retention, GDPR rights and use of cookies.',
    title: 'Privacy and Cookies Policy',
    intro:
      'In accordance with Regulation (EU) 2016/679 (GDPR) and Spanish Organic Law 3/2018 on the Protection of Personal Data and the guarantee of digital rights (LOPDGDD), we inform you about how your personal data is processed through this website.',
    updatedLabel: 'Last updated',
    templateNotice:
      'DRAFT pending legal review (Phase 0-C, October 2026). Items marked [REVIEW] or [PROPOSAL] must be validated by a professional before this text is considered final.',
    responsible: {
      heading: '1. Data controller',
      intro: 'The controller responsible for processing your personal data is:',
      labels: {
        legalName: 'Legal name',
        cif: 'Tax ID (CIF/NIF)',
        address: 'Address',
        email: 'Email',
        phone: 'Phone',
        web: 'Website',
      },
      fallbackNote:
        'If any contact detail is missing, you may request it through the contact channels published on the website.',
    },
    sections: [
      {
        heading: '2. Data we process',
        paragraphs: [
          'We process the data you voluntarily provide through the website forms (quick, detailed or new-build quote request), the chat with our AI assistant, email verification and the video-call booking tool, as well as data generated during our commercial relationship.',
        ],
        list: [
          'Identification and contact data: name, email, phone and, if provided, address.',
          'Project data: type of work, description, surface area, location (city / postcode), timeline, indicative budget and any photos, plans or documents you attach.',
          'Conversation with the AI assistant: the messages and images you send in the chat.',
          'Bookings: date and time of the video calls you book.',
          'Technical and security data: IP address (to prevent abuse and protect the forms), security logs and the technical session cookie described in section 10.',
          'Consents: which boxes you ticked, when, from which form and the version of the accepted text.',
        ],
      },
      {
        heading: '3. Purposes',
        paragraphs: [
          'Your data is processed to:',
        ],
        list: [
          'Handle your request and prepare a construction or renovation quote (including an AI-assisted preliminary estimate, always reviewed by a member of our team before it is sent to you).',
          'Verify your email with a one-time code and keep your session in this browser so you do not need to identify yourself again.',
          'Manage the video calls you book (confirmation, changes and cancellations).',
          'Manage the pre-contractual and contractual relationship (quotes, works, invoicing).',
          'Only if you expressly accept it with the corresponding box: send you commercial communications about our services.',
          'Protect the website against abuse (rate limits, detection of attempts to manipulate the assistant).',
          'Comply with legal, tax and accounting obligations.',
        ],
      },
      {
        heading: '4. Legal basis',
        list: [
          'Pre-contractual measures requested by you and, where applicable, performance of the contract (Art. 6(1)(b) GDPR): quote, bookings and works.',
          'Consent (Art. 6(1)(a) GDPR): commercial communications. You may withdraw it at any time without affecting the lawfulness of prior processing.',
          'Legitimate interest (Art. 6(1)(f) GDPR): website security and fraud prevention.',
          'Legal obligations (Art. 6(1)(c) GDPR): tax and accounting.',
        ],
      },
      {
        heading: '5. Artificial intelligence',
        paragraphs: [
          'The chat on this website is an artificial intelligence assistant, not a person; we tell you so when it opens and in the chat header (EU AI Act, Regulation (EU) 2024/1689, Art. 50). At any time you can press "Talk to a person" and a team member will review the conversation.',
          'We use Google Gemini models through Google Cloud Vertex AI, acting as data processor, on servers in the European Union [REVIEW configured region, e.g. europe-southwest1 (Madrid)]. Under the provider terms, the data we send is not used to train its models [REVIEW contract].',
          'The system assigns an indicative score to each request to prioritise it. No decisions producing legal effects are taken solely by automated means: a person always reviews the request and the quote.',
        ],
      },
      {
        heading: '6. Recipients and processors',
        paragraphs: [
          'We do not disclose your data to third parties unless legally required. The following providers access it as processors under an Art. 28 GDPR agreement [REVIEW final list]:',
        ],
        list: [
          'Google Cloud / Firebase (Google Ireland Ltd.): database, private storage of attachments, authentication and compute. EU region [REVIEW].',
          'Google Cloud Vertex AI — Gemini (Google Ireland Ltd.): AI assistant and request analysis. EU region [REVIEW].',
          'Google Workspace / Google Calendar and Meet (Google Ireland Ltd.): scheduling and video-call invitations.',
          'Resend (Resend, Inc., USA): transactional emails (verification code, booking confirmations, notifications).',
          'Vercel (Vercel Inc., USA): website hosting and delivery [REVIEW once hosting is confirmed].',
          'Accounting / tax advisers, where a contractual relationship exists.',
          'In the future, if WhatsApp support is enabled: Meta Platforms Ireland Ltd. (WhatsApp Business). We will inform you before using that channel.',
        ],
      },
      {
        heading: '7. International transfers',
        paragraphs: [
          'Some providers (Resend, Vercel and, where applicable, Google LLC as sub-processor) may process data outside the European Economic Area, mainly in the USA. These transfers rely on the EU-US Data Privacy Framework (adequacy decision of 10 July 2023) for certified companies and/or the European Commission Standard Contractual Clauses [REVIEW each provider].',
        ],
      },
      {
        heading: '8. Retention periods',
        paragraphs: [
          '[PROPOSAL — REVIEW with legal counsel]',
        ],
        list: [
          'Quote requests and chat conversations without a contract: 12 months from the last contact; then deleted or anonymised.',
          'Customers: for the duration of the contract and then the legal periods (6 years commercial records; 4 years tax obligations; up to 10 years building liability under Spanish Law 38/1999).',
          'Verification code: stored only as a hash and expires after 10 minutes.',
          'Lead session in the browser: 30 days.',
          'Security logs and rate limits (including IP): up to 6 months.',
          'Commercial communications: until you withdraw consent. We keep proof of consent or withdrawal while liabilities may arise.',
        ],
      },
      {
        heading: '9. Your rights',
        paragraphs: [
          'You may exercise your rights by writing to the controller email shown above, proving your identity:',
        ],
        list: [
          'Access, rectification and erasure of your data.',
          'Objection and restriction of processing.',
          'Data portability.',
          'Withdraw your consent to commercial communications at any time.',
          'Not to be subject to decisions based solely on automated processing.',
          'Lodge a complaint with the Spanish Data Protection Agency (www.aepd.es).',
        ],
      },
      {
        heading: '10. Cookies and local storage',
        paragraphs: [
          'This website only uses technical cookies and local storage that are necessary to provide the service you request and are exempt from consent (Art. 22.2 Spanish LSSI). We do not use analytics, advertising or third-party cookies for those purposes, which is why we do not show a cookie banner. If they are added in the future, your prior consent will be requested.',
        ],
        list: [
          'rg_lead_session (first-party, httpOnly, 30 days): securely remembers that you verified your email so you can manage your requests and bookings.',
          'session (first-party, httpOnly): session for users of the professional dashboard.',
          'NEXT_LOCALE (first-party, 1 year): chosen language.',
          'sidebar_state (first-party): professional dashboard interface preference.',
          'Browser local / session storage: chat state (current session history, ticked boxes) and quote assistant state.',
        ],
      },
      {
        heading: '11. Security measures',
        paragraphs: [
          'We apply appropriate technical and organisational measures: encryption in transit, attachments in private storage with temporary links, hashed verification codes with attempt limits, signed sessions, access control and rate limits against abuse.',
        ],
      },
      {
        heading: '12. Changes and applicable law',
        paragraphs: [
          'This policy may be updated to reflect legislative changes or changes in processing. It is governed by the GDPR, the Spanish LOPDGDD and LSSI, and the EU AI Act (Regulation (EU) 2024/1689).',
        ],
      },
    ],
  },

  ca: {
    metaTitle: 'Política de Privacitat i Cookies',
    metaDescription:
      'Política de privacitat i de cookies: responsable del tractament, finalitats, base jurídica, conservació, drets RGPD i ús de cookies.',
    title: 'Política de Privacitat i Cookies',
    intro:
      'En compliment del Reglament (UE) 2016/679 (RGPD) i de la Llei Orgànica 3/2018 de Protecció de Dades Personals i garantia dels drets digitals (LOPDGDD), us informem sobre el tractament de les vostres dades personals a través d’aquest lloc web.',
    updatedLabel: 'Darrera actualització',
    templateNotice:
      'ESBORRANY pendent de revisió jurídica (Fase 0-C, octubre 2026). Els apartats marcats [REVISAR] o [PROPOSTA] s’han de validar amb un professional.',
    responsible: {
      heading: '1. Responsable del tractament',
      intro: 'El responsable del tractament de les vostres dades personals és:',
      labels: {
        legalName: 'Raó social',
        cif: 'CIF / NIF',
        address: 'Domicili',
        email: 'Correu electrònic',
        phone: 'Telèfon',
        web: 'Lloc web',
      },
      fallbackNote:
        'Si alguna dada de contacte no hi figura, podeu sol·licitar-la a través dels canals de contacte publicats al lloc web.',
    },
    sections: [
      {
        heading: '2. Dades que tractem',
        paragraphs: [
          'Tractem les dades que ens faciliteu voluntàriament mitjançant els formularis del lloc (sol·licitud de pressupost ràpida, detallada o d’obra nova), el xat amb el nostre assistent d’IA, la verificació del correu i l’agenda de videotrucades, així com les generades durant la relació comercial.',
        ],
        list: [
          'Identificatives i de contacte: nom, correu electrònic, telèfon i, si la faciliteu, adreça.',
          'Dades del projecte: tipus d’obra, descripció, superfície, ubicació, termini, pressupost orientatiu i les fotos, plànols o documents que adjunteu.',
          'Conversa amb l’assistent d’IA: els missatges i imatges que envieu al xat.',
          'Cites: data i hora de les videotrucades que reserveu.',
          'Dades tècniques i de seguretat: adreça IP (per evitar abusos), registres de seguretat i la galeta tècnica de sessió de l’apartat 10.',
          'Consentiments: quines caselles heu marcat, quan, des de quin formulari i la versió del text acceptat.',
        ],
      },
      {
        heading: '3. Finalitats',
        paragraphs: [
          'Les vostres dades es tracten per:',
        ],
        list: [
          'Atendre la sol·licitud i elaborar un pressupost (inclosa l’estimació preliminar assistida per IA, que sempre revisa una persona de l’equip).',
          'Verificar el vostre correu amb un codi d’un sol ús i mantenir la sessió en aquest navegador.',
          'Gestionar les videotrucades que reserveu.',
          'Gestionar la relació precontractual i contractual.',
          'Només si ho accepteu expressament: enviar-vos comunicacions comercials.',
          'Protegir el lloc davant d’abusos.',
          'Complir obligacions legals, fiscals i comptables.',
        ],
      },
      {
        heading: '4. Base jurídica',
        list: [
          'Mesures precontractuals sol·licitades per vós i execució del contracte (art. 6.1.b RGPD).',
          'Consentiment (art. 6.1.a RGPD) per a comunicacions comercials, revocable en qualsevol moment.',
          'Interès legítim (art. 6.1.f RGPD): seguretat del lloc.',
          'Obligacions legals (art. 6.1.c RGPD).',
        ],
      },
      {
        heading: '5. Intel·ligència artificial',
        paragraphs: [
          'El xat és un assistent d’intel·ligència artificial, no una persona; us ho indiquem en obrir-lo i a la capçalera (Reglament (UE) 2024/1689, art. 50). Podeu prémer "Parlar amb una persona" en qualsevol moment.',
          'Utilitzem models Gemini de Google mitjançant Google Cloud Vertex AI, com a encarregat del tractament, en servidors de la UE [REVISAR regió]. Segons les condicions del proveïdor, les dades no s’utilitzen per entrenar els seus models [REVISAR].',
          'La puntuació orientativa de cada sol·licitud no comporta decisions exclusivament automatitzades: una persona revisa sempre la sol·licitud.',
        ],
      },
      {
        heading: '6. Destinataris i encarregats',
        paragraphs: [
          'No cedim dades a tercers llevat d’obligació legal. Hi accedeixen com a encarregats (art. 28 RGPD) [REVISAR llista]:',
        ],
        list: [
          'Google Cloud / Firebase i Vertex AI — Gemini (Google Ireland Ltd.), regió UE [REVISAR].',
          'Google Calendar i Meet (Google Ireland Ltd.): agenda i videotrucades.',
          'Resend (Resend, Inc., EUA): correus transaccionals.',
          'Vercel (Vercel Inc., EUA): allotjament del lloc [REVISAR].',
          'Gestoria, quan hi hagi relació contractual.',
          'En el futur, si s’habilita WhatsApp: Meta Platforms Ireland Ltd.',
        ],
      },
      {
        heading: '7. Transferències internacionals',
        paragraphs: [
          'Alguns proveïdors poden tractar dades fora de l’EEE (principalment als EUA), emparats en el Marc de Privacitat de Dades UE-EUA i/o en les Clàusules Contractuals Tipus [REVISAR].',
        ],
      },
      {
        heading: '8. Terminis de conservació',
        paragraphs: [
          '[PROPOSTA — REVISAR]',
        ],
        list: [
          'Sol·licituds i converses sense contractació: 12 mesos des del darrer contacte.',
          'Clients: durant el contracte i després els terminis legals (6 anys mercantils, 4 anys fiscals, fins a 10 anys LOE).',
          'Codi de verificació: només xifrat (hash), caduca als 10 minuts.',
          'Sessió del navegador: 30 dies. Registres de seguretat (IP): fins a 6 mesos.',
          'Comunicacions comercials: fins que retireu el consentiment.',
        ],
      },
      {
        heading: '9. Els vostres drets',
        paragraphs: [
          'Podeu exercir-los escrivint al correu del responsable, acreditant la vostra identitat:',
        ],
        list: [
          'Accés, rectificació, supressió, oposició, limitació i portabilitat.',
          'Retirar el consentiment per a comunicacions comercials.',
          'No ser objecte de decisions exclusivament automatitzades.',
          'Reclamar davant l’AEPD (www.aepd.es).',
        ],
      },
      {
        heading: '10. Galetes i emmagatzematge local',
        paragraphs: [
          'Només utilitzem galetes i emmagatzematge local tècnics, exempts de consentiment (art. 22.2 LSSI); no n’utilitzem d’analítiques ni publicitàries i per això no mostrem bàner de galetes.',
        ],
        list: [
          'rg_lead_session (pròpia, httpOnly, 30 dies): recorda que heu verificat el correu.',
          'session (pròpia, httpOnly): sessió del tauler professional.',
          'NEXT_LOCALE (pròpia, 1 any): idioma. sidebar_state (pròpia): preferència del tauler.',
          'Emmagatzematge local / de sessió: estat del xat i de l’assistent de pressupost.',
        ],
      },
      {
        heading: '11. Mesures de seguretat',
        paragraphs: [
          'Xifratge en trànsit, adjunts en emmagatzematge privat amb enllaços temporals, codis xifrats amb límit d’intents, sessions signades i límits d’ús.',
        ],
      },
      {
        heading: '12. Canvis i legislació aplicable',
        paragraphs: [
          'Aquesta política es pot actualitzar. Es regeix pel RGPD, la LOPDGDD, la LSSI i el Reglament (UE) 2024/1689 d’IA.',
        ],
      },
    ],
  },

  de: {
    metaTitle: 'Datenschutz- und Cookie-Richtlinie',
    metaDescription:
      'Datenschutz- und Cookie-Richtlinie: Verantwortlicher, Zwecke, Rechtsgrundlage, Speicherung, DSGVO-Rechte und Verwendung von Cookies.',
    title: 'Datenschutz- und Cookie-Richtlinie',
    intro:
      'In Übereinstimmung mit der Verordnung (EU) 2016/679 (DSGVO) und dem spanischen Organgesetz 3/2018 zum Schutz personenbezogener Daten und zur Gewährleistung digitaler Rechte (LOPDGDD) informieren wir Sie über die Verarbeitung Ihrer personenbezogenen Daten über diese Website.',
    updatedLabel: 'Zuletzt aktualisiert',
    templateNotice:
      'ENTWURF zur rechtlichen Prüfung (Phase 0-C, Oktober 2026). Mit [PRÜFEN] oder [VORSCHLAG] markierte Punkte müssen fachlich validiert werden.',
    responsible: {
      heading: '1. Verantwortlicher',
      intro: 'Der für die Verarbeitung Ihrer personenbezogenen Daten Verantwortliche ist:',
      labels: {
        legalName: 'Firmenname',
        cif: 'Steuernummer (CIF/NIF)',
        address: 'Anschrift',
        email: 'E-Mail',
        phone: 'Telefon',
        web: 'Website',
      },
      fallbackNote:
        'Falls eine Kontaktangabe fehlt, können Sie diese über die auf der Website veröffentlichten Kontaktkanäle anfordern.',
    },
    sections: [
      {
        heading: '2. Welche Daten wir verarbeiten',
        paragraphs: [
          'Wir verarbeiten die Daten, die Sie uns freiwillig über die Formulare der Website (Schnell-, Detail- oder Neubau-Angebotsanfrage), den Chat mit unserem KI-Assistenten, die E-Mail-Verifizierung und die Terminbuchung mitteilen, sowie Daten aus der Geschäftsbeziehung.',
        ],
        list: [
          'Identifikations- und Kontaktdaten: Name, E-Mail, Telefon und ggf. Adresse.',
          'Projektdaten: Art der Arbeiten, Beschreibung, Fläche, Ort, Zeitrahmen, Richtbudget sowie beigefügte Fotos, Pläne oder Dokumente.',
          'Gespräch mit dem KI-Assistenten: Nachrichten und Bilder, die Sie im Chat senden.',
          'Termine: Datum und Uhrzeit gebuchter Videogespräche.',
          'Technische und Sicherheitsdaten: IP-Adresse (Missbrauchsschutz), Sicherheitsprotokolle und das technische Sitzungscookie aus Abschnitt 10.',
          'Einwilligungen: welche Kästchen Sie wann, in welchem Formular und mit welcher Textversion angekreuzt haben.',
        ],
      },
      {
        heading: '3. Zwecke',
        paragraphs: [
          'Ihre Daten werden verarbeitet, um:',
        ],
        list: [
          'Ihre Anfrage zu bearbeiten und ein Angebot zu erstellen (einschließlich einer KI-gestützten Vorabschätzung, die stets von einem Teammitglied geprüft wird).',
          'Ihre E-Mail mit einem Einmalcode zu verifizieren und Ihre Sitzung in diesem Browser zu speichern.',
          'Gebuchte Videogespräche zu verwalten.',
          'Die vorvertragliche und vertragliche Beziehung abzuwickeln.',
          'Nur mit Ihrer ausdrücklichen Einwilligung: Ihnen Werbemitteilungen zu senden.',
          'Die Website vor Missbrauch zu schützen und gesetzliche Pflichten zu erfüllen.',
        ],
      },
      {
        heading: '4. Rechtsgrundlage',
        list: [
          'Vorvertragliche Maßnahmen und Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).',
          'Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) für Werbemitteilungen, jederzeit widerrufbar.',
          'Berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO): Sicherheit der Website.',
          'Rechtliche Verpflichtungen (Art. 6 Abs. 1 lit. c DSGVO).',
        ],
      },
      {
        heading: '5. Künstliche Intelligenz',
        paragraphs: [
          'Der Chat ist ein KI-Assistent, keine Person; darauf weisen wir beim Öffnen und in der Kopfzeile hin (KI-Verordnung (EU) 2024/1689, Art. 50). Über "Mit einer Person sprechen" können Sie jederzeit unser Team einschalten.',
          'Wir nutzen Google-Gemini-Modelle über Google Cloud Vertex AI als Auftragsverarbeiter auf Servern in der EU [PRÜFEN: Region]. Laut Anbieterbedingungen werden die Daten nicht zum Training verwendet [PRÜFEN].',
          'Die Bewertung jeder Anfrage dient nur der Priorisierung; es gibt keine ausschließlich automatisierten Entscheidungen mit Rechtswirkung.',
        ],
      },
      {
        heading: '6. Empfänger und Auftragsverarbeiter',
        paragraphs: [
          'Keine Weitergabe an Dritte außer bei gesetzlicher Pflicht. Auftragsverarbeiter (Art. 28 DSGVO) [PRÜFEN]:',
        ],
        list: [
          'Google Cloud / Firebase und Vertex AI — Gemini (Google Ireland Ltd.), EU-Region [PRÜFEN].',
          'Google Calendar und Meet (Google Ireland Ltd.): Termine und Videogespräche.',
          'Resend (Resend, Inc., USA): Transaktions-E-Mails.',
          'Vercel (Vercel Inc., USA): Hosting [PRÜFEN].',
          'Steuerberatung bei bestehender Vertragsbeziehung.',
          'Künftig, falls WhatsApp aktiviert wird: Meta Platforms Ireland Ltd.',
        ],
      },
      {
        heading: '7. Internationale Übermittlungen',
        paragraphs: [
          'Einige Anbieter können Daten außerhalb des EWR (vor allem USA) verarbeiten, gestützt auf das EU-US Data Privacy Framework und/oder EU-Standardvertragsklauseln [PRÜFEN].',
        ],
      },
      {
        heading: '8. Speicherdauer',
        paragraphs: [
          '[VORSCHLAG — PRÜFEN]',
        ],
        list: [
          'Anfragen und Chats ohne Vertrag: 12 Monate ab letztem Kontakt.',
          'Kunden: Vertragsdauer und anschließend gesetzliche Fristen (6 Jahre Handelsrecht, 4 Jahre Steuern, bis zu 10 Jahre Bauhaftung).',
          'Verifizierungscode: nur als Hash, verfällt nach 10 Minuten. Browsersitzung: 30 Tage. Sicherheitsprotokolle (IP): bis zu 6 Monate.',
          'Werbemitteilungen: bis zum Widerruf der Einwilligung.',
        ],
      },
      {
        heading: '9. Ihre Rechte',
        paragraphs: [
          'Wenden Sie sich an die oben genannte E-Mail des Verantwortlichen:',
        ],
        list: [
          'Auskunft, Berichtigung, Löschung, Widerspruch, Einschränkung und Datenübertragbarkeit.',
          'Widerruf der Einwilligung in Werbemitteilungen.',
          'Keine ausschließlich automatisierten Entscheidungen.',
          'Beschwerde bei der spanischen Datenschutzbehörde (www.aepd.es).',
        ],
      },
      {
        heading: '10. Cookies und lokale Speicherung',
        paragraphs: [
          'Wir verwenden nur technisch notwendige Cookies und lokale Speicherung (einwilligungsfrei, Art. 22.2 LSSI); keine Analyse- oder Werbecookies, daher kein Cookie-Banner.',
        ],
        list: [
          'rg_lead_session (eigenes, httpOnly, 30 Tage): merkt sich Ihre E-Mail-Verifizierung.',
          'session (eigenes, httpOnly): Sitzung im Profi-Dashboard.',
          'NEXT_LOCALE (eigenes, 1 Jahr): Sprache. sidebar_state (eigenes): Dashboard-Einstellung.',
          'Lokaler / Sitzungsspeicher: Chat- und Angebotsassistent-Status.',
        ],
      },
      {
        heading: '11. Sicherheitsmaßnahmen',
        paragraphs: [
          'Verschlüsselung bei der Übertragung, private Speicherung von Anhängen mit befristeten Links, gehashte Codes mit Versuchslimit, signierte Sitzungen und Nutzungslimits.',
        ],
      },
      {
        heading: '12. Änderungen und anwendbares Recht',
        paragraphs: [
          'Diese Richtlinie kann aktualisiert werden. Es gelten DSGVO, LOPDGDD, LSSI und die KI-Verordnung (EU) 2024/1689.',
        ],
      },
    ],
  },

  nl: {
    metaTitle: 'Privacy- en Cookiebeleid',
    metaDescription:
      'Privacy- en cookiebeleid: verwerkingsverantwoordelijke, doeleinden, rechtsgrond, bewaring, AVG-rechten en gebruik van cookies.',
    title: 'Privacy- en Cookiebeleid',
    intro:
      'In overeenstemming met Verordening (EU) 2016/679 (AVG) en de Spaanse organieke wet 3/2018 inzake de bescherming van persoonsgegevens en de waarborging van digitale rechten (LOPDGDD) informeren wij u over de verwerking van uw persoonsgegevens via deze website.',
    updatedLabel: 'Laatst bijgewerkt',
    templateNotice:
      'CONCEPT in afwachting van juridische controle (fase 0-C, oktober 2026). Punten gemarkeerd met [CONTROLEREN] of [VOORSTEL] moeten door een professional worden gevalideerd.',
    responsible: {
      heading: '1. Verwerkingsverantwoordelijke',
      intro: 'De verantwoordelijke voor de verwerking van uw persoonsgegevens is:',
      labels: {
        legalName: 'Handelsnaam',
        cif: 'Fiscaal nummer (CIF/NIF)',
        address: 'Adres',
        email: 'E-mail',
        phone: 'Telefoon',
        web: 'Website',
      },
      fallbackNote:
        'Als een contactgegeven ontbreekt, kunt u dit opvragen via de op de website gepubliceerde contactkanalen.',
    },
    sections: [
      {
        heading: '2. Welke gegevens wij verwerken',
        paragraphs: [
          'Wij verwerken de gegevens die u vrijwillig verstrekt via de formulieren van de website (snelle, gedetailleerde of nieuwbouw-offerteaanvraag), de chat met onze AI-assistent, de e-mailverificatie en de afsprakenplanner, en gegevens uit de zakelijke relatie.',
        ],
        list: [
          'Identificatie- en contactgegevens: naam, e-mail, telefoon en eventueel adres.',
          'Projectgegevens: type werk, beschrijving, oppervlakte, locatie, planning, indicatief budget en bijgevoegde foto’s, plannen of documenten.',
          'Gesprek met de AI-assistent: berichten en afbeeldingen die u in de chat stuurt.',
          'Afspraken: datum en tijd van geboekte videogesprekken.',
          'Technische en beveiligingsgegevens: IP-adres (misbruikpreventie), beveiligingslogs en de technische sessiecookie uit sectie 10.',
          'Toestemmingen: welke vakjes u wanneer, in welk formulier en met welke tekstversie heeft aangevinkt.',
        ],
      },
      {
        heading: '3. Doeleinden',
        paragraphs: [
          'Uw gegevens worden verwerkt om:',
        ],
        list: [
          'Uw aanvraag te behandelen en een offerte op te stellen (inclusief een AI-ondersteunde voorlopige raming die altijd door een teamlid wordt gecontroleerd).',
          'Uw e-mail te verifiëren met een eenmalige code en uw sessie in deze browser te bewaren.',
          'Geboekte videogesprekken te beheren.',
          'De precontractuele en contractuele relatie te beheren.',
          'Alleen met uw uitdrukkelijke toestemming: u commerciële berichten te sturen.',
          'De website tegen misbruik te beschermen en wettelijke verplichtingen na te komen.',
        ],
      },
      {
        heading: '4. Rechtsgrond',
        list: [
          'Precontractuele maatregelen en uitvoering van de overeenkomst (art. 6 lid 1 b AVG).',
          'Toestemming (art. 6 lid 1 a AVG) voor commerciële berichten, altijd intrekbaar.',
          'Gerechtvaardigd belang (art. 6 lid 1 f AVG): websitebeveiliging.',
          'Wettelijke verplichtingen (art. 6 lid 1 c AVG).',
        ],
      },
      {
        heading: '5. Kunstmatige intelligentie',
        paragraphs: [
          'De chat is een AI-assistent, geen persoon; dat melden wij bij het openen en in de kop van de chat (AI-verordening (EU) 2024/1689, art. 50). Via "Met een persoon praten" kunt u altijd ons team inschakelen.',
          'Wij gebruiken Google Gemini-modellen via Google Cloud Vertex AI als verwerker, op servers in de EU [CONTROLEREN: regio]. Volgens de voorwaarden van de aanbieder worden de gegevens niet gebruikt voor training [CONTROLEREN].',
          'De score per aanvraag dient alleen voor prioritering; er worden geen uitsluitend geautomatiseerde besluiten met rechtsgevolgen genomen.',
        ],
      },
      {
        heading: '6. Ontvangers en verwerkers',
        paragraphs: [
          'Geen verstrekking aan derden tenzij wettelijk verplicht. Verwerkers (art. 28 AVG) [CONTROLEREN]:',
        ],
        list: [
          'Google Cloud / Firebase en Vertex AI — Gemini (Google Ireland Ltd.), EU-regio [CONTROLEREN].',
          'Google Calendar en Meet (Google Ireland Ltd.): afspraken en videogesprekken.',
          'Resend (Resend, Inc., VS): transactionele e-mails.',
          'Vercel (Vercel Inc., VS): hosting [CONTROLEREN].',
          'Boekhouder bij een bestaande contractuele relatie.',
          'In de toekomst, als WhatsApp wordt ingeschakeld: Meta Platforms Ireland Ltd.',
        ],
      },
      {
        heading: '7. Internationale doorgiften',
        paragraphs: [
          'Sommige aanbieders kunnen gegevens buiten de EER (vooral de VS) verwerken op basis van het EU-VS Data Privacy Framework en/of de modelcontractbepalingen van de Europese Commissie [CONTROLEREN].',
        ],
      },
      {
        heading: '8. Bewaartermijnen',
        paragraphs: [
          '[VOORSTEL — CONTROLEREN]',
        ],
        list: [
          'Aanvragen en chats zonder overeenkomst: 12 maanden na het laatste contact.',
          'Klanten: duur van de overeenkomst en daarna de wettelijke termijnen (6 jaar handelsrecht, 4 jaar fiscaal, tot 10 jaar bouwaansprakelijkheid).',
          'Verificatiecode: alleen als hash, vervalt na 10 minuten. Browsersessie: 30 dagen. Beveiligingslogs (IP): tot 6 maanden.',
          'Commerciële berichten: tot intrekking van de toestemming.',
        ],
      },
      {
        heading: '9. Uw rechten',
        paragraphs: [
          'Neem contact op via het hierboven vermelde e-mailadres van de verwerkingsverantwoordelijke:',
        ],
        list: [
          'Inzage, rectificatie, wissing, bezwaar, beperking en overdraagbaarheid.',
          'Intrekking van uw toestemming voor commerciële berichten.',
          'Geen uitsluitend geautomatiseerde besluiten.',
          'Klacht bij de Spaanse toezichthouder (www.aepd.es).',
        ],
      },
      {
        heading: '10. Cookies en lokale opslag',
        paragraphs: [
          'Wij gebruiken alleen technisch noodzakelijke cookies en lokale opslag (vrijgesteld van toestemming, art. 22.2 LSSI); geen analytische of advertentiecookies, daarom geen cookiebanner.',
        ],
        list: [
          'rg_lead_session (eigen, httpOnly, 30 dagen): onthoudt dat u uw e-mail heeft geverifieerd.',
          'session (eigen, httpOnly): sessie in het professionele dashboard.',
          'NEXT_LOCALE (eigen, 1 jaar): taal. sidebar_state (eigen): dashboardvoorkeur.',
          'Lokale / sessieopslag: status van de chat en de offerte-assistent.',
        ],
      },
      {
        heading: '11. Beveiligingsmaatregelen',
        paragraphs: [
          'Versleuteling tijdens transport, privéopslag van bijlagen met tijdelijke links, gehashte codes met pogingslimiet, ondertekende sessies en gebruikslimieten.',
        ],
      },
      {
        heading: '12. Wijzigingen en toepasselijk recht',
        paragraphs: [
          'Dit beleid kan worden bijgewerkt. Van toepassing zijn de AVG, de LOPDGDD, de LSSI en de AI-verordening (EU) 2024/1689.',
        ],
      },
    ],
  },
};
