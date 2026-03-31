export const serviceSlugMap: Record<string, Record<string, string>> = {
  // es is identical to id
  'construccion-y-reformas': {
    en: 'construction-and-renovations',
    ca: 'construccio-i-reformes',
    de: 'bau-und-renovierungen',
    nl: 'bouw-en-renovaties',
  },
  'piscinas': {
    en: 'pools',
    ca: 'piscines',
    de: 'pools',
    nl: 'zwembaden',
  },
  'reformas-de-interiores': {
    en: 'interior-renovations',
    ca: 'reformes-dinteriors',
    de: 'innenausbau',
    nl: 'interieur-renovaties',
  },
  'paramentos-verticales': {
    en: 'vertical-walls',
    ca: 'paraments-verticals',
    de: 'vertikale-waende',
    nl: 'verticale-wanden',
  },
  'pintura': {
    en: 'painting',
    ca: 'pintura',
    de: 'malerei',
    nl: 'schilderwerk',
  },
  'impermeabilizacion': {
    en: 'waterproofing',
    ca: 'impermeabilitzacio',
    de: 'abdichtung',
    nl: 'waterdichting',
  },
  'electricidad': {
    en: 'electricity',
    ca: 'electricitat',
    de: 'elektrizitaet',
    nl: 'elektriciteit',
  },
  'carpinteria': {
    en: 'carpentry',
    ca: 'fusteria',
    de: 'schreinerei',
    nl: 'timmerwerk',
  },
  'fontaneria': {
    en: 'plumbing',
    ca: 'lampisteria',
    de: 'klempnerarbeiten',
    nl: 'loodgieterij',
  },
};

