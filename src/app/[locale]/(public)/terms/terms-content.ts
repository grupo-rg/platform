/**
 * Contenido localizado del Aviso Legal y las Condiciones de Uso.
 *
 * ⚠️ AVISO IMPORTANTE (leer antes de publicar):
 * Este texto es una PLANTILLA base (LSSI-CE Ley 34/2002 + Código Civil) razonable
 * para una empresa constructora radicada en las Islas Baleares (España). NO
 * constituye asesoramiento jurídico ni un documento legal definitivo. Antes de
 * darle carácter oficial DEBE ser revisado y validado por un profesional del
 * derecho y adaptado a la realidad de la empresa (datos registrales, condiciones
 * de contratación reales, propiedad intelectual, jurisdicción concreta, etc.).
 *
 * Los datos identificativos del titular (razón social, CIF, domicilio, email,
 * teléfono, web) NO se hardcodean aquí: se leen de CompanyConfig
 * (Firestore → Ajustes > Empresa) y se inyectan en la página.
 */

export const TERMS_LAST_UPDATED = '2026-09-26';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface TermsContent {
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  updatedLabel: string;
  templateNotice: string;
  owner: {
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

export const termsContent: Record<string, TermsContent> = {
  es: {
    metaTitle: 'Aviso Legal y Condiciones de Uso',
    metaDescription:
      'Aviso legal y condiciones de uso: datos del titular, objeto, propiedad intelectual, responsabilidad, enlaces y legislación aplicable en España.',
    title: 'Aviso Legal y Condiciones de Uso',
    intro:
      'En cumplimiento del artículo 10 de la Ley 34/2002 de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se ponen a disposición de las personas usuarias los datos identificativos del titular de este sitio web y las condiciones que regulan su uso.',
    updatedLabel: 'Última actualización',
    templateNotice:
      'Documento plantilla pendiente de revisión jurídica. Este texto es orientativo y debe ser validado por un profesional antes de considerarse definitivo.',
    owner: {
      heading: '1. Datos identificativos del titular',
      intro: 'El titular de este sitio web es:',
      labels: {
        legalName: 'Razón social',
        cif: 'CIF / NIF',
        address: 'Domicilio',
        email: 'Correo electrónico',
        phone: 'Teléfono',
        web: 'Sitio web',
      },
      fallbackNote:
        'Los datos de inscripción en el Registro Mercantil se facilitarán cuando resulten aplicables. Si algún dato no figura, puede solicitarlo a través de los canales de contacto del sitio.',
    },
    sections: [
      {
        heading: '2. Objeto',
        paragraphs: [
          'El presente aviso legal regula el acceso, la navegación y el uso de este sitio web, así como las responsabilidades derivadas de dicho uso. El acceso al sitio implica la aceptación de estas condiciones.',
        ],
      },
      {
        heading: '3. Condiciones de uso',
        paragraphs: [
          'La persona usuaria se compromete a utilizar el sitio web y sus contenidos de forma diligente, correcta y lícita, y en particular a no emplearlos con fines ilícitos o lesivos para los derechos e intereses de terceros o del titular.',
        ],
      },
      {
        heading: '4. Presupuestos y contenidos orientativos',
        paragraphs: [
          'Las estimaciones y presupuestos generados o mostrados en el sitio (incluidos los elaborados con asistencia de herramientas automáticas o de inteligencia artificial) tienen carácter meramente orientativo y no vinculante. El presupuesto definitivo requerirá la confirmación expresa del titular tras el estudio del proyecto.',
        ],
      },
      {
        heading: '5. Propiedad intelectual e industrial',
        paragraphs: [
          'Todos los contenidos del sitio (textos, imágenes, marcas, logotipos, diseño y código) son titularidad del titular o de terceros que han autorizado su uso, y están protegidos por la normativa de propiedad intelectual e industrial. Queda prohibida su reproducción, distribución o transformación sin autorización expresa.',
        ],
      },
      {
        heading: '6. Exclusión de responsabilidad',
        paragraphs: [
          'El titular no se hace responsable de los daños o perjuicios derivados de la falta de disponibilidad temporal del sitio, de errores u omisiones en los contenidos, ni del uso indebido que las personas usuarias hagan de la información publicada.',
        ],
      },
      {
        heading: '7. Enlaces',
        paragraphs: [
          'Este sitio puede contener enlaces a sitios de terceros. El titular no asume responsabilidad alguna sobre los contenidos, políticas o prácticas de dichos sitios externos.',
        ],
      },
      {
        heading: '8. Protección de datos',
        paragraphs: [
          'El tratamiento de los datos personales recabados a través del sitio se rige por la Política de Privacidad, que forma parte integrante de este aviso legal.',
        ],
      },
      {
        heading: '9. Legislación aplicable y jurisdicción',
        paragraphs: [
          'Las presentes condiciones se rigen por la legislación española. Para la resolución de cualquier controversia, las partes se someten a los juzgados y tribunales que resulten competentes conforme a la normativa vigente, con domicilio en las Islas Baleares (España) salvo que la ley disponga otra cosa.',
        ],
      },
    ],
  },

  en: {
    metaTitle: 'Legal Notice and Terms of Use',
    metaDescription:
      'Legal notice and terms of use: owner details, purpose, intellectual property, liability, links and applicable Spanish law.',
    title: 'Legal Notice and Terms of Use',
    intro:
      'In accordance with Article 10 of Spanish Law 34/2002 on Information Society and Electronic Commerce Services (LSSI-CE), the identifying details of the owner of this website and the conditions governing its use are made available to users.',
    updatedLabel: 'Last updated',
    templateNotice:
      'Template document pending legal review. This text is indicative and must be validated by a professional before being considered final.',
    owner: {
      heading: '1. Owner identification',
      intro: 'The owner of this website is:',
      labels: {
        legalName: 'Legal name',
        cif: 'Tax ID (CIF/NIF)',
        address: 'Address',
        email: 'Email',
        phone: 'Phone',
        web: 'Website',
      },
      fallbackNote:
        'Commercial Registry details will be provided where applicable. If any detail is missing, you may request it through the contact channels on the site.',
    },
    sections: [
      {
        heading: '2. Purpose',
        paragraphs: [
          'This legal notice governs access to, navigation of and use of this website, as well as the responsibilities arising from such use. Accessing the site implies acceptance of these conditions.',
        ],
      },
      {
        heading: '3. Conditions of use',
        paragraphs: [
          'Users undertake to use the website and its content diligently, correctly and lawfully, and in particular not to use them for unlawful purposes or in ways harmful to the rights and interests of third parties or the owner.',
        ],
      },
      {
        heading: '4. Estimates and indicative content',
        paragraphs: [
          'The estimates and quotes generated or displayed on the site (including those produced with the assistance of automated or artificial intelligence tools) are merely indicative and non-binding. A final quote will require the express confirmation of the owner following a review of the project.',
        ],
      },
      {
        heading: '5. Intellectual and industrial property',
        paragraphs: [
          'All content on the site (texts, images, trademarks, logos, design and code) belongs to the owner or to third parties who have authorised its use, and is protected by intellectual and industrial property law. Its reproduction, distribution or transformation without express authorisation is prohibited.',
        ],
      },
      {
        heading: '6. Disclaimer of liability',
        paragraphs: [
          'The owner is not liable for damages arising from the temporary unavailability of the site, from errors or omissions in the content, or from any misuse users may make of the information published.',
        ],
      },
      {
        heading: '7. Links',
        paragraphs: [
          'This site may contain links to third-party sites. The owner assumes no responsibility for the content, policies or practices of such external sites.',
        ],
      },
      {
        heading: '8. Data protection',
        paragraphs: [
          'The processing of personal data collected through the site is governed by the Privacy Policy, which forms an integral part of this legal notice.',
        ],
      },
      {
        heading: '9. Applicable law and jurisdiction',
        paragraphs: [
          'These conditions are governed by Spanish law. For the resolution of any dispute, the parties submit to the courts and tribunals with jurisdiction under the applicable regulations, located in the Balearic Islands (Spain) unless the law provides otherwise.',
        ],
      },
    ],
  },

  ca: {
    metaTitle: 'Avís Legal i Condicions d’Ús',
    metaDescription:
      'Avís legal i condicions d’ús: dades del titular, objecte, propietat intel·lectual, responsabilitat, enllaços i legislació aplicable a Espanya.',
    title: 'Avís Legal i Condicions d’Ús',
    intro:
      'En compliment de l’article 10 de la Llei 34/2002 de Serveis de la Societat de la Informació i de Comerç Electrònic (LSSI-CE), es posen a disposició de les persones usuàries les dades identificatives del titular d’aquest lloc web i les condicions que en regulen l’ús.',
    updatedLabel: 'Darrera actualització',
    templateNotice:
      'Document plantilla pendent de revisió jurídica. Aquest text és orientatiu i ha de ser validat per un professional abans de considerar-se definitiu.',
    owner: {
      heading: '1. Dades identificatives del titular',
      intro: 'El titular d’aquest lloc web és:',
      labels: {
        legalName: 'Raó social',
        cif: 'CIF / NIF',
        address: 'Domicili',
        email: 'Correu electrònic',
        phone: 'Telèfon',
        web: 'Lloc web',
      },
      fallbackNote:
        'Les dades d’inscripció al Registre Mercantil es facilitaran quan siguin aplicables. Si alguna dada no hi figura, podeu sol·licitar-la a través dels canals de contacte del lloc.',
    },
    sections: [
      {
        heading: '2. Objecte',
        paragraphs: [
          'Aquest avís legal regula l’accés, la navegació i l’ús d’aquest lloc web, així com les responsabilitats derivades d’aquest ús. L’accés al lloc implica l’acceptació d’aquestes condicions.',
        ],
      },
      {
        heading: '3. Condicions d’ús',
        paragraphs: [
          'La persona usuària es compromet a utilitzar el lloc web i els seus continguts de manera diligent, correcta i lícita, i en particular a no emprar-los amb finalitats il·lícites o lesives per als drets i interessos de tercers o del titular.',
        ],
      },
      {
        heading: '4. Pressupostos i continguts orientatius',
        paragraphs: [
          'Les estimacions i pressupostos generats o mostrats al lloc (inclosos els elaborats amb assistència d’eines automàtiques o d’intel·ligència artificial) tenen caràcter merament orientatiu i no vinculant. El pressupost definitiu requerirà la confirmació expressa del titular després de l’estudi del projecte.',
        ],
      },
      {
        heading: '5. Propietat intel·lectual i industrial',
        paragraphs: [
          'Tots els continguts del lloc (textos, imatges, marques, logotips, disseny i codi) són titularitat del titular o de tercers que n’han autoritzat l’ús, i estan protegits per la normativa de propietat intel·lectual i industrial. Se’n prohibeix la reproducció, distribució o transformació sense autorització expressa.',
        ],
      },
      {
        heading: '6. Exclusió de responsabilitat',
        paragraphs: [
          'El titular no es fa responsable dels danys o perjudicis derivats de la manca de disponibilitat temporal del lloc, d’errors o omissions en els continguts, ni de l’ús indegut que les persones usuàries facin de la informació publicada.',
        ],
      },
      {
        heading: '7. Enllaços',
        paragraphs: [
          'Aquest lloc pot contenir enllaços a llocs de tercers. El titular no assumeix cap responsabilitat sobre els continguts, polítiques o pràctiques d’aquests llocs externs.',
        ],
      },
      {
        heading: '8. Protecció de dades',
        paragraphs: [
          'El tractament de les dades personals recollides a través del lloc es regeix per la Política de Privacitat, que forma part integrant d’aquest avís legal.',
        ],
      },
      {
        heading: '9. Legislació aplicable i jurisdicció',
        paragraphs: [
          'Aquestes condicions es regeixen per la legislació espanyola. Per a la resolució de qualsevol controvèrsia, les parts se sotmeten als jutjats i tribunals competents segons la normativa vigent, amb domicili a les Illes Balears (Espanya) llevat que la llei disposi una altra cosa.',
        ],
      },
    ],
  },

  de: {
    metaTitle: 'Impressum und Nutzungsbedingungen',
    metaDescription:
      'Impressum und Nutzungsbedingungen: Angaben zum Betreiber, Zweck, geistiges Eigentum, Haftung, Links und geltendes spanisches Recht.',
    title: 'Impressum und Nutzungsbedingungen',
    intro:
      'Gemäß Artikel 10 des spanischen Gesetzes 34/2002 über Dienste der Informationsgesellschaft und des elektronischen Geschäftsverkehrs (LSSI-CE) werden den Nutzern die Angaben zum Betreiber dieser Website sowie die Bedingungen für ihre Nutzung zur Verfügung gestellt.',
    updatedLabel: 'Zuletzt aktualisiert',
    templateNotice:
      'Vorlagendokument, das noch rechtlich geprüft werden muss. Dieser Text ist orientierend und muss vor der endgültigen Verwendung von einer Fachperson validiert werden.',
    owner: {
      heading: '1. Angaben zum Betreiber',
      intro: 'Der Betreiber dieser Website ist:',
      labels: {
        legalName: 'Firmenname',
        cif: 'Steuernummer (CIF/NIF)',
        address: 'Anschrift',
        email: 'E-Mail',
        phone: 'Telefon',
        web: 'Website',
      },
      fallbackNote:
        'Angaben zur Eintragung im Handelsregister werden bereitgestellt, sofern anwendbar. Falls eine Angabe fehlt, können Sie diese über die Kontaktkanäle der Website anfordern.',
    },
    sections: [
      {
        heading: '2. Gegenstand',
        paragraphs: [
          'Dieses Impressum regelt den Zugang zu, die Navigation auf und die Nutzung dieser Website sowie die sich daraus ergebenden Verantwortlichkeiten. Der Zugang zur Website setzt die Annahme dieser Bedingungen voraus.',
        ],
      },
      {
        heading: '3. Nutzungsbedingungen',
        paragraphs: [
          'Der Nutzer verpflichtet sich, die Website und ihre Inhalte sorgfältig, korrekt und rechtmäßig zu nutzen und sie insbesondere nicht für rechtswidrige Zwecke oder in einer die Rechte und Interessen Dritter oder des Betreibers schädigenden Weise zu verwenden.',
        ],
      },
      {
        heading: '4. Kostenvoranschläge und orientierende Inhalte',
        paragraphs: [
          'Die auf der Website erstellten oder angezeigten Schätzungen und Angebote (einschließlich solcher, die mithilfe automatisierter Werkzeuge oder künstlicher Intelligenz erstellt wurden) sind rein orientierend und unverbindlich. Ein endgültiges Angebot erfordert die ausdrückliche Bestätigung des Betreibers nach Prüfung des Projekts.',
        ],
      },
      {
        heading: '5. Geistiges und gewerbliches Eigentum',
        paragraphs: [
          'Alle Inhalte der Website (Texte, Bilder, Marken, Logos, Design und Code) gehören dem Betreiber oder Dritten, die deren Nutzung genehmigt haben, und sind durch das Recht des geistigen und gewerblichen Eigentums geschützt. Ihre Vervielfältigung, Verbreitung oder Umgestaltung ohne ausdrückliche Genehmigung ist untersagt.',
        ],
      },
      {
        heading: '6. Haftungsausschluss',
        paragraphs: [
          'Der Betreiber haftet nicht für Schäden, die sich aus der vorübergehenden Nichtverfügbarkeit der Website, aus Fehlern oder Auslassungen in den Inhalten oder aus einem unsachgemäßen Gebrauch der veröffentlichten Informationen durch die Nutzer ergeben.',
        ],
      },
      {
        heading: '7. Links',
        paragraphs: [
          'Diese Website kann Links zu Websites Dritter enthalten. Der Betreiber übernimmt keine Verantwortung für die Inhalte, Richtlinien oder Praktiken dieser externen Websites.',
        ],
      },
      {
        heading: '8. Datenschutz',
        paragraphs: [
          'Die Verarbeitung der über die Website erhobenen personenbezogenen Daten unterliegt der Datenschutzrichtlinie, die integraler Bestandteil dieses Impressums ist.',
        ],
      },
      {
        heading: '9. Geltendes Recht und Gerichtsstand',
        paragraphs: [
          'Diese Bedingungen unterliegen dem spanischen Recht. Für die Beilegung von Streitigkeiten unterwerfen sich die Parteien den nach den geltenden Vorschriften zuständigen Gerichten mit Sitz auf den Balearen (Spanien), sofern das Gesetz nichts anderes vorsieht.',
        ],
      },
    ],
  },

  nl: {
    metaTitle: 'Juridische Kennisgeving en Gebruiksvoorwaarden',
    metaDescription:
      'Juridische kennisgeving en gebruiksvoorwaarden: gegevens van de eigenaar, doel, intellectuele eigendom, aansprakelijkheid, links en toepasselijk Spaans recht.',
    title: 'Juridische Kennisgeving en Gebruiksvoorwaarden',
    intro:
      'In overeenstemming met artikel 10 van de Spaanse wet 34/2002 inzake diensten van de informatiemaatschappij en elektronische handel (LSSI-CE) worden aan de gebruikers de identificatiegegevens van de eigenaar van deze website en de voorwaarden voor het gebruik ervan ter beschikking gesteld.',
    updatedLabel: 'Laatst bijgewerkt',
    templateNotice:
      'Sjabloondocument in afwachting van juridische toetsing. Deze tekst is indicatief en moet door een professional worden gevalideerd voordat deze als definitief kan worden beschouwd.',
    owner: {
      heading: '1. Gegevens van de eigenaar',
      intro: 'De eigenaar van deze website is:',
      labels: {
        legalName: 'Handelsnaam',
        cif: 'Fiscaal nummer (CIF/NIF)',
        address: 'Adres',
        email: 'E-mail',
        phone: 'Telefoon',
        web: 'Website',
      },
      fallbackNote:
        'Gegevens over inschrijving in het handelsregister worden verstrekt waar van toepassing. Als een gegeven ontbreekt, kunt u dit opvragen via de contactkanalen van de site.',
    },
    sections: [
      {
        heading: '2. Doel',
        paragraphs: [
          'Deze juridische kennisgeving regelt de toegang tot, de navigatie op en het gebruik van deze website, evenals de daaruit voortvloeiende verantwoordelijkheden. Toegang tot de site impliceert de aanvaarding van deze voorwaarden.',
        ],
      },
      {
        heading: '3. Gebruiksvoorwaarden',
        paragraphs: [
          'De gebruiker verbindt zich ertoe de website en de inhoud ervan zorgvuldig, correct en rechtmatig te gebruiken en deze in het bijzonder niet te gebruiken voor onrechtmatige doeleinden of op een wijze die schadelijk is voor de rechten en belangen van derden of van de eigenaar.',
        ],
      },
      {
        heading: '4. Offertes en indicatieve inhoud',
        paragraphs: [
          'De op de site gegenereerde of weergegeven ramingen en offertes (met inbegrip van die welke zijn opgesteld met behulp van geautomatiseerde tools of kunstmatige intelligentie) zijn louter indicatief en niet-bindend. Een definitieve offerte vereist de uitdrukkelijke bevestiging van de eigenaar na bestudering van het project.',
        ],
      },
      {
        heading: '5. Intellectuele en industriële eigendom',
        paragraphs: [
          'Alle inhoud op de site (teksten, afbeeldingen, merken, logo’s, ontwerp en code) is eigendom van de eigenaar of van derden die het gebruik ervan hebben toegestaan, en is beschermd door de wetgeving inzake intellectuele en industriële eigendom. Reproductie, distributie of bewerking zonder uitdrukkelijke toestemming is verboden.',
        ],
      },
      {
        heading: '6. Uitsluiting van aansprakelijkheid',
        paragraphs: [
          'De eigenaar is niet aansprakelijk voor schade als gevolg van de tijdelijke onbeschikbaarheid van de site, van fouten of weglatingen in de inhoud, of van oneigenlijk gebruik dat gebruikers maken van de gepubliceerde informatie.',
        ],
      },
      {
        heading: '7. Links',
        paragraphs: [
          'Deze site kan links naar sites van derden bevatten. De eigenaar aanvaardt geen enkele verantwoordelijkheid voor de inhoud, het beleid of de praktijken van dergelijke externe sites.',
        ],
      },
      {
        heading: '8. Gegevensbescherming',
        paragraphs: [
          'De verwerking van de via de site verzamelde persoonsgegevens valt onder het Privacybeleid, dat een integraal onderdeel van deze juridische kennisgeving vormt.',
        ],
      },
      {
        heading: '9. Toepasselijk recht en bevoegde rechtbank',
        paragraphs: [
          'Deze voorwaarden vallen onder het Spaanse recht. Voor de beslechting van geschillen onderwerpen de partijen zich aan de volgens de geldende regelgeving bevoegde rechtbanken, gevestigd op de Balearen (Spanje), tenzij de wet anders bepaalt.',
        ],
      },
    ],
  },
};
