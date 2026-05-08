import { Lead } from '@/backend/lead/domain/lead';

export class EmailSequenceRenderer {
    private static currentYear = new Date().getFullYear();

    // Core Base Layout for all emails
    private static getBaseLayout(title: string, content: string): string {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
                <tr>
                    <td align="center">
                        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                            <!-- Header -->
                            <tr>
                                <td style="padding: 30px 40px 10px; border-bottom: 1px solid #f1f5f9;">
                                    <img src="https://www.constructoresenmallorca.com/images/logo.avif" alt="Grupo RG · Constructores en Mallorca" width="120" style="display: block; height: auto;" />
                                </td>
                            </tr>
                            
                            <!-- Content -->
                            <tr>
                                <td style="padding: 40px; font-size: 15px; line-height: 1.6; color: #334155;">
                                    ${content}
                                </td>
                            </tr>
                            
                            <!-- Footer -->
                            <tr>
                                <td style="padding: 30px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
                                    <p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">El Equipo de Grupo RG</p>
                                    <p style="margin: 4px 0 0; font-size: 12px; color: #94a3b8;">
                                        Construyendo el estándar de la obra.<br/>
                                        © ${this.currentYear} Todos los derechos reservados.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;
    }

    private static getButton(text: string, url: string): string {
        return `
        <table border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
            <tr>
                <td align="center" style="border-radius: 8px; background-color: #0f172a;">
                    <a href="${url}" target="_blank" style="font-size: 15px; font-family: sans-serif; color: #ffffff; text-decoration: none; border-radius: 8px; padding: 14px 24px; border: 1px solid #0f172a; display: inline-block; font-weight: 600;">
                        ${text}
                    </a>
                </td>
            </tr>
        </table>
        `;
    }