export const subserviceSlugMap: Record<string, Record<string, string>> = {
  // construccion-y-reformas
  'gestion-integral-obra-nueva': {
    en: 'comprehensive-new-build',
    ca: 'gestio-integral-obra-nova',
    de: 'neubau-komplettverwaltung',
    nl: 'nieuwbouw-beheer',
  },
  'reformas-integrales-viviendas-locales': {
    en: 'comprehensive-renovations',
    ca: 'reformes-integrals',
    de: 'komplettsanierungen',
    nl: 'volledige-renovaties',
  },
  'ampliaciones-redistribucion': {
    en: 'extensions-redistribution',
    ca: 'ampliacions-redistribucio',
    de: 'erweiterungen-neuaufteilung',
    nl: 'uitbreidingen-herindeling',
  },
  'asesoramiento-materiales-construccion': {
    en: 'materials-consultancy',
    ca: 'assessorament-materials',
    de: 'materialberatung',
    nl: 'materialenadvies',
  },
  // piscinas
  'diseno-personalizado': {
    en: 'custom-design',
    ca: 'disseny-personalitzat',
    de: 'individuelles-design',
    nl: 'aangepast-ontwerp',
  },
  'construccion-gunitado': {
    en: 'shotcrete-construction',
    ca: 'construccio-gunitat',
    de: 'spritzbetonbau',
    nl: 'spuitbeton-constructie',
  },
  'sistemas-cloracion-salina': {
    en: 'saline-chlorination',
    ca: 'sistemes-cloracio-salina',
    de: 'salzchlorierung',
    nl: 'zoutchlorering',
  },
  'mantenimiento-reparacion': {
    en: 'maintenance-repair',
    ca: 'manteniment-reparacio',
    de: 'wartung-reparatur',
    nl: 'onderhoud-reparatie',
  },
  // reformas-de-interiores
  'alicatados-pavimentos': {
    en: 'tiling-flooring',
    ca: 'enrajolats-paviments',
    de: 'fliesen-bodenbelaege',
    nl: 'tegelwerk-vloeren',
  },
  'instalaciones-fontaneria-electricidad': {
    en: 'technical-installations',
    ca: 'installacions-tecniques',
    de: 'technische-installationen',
    nl: 'technische-installaties',
  },
  'mobiliario-medida': {
    en: 'custom-furniture',
    ca: 'mobiliari-mida',
    de: 'massmoebel',
    nl: 'maatwerk-meubels',
  },
  'banos-sanitarios': {
    en: 'bathroom-equipment',
    ca: 'banys-sanitaris',
    de: 'badezimmerausstattung',
    nl: 'badkamer-uitrusting',
  },
  // paramentos-verticales
  'revestimientos-continuos': {
    en: 'continuous-coatings',
    ca: 'revestiments-continus',
    de: 'beschichtungen',
    nl: 'coatings',
  },
  'aislamiento-sate': {
    en: 'etics-insulation',
    ca: 'aillament-sate',
    de: 'wdvs-isolierung',
    nl: 'gevelisolatie',
  },
  'rehabilitacion-fachadas': {
    en: 'facade-rehabilitation',
    ca: 'rehabilitacio-façanes',
    de: 'fassadensanierung',
    nl: 'gevel-renovatie',
  },
  'pintura-impermeabilizacion-exterior': {
    en: 'exterior-painting-waterproofing',
    ca: 'pintura-impermeabilitzacio',
    de: 'aussenanstrich-abdichtung',
    nl: 'buitenschilderwerk-waterdichting',
  },
  // pintura
  'pintura-interior-decorativa': {
    en: 'interior-decorative-painting',
    ca: 'pintura-interior-decorativa',
    de: 'innen-dekorationsmalerei',
    nl: 'binnen-decoratief-schilderen',
  },
  'pintura-fachadas': {
    en: 'facade-painting',
    ca: 'pintura-façanes',
    de: 'fassadenmalerei',
    nl: 'gevelschilderwerk',
  },
  'alisado-paredes': {
    en: 'wall-smoothing',
    ca: 'allisat-parets',
    de: 'wandglaetten',
    nl: 'wand-gladzuigen',
  },
  'tratamiento-humedades': {
    en: 'moisture-treatment',
    ca: 'tractament-humitats',
    de: 'feuchtigkeitsbehandlung',
    nl: 'vochtbehandeling',
  },
  // impermeabilizacion
  'cubiertas-planas-terrazas': {
    en: 'flat-roofs-terraces',
    ca: 'cobertes-planes-terrasses',
    de: 'flachdaecher-terrassen',
    nl: 'platte-daken-terrassen',
  },
  'reparacion-tejados': {
    en: 'roof-repair',
    ca: 'reparacio-teulades',
    de: 'dachreparatur',
    nl: 'dakreparatie',
  },
  'laminas-membranas': {
    en: 'technical-sheets',
    ca: 'lamines-membranes',
    de: 'technische-folien',
    nl: 'technische-platen',
  },
  'aislamiento-cubiertas': {
    en: 'roof-insulation',
    ca: 'aillament-cobertes',
    de: 'dachisolierung',
    nl: 'dakisolatie',
  },
  // electricidad
  'instalaciones-obra-nueva': {
    en: 'new-build-installations',
    ca: 'installacions-obra-nova',
    de: 'neubau-installationen',
    nl: 'nieuwbouw-installaties',
  },
  'actualizacion-reforma-electrica': {
    en: 'electrical-upgrade',
    ca: 'actualitzacio-electrica',
    de: 'elektrische-aufrüstung',
    nl: 'elektrische-upgrade',
  },
  'boletines-certificaciones': {
    en: 'bulletins-certifications',
    ca: 'butlletins-certificacions',
    de: 'zertifikate',
    nl: 'certificeringen',
  },
  'iluminacion-led': {
    en: 'led-lighting',
    ca: 'illuminacio-led',
    de: 'led-beleuchtung',
    nl: 'led-verlichting',
  },
  // carpinteria
  'ventanas-puertas-aluminio-pvc': {
    en: 'aluminum-pvc-windows-doors',
    ca: 'finestres-portes-alumini-pvc',
    de: 'aluminium-pvc-fenster-tueren',
    nl: 'aluminium-pvc-ramen-deuren',
  },
  'cerramientos-pergolas': {
    en: 'enclosures-pergolas',
    ca: 'tancaments-pergoles',
    de: 'ueberdachungen-pergolen',
    nl: 'overkappingen-pergolas',
  },
  'puertas-paso-entrada': {
    en: 'passage-entrance-doors',
    ca: 'portes-pas-entrada',
    de: 'durchgangs-eingangstueren',
    nl: 'doorgang-ingangsdeuren',
  },
  'armarios-vestidores-medida': {
    en: 'custom-wardrobes',
    ca: 'armaris-mida',
    de: 'massschraenke',
    nl: 'op-maat-gemaakte-kasten',
  },
  // fontaneria
  'redes-fontaneria-desagues': {
    en: 'plumbing-drainage-networks',
    ca: 'xarxes-fontaneria-desaigües',
    de: 'klempner-abwassernetzwerke',
    nl: 'loodgieterij-afvoernetwerken',
  },
  'reparacion-fugas': {
    en: 'leak-repair',
    ca: 'reparacio-fugues',
    de: 'leckreparatur',
    nl: 'lekkage-reparatie',
  },
  'griferia-sanitarios': {
    en: 'faucets-sanitary-ware',
    ca: 'aixetes-sanitaris',
    de: 'armaturen-sanitaer',
    nl: 'kranen-sanitair',
  },
  'agua-caliente-sanitaria': {
    en: 'domestic-hot-water',
    ca: 'aigua-calenta-sanitaria',
    de: 'warmwasser',
    nl: 'warm-tapwater',
  },
};

export function getTranslatedCategorySlug(id: string, locale: string): string {
  if (locale === 'es') return id;
  return serviceSlugMap[id]?.[locale] || id;
}

export function getTranslatedSubcategorySlug(id: string, locale: string): string {
  if (locale === 'es') return id;
  return subserviceSlugMap[id]?.[locale] || id;
}

export function getOriginalCategoryId(slug: string, locale: string): string {
  if (locale === 'es') return slug;
  for (const [id, translations] of Object.entries(serviceSlugMap)) {
    if (translations[locale] === slug) return id;
  }
  return slug;
}

export function getOriginalSubcategoryId(slug: string, locale: string): string {
  if (locale === 'es') return slug;
  for (const [id, translations] of Object.entries(subserviceSlugMap)) {
    if (translations[locale] === slug) return id;
  }
  return slug;
}
