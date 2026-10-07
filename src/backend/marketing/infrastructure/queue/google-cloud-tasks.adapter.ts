import { CloudTasksClient } from '@google-cloud/tasks';
import { TaskQueuePort } from '../../domain/marketing.repository';

export class GoogleCloudTasksAdapter implements TaskQueuePort {
    private client: CloudTasksClient;
    private project: string;
    private queue: string;
    private location: string;
    private webWorkerUrl: string;

    constructor() {
        this.client = new CloudTasksClient();
        this.project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'local-digital-eye';
        this.queue = process.env.GCP_TASKS_QUEUE || 'marketing-queue';
        this.location = process.env.GCP_TASKS_LOCATION || 'europe-west1';
        
        // En local simulamos hacia localhost, en PROD utilizamos la URL expuesta real
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
        this.webWorkerUrl = `${baseUrl}/api/marketing/worker`;
    }

    /**
     * Cabeceras para /api/marketing/worker, que exige `x-internal-token`
     * (fail-closed, Fase 0-B). Sin el token, el worker responde 401.
     */
    private workerHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = process.env.INTERNAL_WORKER_TOKEN;
        if (token) headers['x-internal-token'] = token;
        else console.warn('[GCP Tasks] INTERNAL_WORKER_TOKEN no definido: el worker rechazará la tarea.');
        return headers;
    }

    async enqueueSequenceProcessing(enrollmentId: string): Promise<void> {
        // En entorno de desarrollo (sin GOOGLE_APPLICATION_CREDENTIALS), simulamos
        // la asincronía de la cola escupiendo el payload al worker en background ("Fire & Forget")
        if (process.env.NODE_ENV === 'development' && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log(`[Local Queue Mock] Delegando asíncronamente Enrollment: ${enrollmentId} vía local Fetch`);
            fetch(this.webWorkerUrl, {
                method: 'POST',
                headers: this.workerHeaders(),
                body: JSON.stringify({ enrollmentId })
            }).catch(e => console.error("[Worker local] request falló tras delegarse silenciosamente"));
            return;
        }

        // --- EN PRODUCCIÓN ---
        const parent = this.client.queuePath(this.project, this.location, this.queue);
        const payload = JSON.stringify({ enrollmentId });
        
        const task: any = {
            httpRequest: {
                httpMethod: 'POST',
                url: this.webWorkerUrl,
                headers: this.workerHeaders(),
                body: Buffer.from(payload).toString('base64'),
            },
        };

        try {
            const [response] = await this.client.createTask({ parent, task });
            console.log(`[GCP Tasks] Creada Tarea asíncrona protegida con ID: ${response.name}`);
        } catch(err) {
            console.error(`[GCP Tasks] Error encolando: `, err);
            throw err;
        }
    }
}