    public static renderEmail(day: number, lead: Partial<Lead>): { subject: string, html: string } | null {
        const firstName = lead.personalInfo?.name?.split(' ')[0] || 'Profesional';
        // Base landing page URL - normally this would come from env vars
        const baseUrl = 'https://basis.reformas.com';

        switch (day) {
            case 0:
                return {
                    subject: 'Aquí tienes tu presupuesto técnico 📑',
                    html: this.getBaseLayout('Tu presupuesto', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Lo prometido es deuda. Aquí tienes adjunto el Presupuesto Técnico que acabamos de generar para ti usando inteligencia artificial.</p>
                        
                        <p style="margin: 0 0 20px;">Si te fijas, la IA ha estructurado las partidas como si llevara 10 años en la obra. Ha inferido los desescombros, los materiales necesarios y los tiempos de oficial y peón. Y todo, en base a precios medios del mercado actual.</p>
                        
                        <p style="margin: 0 0 20px;">Imagina este proceso... pero en vez de "precios medios", usando <strong>TUS catálogos de almacén y TUS márgenes reales</strong> guardados en memoria.</p>
                        
                        <p style="margin: 0 0 20px;">Eso es exactamente lo que hace la plataforma de Grupo RG por las grandes constructoras: presupuestar obras enteras a ciegas no es nuestro estilo, pero presupuestarlas en 15 minutos sin errores de Excel sí lo es.</p>

                        <p style="margin: 0 0 20px;">Puedes conocer Grupo RG y cómo se adaptaría a tu forma de trabajar con un solo clic.</p>

                        ${this.getButton('Ver qué más puede hacer Grupo RG por mi empresa', `${baseUrl}#demo`)}
                    `)
                };

            case 2:
                return {
                    subject: 'Cómo Carlos multiplicó x3 sus obras aceptadas',
                    html: this.getBaseLayout('Caso de Éxito', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Hace unos meses, Carlos, un contratista del norte de España y cliente nuestro, estaba a punto de tirar la toalla de la burocracia.</p>
                        
                        <p style="margin: 0 0 20px;">Después de todo el día de obra en obra y coordinando material, llegaba a casa a las 20:30h para... sentarse delante del ordenador y pasar apuntes de la libreta a un excel gigante. Resultado: sus presupuestos llegaban a los clientes 3 días tarde y la mitad ya habían firmado con otro.</p>
                        
                        <p style="margin: 0 0 20px;">Hoy, Carlos usa el motor que probaste el otro día (Grupo RG), integrado a la medida de su empresa. <br/>
                        ¿Lo mejor? Terminada su visita, se mete en su furgoneta y le habla a la aplicación como lo hiciste en el simulador. Al arrancar el coche de vuelta a casa, el cliente ya tiene en su email el presupuesto detallado.</p>
                        
                        <p style="margin: 0 0 20px;"><strong>El que presupuesta antes, se lleva la obra.</strong> Es una regla matemática en este sector.</p>
                        
                        <p style="margin: 0 0 20px;">Responder a clientes al instante no exige magia, exige tu propio software a medida.</p>

                        ${this.getButton('Analizar gratuitamente mis cuellos de botella', `${baseUrl}/booking`)}
                    `)
                };

            case 4:
                return {
                    subject: 'El error que te cuesta tu margen neto',
                    html: this.getBaseLayout('El Coste Oculto', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Quiero hacerte una pregunta un tanto incómoda: <br/>
                        <strong>De la última obra que cerraste... ¿sabes exactamente, céntimo a céntimo, qué margen de beneficio neto te dejó?</strong></p>
                        
                        <p style="margin: 0 0 20px;">La mayoría de constructoras contestan <em>"creo que gané X, pero aún tengo que cruzar los albaranes del almacén"</em>. Esa es la ceguera de los números. Es el mayor responsable del quiebre de empresas del sector.</p>
                        
                        <p style="margin: 0 0 10px;">Ese desfase de costes ocurre cuando:</p>
                        <ol style="margin: 0 0 20px; padding-left: 20px;">
                            <li style="margin-bottom: 8px;">Las horas del viernes del peón no se apuntan bien.</li>
                            <li style="margin-bottom: 8px;">Compras acopios de urgencia que no estaban presupuestados.</li>
                            <li style="margin-bottom: 8px;">Lo gestionas todo cruzando apps comerciales inconexas y facturando tarde.</li>
                        </ol>
                        
                        <p style="margin: 0 0 20px;">La inteligencia artificial de Grupo RG no solo redacta presupuestos. Construimos tu plataforma desde cero para que el "control de costes" cruce cada factura automáticamente contra el proyecto. Si en el día 15 de obra el material pisa por accidente tu beneficio... el panel enciende una alarma roja.</p>

                        ${this.getButton('Quiero tapar mis fugas de dinero', `${baseUrl}/booking`)}
                    `)
                };

            case 7:
                return {
                    subject: '¿Excel, ERP genérico o Software a Medida?',
                    html: this.getBaseLayout('Comparativa', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Es probable que tras ver nuestro Generador IA gratuito, hayas buscado alternativas de mercado "baratas" o estés pensando: "con mis Excels ya voy tirando".</p>
                        
                        <p style="margin: 0 0 20px;">Hoy quiero darte algo de contexto sobre las tres vías reales para digitalizar tu constructora:</p>
                        
                        <p style="margin: 0 0 10px;">➖ <strong>La Vía del Excel / PDF:</strong> Es gratis, claro... hasta que borras una celda sin querer enviándole un presupuesto inflado 2.000€ al cliente. No escala.</p>
                        <p style="margin: 0 0 10px;">➖ <strong>La Vía del SaaS "Enlatado":</strong> Pagas cientos de euros por un software pesado. Parecen la solución, pero obligan a tus empleados a cambiar su forma de trabajar.</p>
                        <p style="margin: 0 0 20px;">✅ <strong>La Vía Grupo RG (A Medida con IA):</strong> Un software diseñado solo para tu forma de trabajar. El coste final es mucho más barato en implantación que contratar a una consultora. Simplemente, vuestros procesos... hechos software al instante.</p>
                        
                        <p style="margin: 0 0 20px;">¿No crees que ha llegado el momento de que el software se adapte a tu constructora y no al revés?</p>

                        ${this.getButton('Agendar Sesión Evaluativa Gratuita', `${baseUrl}/booking`)}
                    `)
                };

            case 10:
                return {
                    subject: 'No somos solo un generador bonito 🤖',
                    html: this.getBaseLayout('Grupo RG', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Tardaste unos pocos segundos en crear de la nada ese presupuesto gratis la semana pasada. Eso tan rápido fue tan solo la fase de Venta de nuestro software en acción.</p>
                        
                        <p style="margin: 0 0 20px;">Pero Grupo RG abarca los 180 grados de tu gestión:</p>
                        
                        <p style="margin: 0 0 10px;">🏗️ <strong>Asistente de Voz Integrado:</strong> Un agente que atiende el teléfono, escucha a tu cliente, y reserva visita en el calendario si califica.</p>
                        <p style="margin: 0 0 10px;">📑 <strong>Certificaciones a un clic:</strong> Se acabó ir calculando sumatorios extraños para facturar el avance parcial del mes.</p>
                        <p style="margin: 0 0 20px;">🛡️ <strong>Firma Automatizada:</strong> Nuestro Wizard autocompleta contratos en base a obras y coordina subcontratas.</p>
                        
                        <p style="margin: 0 0 20px;">Todo en un solo ecosistema y a tu medida.</p>

                        ${this.getButton('Descubrir más en una llamada sin compromiso', `${baseUrl}/booking`)}
                    `)
                };

            case 14:
                return {
                    subject: 'Un detalle exclusivo de 20% para ti 🎁',
                    html: this.getBaseLayout('Oferta Exclusiva', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Has estado leyendo nuestros correos sobre Grupo RG, sobre IA y cómo dejar atrás la "edad de piedra" en la construcción durante los últimos 14 días. ⏱️</p>

                        <p style="margin: 0 0 20px;">Sabemos que si no habéis dado el paso de agendar la Evaluación es porque la obra te ahoga. Y precisamente para detener eso existe un desarrollo a medida del motor de Grupo RG.</p>
                        
                        <p style="margin: 0 0 20px;">Queremos daros un motivo real para mover ficha rápido. <strong>A todas las empresas que agenden nuestro Análisis Gratuito antes del viernes y validen ser candidatos, les aplicaremos un -20% de descuento automático en su primer coste anual o de setup.</strong></p>
                        
                        <p style="margin: 0 0 20px;">Recuperar el tiempo de los domingos está a 30 minutos de vídeo-llamada.</p>

                        ${this.getButton('Reservar llamada de Análisis (-20%)', `${baseUrl}/booking`)}
                    `)
                };

            case 21:
                return {
                    subject: `¿Cerramos el tema, ${firstName}?`,
                    html: this.getBaseLayout('Cierre', `
                        <p style="margin: 0 0 20px;">Hola <strong>${firstName}</strong>,</p>
                        
                        <p style="margin: 0 0 20px;">Te escribo porque no queremos ser pesados asaltando tu bandeja de entrada en medio de tu horario de obra. Hemos insistido tanto en que veas la plataforma de Grupo RG por una razón que resume un cliente reciente:</p>

                        <blockquote style="margin: 0 0 20px; padding: 15px 20px; border-left: 4px solid #0f172a; background-color: #f1f5f9; font-style: italic; color: #475569;">
                            "Antes perdía al menos 3 horas cruzando precios desde 6 pestañas. Sentía la angustia constante de dejarme dinero por el camino. Ahora solo alimento la plataforma con la información final y la IA escupe la cotización calculando sola su ganancia en 15 minutos."
                        </blockquote>
                        
                        <p style="margin: 0 0 20px;">Si de verdad necesitas dejar de picar piedra en la burocracia, me alegrará enormemente verte al otro lado de nuestra pantalla evaluando vuestro futuro sistema a medida.</p>

                        ${this.getButton('Hablar con el equipo técnico', `${baseUrl}/booking`)}

                        <p style="margin: 20px 0 0; font-size: 13px; color: #64748b;">Si prefieres seguir como ahora, no te enviaremos más correos directos hasta que tú des el paso. 🚧 Nos vemos en la obra.</p>
                    `)
                };

            default:
                return null;
        }
    }
}
