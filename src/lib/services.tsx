import { Wrench, Waves, Home, Layers, Zap, Hammer, Droplets, Paintbrush, Shield } from 'lucide-react';

export const services = [
  {
    id: 'construccion-y-reformas',
    icon: <Wrench />,
    image: '/images/services/construccion-y-reformas.webp',
    ogImage: '/images/services/og/construccion-y-reformas.jpg',
    imageHint: 'obra nueva en ejecucion',
    subservices: [
      { id: 'gestion-integral-obra-nueva' },
      { id: 'reformas-integrales-viviendas-locales' },
      { id: 'ampliaciones-redistribucion' },
      { id: 'asesoramiento-materiales-construccion' },
    ]
  },
  {
    id: 'piscinas',
    icon: <Waves />,
    image: '/images/services/piscinas.webp',
    ogImage: '/images/services/og/piscinas.jpg',
    imageHint: 'piscina de obra en villa moderna',
    subservices: [
      { id: 'diseno-personalizado' },
      { id: 'construccion-gunitado' },
      { id: 'sistemas-cloracion-salina' },
      { id: 'mantenimiento-reparacion' },
    ]
  },
  {
    id: 'reformas-de-interiores',
    icon: <Home />,
    image: '/images/services/reformas-de-interiores.webp',
    ogImage: '/images/services/og/reformas-de-interiores.jpg',
    imageHint: 'cocina reformada de diseno',
    subservices: [
      { id: 'alicatados-pavimentos' },
      { id: 'instalaciones-fontaneria-electricidad' },
      { id: 'mobiliario-medida' },
      { id: 'banos-sanitarios' },
    ]
  },
  {
    id: 'paramentos-verticales',
    icon: <Layers />,
    image: '/images/services/paramentos-verticales.webp',
    ogImage: '/images/services/og/paramentos-verticales.jpg',
    imageHint: 'andamio en rehabilitacion de fachada',
    subservices: [
      { id: 'revestimientos-continuos' },
      { id: 'aislamiento-sate' },
      { id: 'rehabilitacion-fachadas' },
      { id: 'pintura-impermeabilizacion-exterior' },
    ]
  },
  {
    id: 'pintura',
    icon: <Paintbrush />,
    image: '/images/services/pintura.webp',
    ogImage: '/images/services/og/pintura.jpg',
    imageHint: 'pintor aplicando rodillo en pared',
    subservices: [
      { id: 'pintura-interior-decorativa' },
      { id: 'pintura-fachadas' },
      { id: 'alisado-paredes' },
      { id: 'tratamiento-humedades' },
    ]
  },
  {
    id: 'impermeabilizacion',
    icon: <Shield />,
    image: '/images/services/impermeabilizacion.webp',
    ogImage: '/images/services/og/impermeabilizacion.jpg',
    imageHint: 'cubierta impermeabilizada',
    subservices: [
      { id: 'cubiertas-planas-terrazas' },
      { id: 'reparacion-tejados' },
      { id: 'laminas-membranas' },
      { id: 'aislamiento-cubiertas' },
    ]
  },
  {
    id: 'electricidad',
    icon: <Zap />,
    image: '/images/services/electricidad.webp',
    ogImage: '/images/services/og/electricidad.jpg',
    imageHint: 'electricista instalando mecanismo',
    subservices: [
      { id: 'instalaciones-obra-nueva' },
      { id: 'actualizacion-reforma-electrica' },
      { id: 'boletines-certificaciones' },
      { id: 'iluminacion-led' },
    ]
  },
  {
    id: 'carpinteria',
    icon: <Hammer />,
    image: '/images/services/carpinteria.webp',
    ogImage: '/images/services/og/carpinteria.jpg',
    imageHint: 'carpintero trabajando la madera',
    subservices: [
      { id: 'ventanas-puertas-aluminio-pvc' },
      { id: 'cerramientos-pergolas' },
      { id: 'puertas-paso-entrada' },
      { id: 'armarios-vestidores-medida' },
    ]
  },
  {
    id: 'fontaneria',
    icon: <Droplets />,
    image: '/images/services/fontaneria.webp',
    ogImage: '/images/services/og/fontaneria.jpg',
    imageHint: 'griferia y sanitarios instalados',
    subservices: [
      { id: 'redes-fontaneria-desagues' },
      { id: 'reparacion-fugas' },
      { id: 'griferia-sanitarios' },
      { id: 'agua-caliente-sanitaria' },
    ]
  },
];
