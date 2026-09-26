/**
 * Contenido localizado de la Política de Privacidad y Cookies.
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

export const PRIVACY_LAST_UPDATED = '2026-09-26';

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
      'Documento plantilla pendiente de revisión jurídica. Este texto es orientativo y debe ser validado por un profesional antes de considerarse definitivo.',
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
          'Tratamos los datos que usted nos facilita voluntariamente a través de los formularios del sitio (solicitud de presupuesto, contacto, alta de cuenta) y aquellos generados durante la relación comercial.',
        ],
        list: [
          'Datos identificativos y de contacto: nombre, apellidos, teléfono, correo electrónico y dirección.',
          'Datos sobre el proyecto: descripción de la obra o reforma, ubicación, documentos o imágenes que aporte.',
          'Datos de navegación y técnicos: dirección IP, tipo de dispositivo y datos de uso recopilados mediante cookies.',
        ],
      },
      {
        heading: '3. Finalidad del tratamiento',
        paragraphs: [
          'Sus datos se tratan para las siguientes finalidades:',
        ],
        list: [
          'Atender sus solicitudes de información y elaborar presupuestos de construcción o reforma.',
          'Gestionar la relación contractual y la prestación de los servicios contratados.',
          'Enviar comunicaciones relacionadas con los servicios solicitados.',
          'Cumplir con las obligaciones legales, fiscales y contables aplicables.',
        ],
      },
      {
        heading: '4. Base jurídica (legitimación)',
        paragraphs: [
          'La base legal del tratamiento es el consentimiento del interesado, la ejecución de un contrato o de medidas precontractuales solicitadas por usted, el cumplimiento de obligaciones legales del responsable y el interés legítimo en gestionar la relación comercial.',
        ],
      },
      {
        heading: '5. Plazo de conservación',
        paragraphs: [
          'Los datos se conservarán mientras se mantenga la relación comercial y, tras su finalización, durante los plazos legalmente exigidos para atender posibles responsabilidades (por ejemplo, obligaciones fiscales, mercantiles y de garantía de obra).',
        ],
      },
      {
        heading: '6. Destinatarios y cesiones',
        paragraphs: [
          'No se cederán datos a terceros salvo obligación legal. Podrán acceder a sus datos los proveedores de servicios que actúan como encargados del tratamiento (alojamiento web, correo electrónico, gestoría), con los que se suscriben los correspondientes contratos de encargo.',
        ],
      },
      {
        heading: '7. Sus derechos',
        paragraphs: [
          'Puede ejercer los siguientes derechos dirigiéndose al responsable a través del correo electrónico indicado, acreditando su identidad:',
        ],
        list: [
          'Acceso a sus datos personales.',
          'Rectificación de datos inexactos.',
          'Supresión de sus datos (derecho al olvido).',
          'Oposición al tratamiento.',
          'Limitación del tratamiento.',
          'Portabilidad de los datos.',
          'Reclamación ante la Agencia Española de Protección de Datos (www.aepd.es) si considera que sus derechos no han sido atendidos.',
        ],
      },
      {
        heading: '8. Política de cookies',
        paragraphs: [
          'Este sitio web puede utilizar cookies propias y de terceros. Las cookies son pequeños archivos que se almacenan en su dispositivo. Puede configurar o rechazar su uso desde el banner de consentimiento o desde la configuración de su navegador.',
        ],
        list: [
          'Cookies técnicas o necesarias: imprescindibles para el funcionamiento del sitio.',
          'Cookies de preferencias: recuerdan opciones como el idioma.',
          'Cookies analíticas: permiten medir el uso del sitio de forma agregada.',
        ],
      },
      {
        heading: '9. Medidas de seguridad',
        paragraphs: [
          'El responsable aplica las medidas técnicas y organizativas apropiadas para garantizar la seguridad de los datos y evitar su alteración, pérdida, tratamiento o acceso no autorizado.',
        ],
      },
      {
        heading: '10. Cambios y legislación aplicable',
        paragraphs: [
          'Esta política puede actualizarse para adaptarse a novedades legislativas o a cambios en los tratamientos. El tratamiento de datos se rige por la legislación española y de la Unión Europea.',
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
      'Template document pending legal review. This text is indicative and must be validated by a professional before being considered final.',
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
          'We process the data you voluntarily provide through the website forms (budget request, contact, account registration) and data generated during our commercial relationship.',
        ],
        list: [
          'Identification and contact data: name, surname, phone, email and address.',
          'Project data: description of the work or renovation, location, and any documents or images you provide.',
          'Browsing and technical data: IP address, device type and usage data collected through cookies.',
        ],
      },
      {
        heading: '3. Purpose of processing',
        paragraphs: ['Your data is processed for the following purposes:'],
        list: [
          'To respond to your requests for information and to prepare construction or renovation quotes.',
          'To manage the contractual relationship and provide the contracted services.',
          'To send communications related to the services requested.',
          'To comply with applicable legal, tax and accounting obligations.',
        ],
      },
      {
        heading: '4. Legal basis',
        paragraphs: [
          'The legal basis for processing is the data subject’s consent, the performance of a contract or pre-contractual measures requested by you, compliance with the controller’s legal obligations, and the legitimate interest in managing the commercial relationship.',
        ],
      },
      {
        heading: '5. Retention period',
        paragraphs: [
          'Data will be retained for the duration of the commercial relationship and, after it ends, for the periods legally required to address potential liabilities (for example, tax, commercial and construction warranty obligations).',
        ],
      },
      {
        heading: '6. Recipients and disclosures',
        paragraphs: [
          'Data will not be disclosed to third parties except where legally required. Service providers acting as data processors (web hosting, email, accounting) may access your data under the corresponding data processing agreements.',
        ],
      },
      {
        heading: '7. Your rights',
        paragraphs: [
          'You may exercise the following rights by contacting the controller at the email address provided, proving your identity:',
        ],
        list: [
          'Access to your personal data.',
          'Rectification of inaccurate data.',
          'Erasure of your data (right to be forgotten).',
          'Objection to processing.',
          'Restriction of processing.',
          'Data portability.',
          'Complaint to the Spanish Data Protection Agency (www.aepd.es) if you believe your rights have not been respected.',
        ],
      },
      {
        heading: '8. Cookies policy',
        paragraphs: [
          'This website may use its own and third-party cookies. Cookies are small files stored on your device. You can configure or reject their use from the consent banner or your browser settings.',
        ],
        list: [
          'Technical or necessary cookies: essential for the website to function.',
          'Preference cookies: remember options such as language.',
          'Analytics cookies: allow aggregated measurement of site usage.',
        ],
      },
      {
        heading: '9. Security measures',
        paragraphs: [
          'The controller applies appropriate technical and organisational measures to ensure the security of the data and prevent its alteration, loss, unauthorised processing or access.',
        ],
      },
      {
        heading: '10. Changes and applicable law',
        paragraphs: [
          'This policy may be updated to reflect legislative changes or changes in processing activities. Data processing is governed by Spanish and European Union law.',
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
      'Document plantilla pendent de revisió jurídica. Aquest text és orientatiu i ha de ser validat per un professional abans de considerar-se definitiu.',
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
          'Tractem les dades que ens faciliteu voluntàriament a través dels formularis del lloc (sol·licitud de pressupost, contacte, alta de compte) i les generades durant la relació comercial.',
        ],
        list: [
          'Dades identificatives i de contacte: nom, cognoms, telèfon, correu electrònic i adreça.',
          'Dades sobre el projecte: descripció de l’obra o reforma, ubicació, documents o imatges que aporteu.',
          'Dades de navegació i tècniques: adreça IP, tipus de dispositiu i dades d’ús recollides mitjançant cookies.',
        ],
      },
      {
        heading: '3. Finalitat del tractament',
        paragraphs: ['Les vostres dades es tracten amb les finalitats següents:'],
        list: [
          'Atendre les vostres sol·licituds d’informació i elaborar pressupostos de construcció o reforma.',
          'Gestionar la relació contractual i la prestació dels serveis contractats.',
          'Enviar comunicacions relacionades amb els serveis sol·licitats.',
          'Complir les obligacions legals, fiscals i comptables aplicables.',
        ],
      },
      {
        heading: '4. Base jurídica (legitimació)',
        paragraphs: [
          'La base legal del tractament és el consentiment de la persona interessada, l’execució d’un contracte o de mesures precontractuals sol·licitades per vós, el compliment d’obligacions legals del responsable i l’interès legítim a gestionar la relació comercial.',
        ],
      },
      {
        heading: '5. Termini de conservació',
        paragraphs: [
          'Les dades es conservaran mentre es mantingui la relació comercial i, en finalitzar, durant els terminis legalment exigits per atendre possibles responsabilitats (per exemple, obligacions fiscals, mercantils i de garantia d’obra).',
        ],
      },
      {
        heading: '6. Destinataris i cessions',
        paragraphs: [
          'No se cediran dades a tercers llevat d’obligació legal. Hi poden accedir els proveïdors de serveis que actuen com a encarregats del tractament (allotjament web, correu electrònic, gestoria), amb els quals se subscriuen els contractes d’encàrrec corresponents.',
        ],
      },
      {
        heading: '7. Els vostres drets',
        paragraphs: [
          'Podeu exercir els drets següents adreçant-vos al responsable a través del correu electrònic indicat, acreditant la vostra identitat:',
        ],
        list: [
          'Accés a les vostres dades personals.',
          'Rectificació de dades inexactes.',
          'Supressió de les dades (dret a l’oblit).',
          'Oposició al tractament.',
          'Limitació del tractament.',
          'Portabilitat de les dades.',
          'Reclamació davant l’Agència Espanyola de Protecció de Dades (www.aepd.es) si considereu que els vostres drets no s’han atès.',
        ],
      },
      {
        heading: '8. Política de cookies',
        paragraphs: [
          'Aquest lloc web pot utilitzar cookies pròpies i de tercers. Les cookies són petits fitxers que s’emmagatzemen al vostre dispositiu. Podeu configurar-ne o rebutjar-ne l’ús des del bàner de consentiment o des de la configuració del navegador.',
        ],
        list: [
          'Cookies tècniques o necessàries: imprescindibles per al funcionament del lloc.',
          'Cookies de preferències: recorden opcions com l’idioma.',
          'Cookies analítiques: permeten mesurar l’ús del lloc de manera agregada.',
        ],
      },
      {
        heading: '9. Mesures de seguretat',
        paragraphs: [
          'El responsable aplica les mesures tècniques i organitzatives apropiades per garantir la seguretat de les dades i evitar-ne l’alteració, pèrdua, tractament o accés no autoritzat.',
        ],
      },
      {
        heading: '10. Canvis i legislació aplicable',
        paragraphs: [
          'Aquesta política es pot actualitzar per adaptar-se a novetats legislatives o a canvis en els tractaments. El tractament de dades es regeix per la legislació espanyola i de la Unió Europea.',
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
      'Vorlagendokument, das noch rechtlich geprüft werden muss. Dieser Text ist orientierend und muss vor der endgültigen Verwendung von einer Fachperson validiert werden.',
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
        heading: '2. Verarbeitete Daten',
        paragraphs: [
          'Wir verarbeiten die Daten, die Sie uns freiwillig über die Formulare der Website (Angebotsanfrage, Kontakt, Kontoregistrierung) übermitteln, sowie die während der Geschäftsbeziehung entstehenden Daten.',
        ],
        list: [
          'Identifikations- und Kontaktdaten: Name, Nachname, Telefon, E-Mail und Anschrift.',
          'Projektdaten: Beschreibung der Bau- oder Renovierungsarbeiten, Standort sowie von Ihnen bereitgestellte Dokumente oder Bilder.',
          'Navigations- und technische Daten: IP-Adresse, Gerätetyp und über Cookies erfasste Nutzungsdaten.',
        ],
      },
      {
        heading: '3. Zweck der Verarbeitung',
        paragraphs: ['Ihre Daten werden zu folgenden Zwecken verarbeitet:'],
        list: [
          'Bearbeitung Ihrer Informationsanfragen und Erstellung von Bau- oder Renovierungsangeboten.',
          'Verwaltung der Vertragsbeziehung und Erbringung der beauftragten Leistungen.',
          'Versand von Mitteilungen im Zusammenhang mit den angeforderten Leistungen.',
          'Erfüllung der geltenden rechtlichen, steuerlichen und buchhalterischen Pflichten.',
        ],
      },
      {
        heading: '4. Rechtsgrundlage',
        paragraphs: [
          'Rechtsgrundlage der Verarbeitung sind die Einwilligung der betroffenen Person, die Erfüllung eines Vertrags oder vorvertraglicher Maßnahmen auf Ihre Anfrage, die Erfüllung der rechtlichen Pflichten des Verantwortlichen sowie das berechtigte Interesse an der Verwaltung der Geschäftsbeziehung.',
        ],
      },
      {
        heading: '5. Speicherdauer',
        paragraphs: [
          'Die Daten werden für die Dauer der Geschäftsbeziehung und nach deren Ende für die gesetzlich vorgeschriebenen Fristen gespeichert, um mögliche Haftungsansprüche zu bearbeiten (z. B. steuerliche, handelsrechtliche und baugewährleistungsbezogene Pflichten).',
        ],
      },
      {
        heading: '6. Empfänger und Weitergabe',
        paragraphs: [
          'Daten werden nur bei gesetzlicher Verpflichtung an Dritte weitergegeben. Dienstleister, die als Auftragsverarbeiter handeln (Webhosting, E-Mail, Buchhaltung), können im Rahmen entsprechender Auftragsverarbeitungsverträge auf Ihre Daten zugreifen.',
        ],
      },
      {
        heading: '7. Ihre Rechte',
        paragraphs: [
          'Sie können die folgenden Rechte ausüben, indem Sie sich unter Nachweis Ihrer Identität an die angegebene E-Mail-Adresse des Verantwortlichen wenden:',
        ],
        list: [
          'Auskunft über Ihre personenbezogenen Daten.',
          'Berichtigung unrichtiger Daten.',
          'Löschung Ihrer Daten (Recht auf Vergessenwerden).',
          'Widerspruch gegen die Verarbeitung.',
          'Einschränkung der Verarbeitung.',
          'Datenübertragbarkeit.',
          'Beschwerde bei der spanischen Datenschutzbehörde (www.aepd.es), wenn Sie der Ansicht sind, dass Ihre Rechte nicht gewahrt wurden.',
        ],
      },
      {
        heading: '8. Cookie-Richtlinie',
        paragraphs: [
          'Diese Website kann eigene und Cookies von Drittanbietern verwenden. Cookies sind kleine Dateien, die auf Ihrem Gerät gespeichert werden. Sie können deren Verwendung über das Einwilligungsbanner oder die Einstellungen Ihres Browsers konfigurieren oder ablehnen.',
        ],
        list: [
          'Technische oder notwendige Cookies: unerlässlich für den Betrieb der Website.',
          'Präferenz-Cookies: speichern Optionen wie die Sprache.',
          'Analyse-Cookies: ermöglichen eine aggregierte Messung der Website-Nutzung.',
        ],
      },
      {
        heading: '9. Sicherheitsmaßnahmen',
        paragraphs: [
          'Der Verantwortliche wendet geeignete technische und organisatorische Maßnahmen an, um die Sicherheit der Daten zu gewährleisten und deren Veränderung, Verlust, unbefugte Verarbeitung oder unbefugten Zugriff zu verhindern.',
        ],
      },
      {
        heading: '10. Änderungen und geltendes Recht',
        paragraphs: [
          'Diese Richtlinie kann aktualisiert werden, um gesetzlichen Neuerungen oder Änderungen der Verarbeitung Rechnung zu tragen. Die Datenverarbeitung unterliegt spanischem und EU-Recht.',
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
      'Sjabloondocument in afwachting van juridische toetsing. Deze tekst is indicatief en moet door een professional worden gevalideerd voordat deze als definitief kan worden beschouwd.',
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
        heading: '2. Gegevens die wij verwerken',
        paragraphs: [
          'Wij verwerken de gegevens die u vrijwillig verstrekt via de formulieren op de website (offerteaanvraag, contact, accountregistratie) en de gegevens die tijdens de commerciële relatie worden gegenereerd.',
        ],
        list: [
          'Identificatie- en contactgegevens: naam, achternaam, telefoon, e-mail en adres.',
          'Projectgegevens: beschrijving van de bouw of renovatie, locatie en door u aangeleverde documenten of afbeeldingen.',
          'Navigatie- en technische gegevens: IP-adres, apparaattype en via cookies verzamelde gebruiksgegevens.',
        ],
      },
      {
        heading: '3. Doel van de verwerking',
        paragraphs: ['Uw gegevens worden voor de volgende doeleinden verwerkt:'],
        list: [
          'Beantwoorden van uw informatieverzoeken en het opstellen van bouw- of renovatieoffertes.',
          'Beheren van de contractuele relatie en het leveren van de afgesproken diensten.',
          'Versturen van communicatie met betrekking tot de gevraagde diensten.',
          'Voldoen aan de toepasselijke wettelijke, fiscale en boekhoudkundige verplichtingen.',
        ],
      },
      {
        heading: '4. Rechtsgrond',
        paragraphs: [
          'De rechtsgrond voor de verwerking is de toestemming van de betrokkene, de uitvoering van een overeenkomst of precontractuele maatregelen op uw verzoek, het nakomen van de wettelijke verplichtingen van de verantwoordelijke en het gerechtvaardigd belang bij het beheer van de commerciële relatie.',
        ],
      },
      {
        heading: '5. Bewaartermijn',
        paragraphs: [
          'De gegevens worden bewaard zolang de commerciële relatie voortduurt en, na beëindiging, gedurende de wettelijk vereiste termijnen om mogelijke aansprakelijkheden af te handelen (bijvoorbeeld fiscale, handels- en bouwgarantieverplichtingen).',
        ],
      },
      {
        heading: '6. Ontvangers en doorgifte',
        paragraphs: [
          'Gegevens worden niet aan derden verstrekt, behalve wanneer dit wettelijk verplicht is. Dienstverleners die optreden als verwerker (webhosting, e-mail, boekhouding) kunnen toegang hebben tot uw gegevens op basis van de bijbehorende verwerkersovereenkomsten.',
        ],
      },
      {
        heading: '7. Uw rechten',
        paragraphs: [
          'U kunt de volgende rechten uitoefenen door contact op te nemen met de verantwoordelijke via het opgegeven e-mailadres, onder vermelding van uw identiteit:',
        ],
        list: [
          'Toegang tot uw persoonsgegevens.',
          'Rectificatie van onjuiste gegevens.',
          'Wissing van uw gegevens (recht op vergetelheid).',
          'Bezwaar tegen de verwerking.',
          'Beperking van de verwerking.',
          'Overdraagbaarheid van gegevens.',
          'Klacht bij het Spaanse gegevensbeschermingsautoriteit (www.aepd.es) als u van mening bent dat uw rechten niet zijn gerespecteerd.',
        ],
      },
      {
        heading: '8. Cookiebeleid',
        paragraphs: [
          'Deze website kan eigen cookies en cookies van derden gebruiken. Cookies zijn kleine bestanden die op uw apparaat worden opgeslagen. U kunt het gebruik ervan configureren of weigeren via de toestemmingsbanner of de instellingen van uw browser.',
        ],
        list: [
          'Technische of noodzakelijke cookies: essentieel voor de werking van de website.',
          'Voorkeurscookies: onthouden opties zoals de taal.',
          'Analytische cookies: maken een geaggregeerde meting van het sitegebruik mogelijk.',
        ],
      },
      {
        heading: '9. Beveiligingsmaatregelen',
        paragraphs: [
          'De verantwoordelijke past passende technische en organisatorische maatregelen toe om de beveiliging van de gegevens te waarborgen en wijziging, verlies, onbevoegde verwerking of toegang te voorkomen.',
        ],
      },
      {
        heading: '10. Wijzigingen en toepasselijk recht',
        paragraphs: [
          'Dit beleid kan worden bijgewerkt om rekening te houden met wetswijzigingen of veranderingen in de verwerkingen. De gegevensverwerking valt onder het Spaanse en het EU-recht.',
        ],
      },
    ],
  },
};
