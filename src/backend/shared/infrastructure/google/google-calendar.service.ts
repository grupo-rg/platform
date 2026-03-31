import { google, calendar_v3 } from 'googleapis';
import { GaxiosResponse } from 'gaxios';

export class GoogleCalendarService {
    private calendar: calendar_v3.Calendar;
    
    constructor() {
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        if (!clientEmail || !privateKey) {
            console.warn("[GoogleCalendarService] ⚠️ Credenciales de Service Account no encontradas en process.env. Se crearán links mockeados en desarrollo.");
            console.log(`[GoogleCalendarService - Debug] FIREBASE_CLIENT_EMAIL: \${clientEmail ? 'Encontrado' : 'FALTA'}`);
            console.log(`[GoogleCalendarService - Debug] FIREBASE_PRIVATE_KEY: \${privateKey ? 'Encontrado' : 'FALTA'}`);
        } else {
            console.log(`[GoogleCalendarService] ✅ Credenciales detectadas para: \${clientEmail}`);
        }

        const clientOptions: any = {};
        if (process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL) {
            // Impersonar al administrador del Workspace (Domain-Wide Delegation)
            clientOptions.subject = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;
            console.log(`[GoogleCalendarService] 🏢 Domain-Wide Delegation activada para: \${clientOptions.subject}`);
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            clientOptions,
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });

        this.calendar = google.calendar({ version: 'v3', auth });
    }

    /**
     * Crea un evento "Fantasma" en el calendario del Service Account
     * puramente para que Google inyecte el enlace único de "Google Meet".
     * Devuelve el enlace extraído.
     */
    async generateMeetLink(summary: string, description: string, startTime: Date, durationMinutes: number = 45, attendees?: string[]): Promise<string> {
        // Fallback for missing envs
        if (!process.env.FIREBASE_PRIVATE_KEY) {
            return `https://meet.google.com/mock-link-\${Date.now()}`;
        }

        const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

        try {
            const res = await this.calendar.events.insert({
                calendarId: 'primary',
                conferenceDataVersion: 1, // REQUERIDO: Obliga a Google a autogenerar sala de MEET
                requestBody: {
                    summary,
                    description,
                    start: { dateTime: startTime.toISOString(), timeZone: 'Europe/Madrid' },
                    end: { dateTime: endTime.toISOString(), timeZone: 'Europe/Madrid' },
                    conferenceData: {
                        createRequest: {
                            requestId: `req-\${Date.now()}-\${Math.floor(Math.random() * 1000)}`,
                            conferenceSolutionKey: { type: 'hangoutsMeet' }
                        }
                    },
                    attendees: attendees ? attendees.map(email => ({ email })) : []
                }
            });

            const link = res.data.hangoutLink;
            if (!link) {
                console.error("[GoogleCalendarService] Respondió 200 pero no generó hangoutLink.");
                return 'https://meet.google.com/error-generating-link';
            }

            return link;
        } catch (error) {
            console.error('[GoogleCalendarService] Error de API al generar Meet:', error);
            // Retornamos un gracefully degradado URL para no crashear la conversión del lead en producción
            return 'https://meet.google.com/fallback-link-sys-error';
        }
    }
}
