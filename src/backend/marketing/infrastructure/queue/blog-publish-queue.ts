import { CloudTasksClient } from '@google-cloud/tasks';

/**
 * Encola una Cloud Task para publicar un BlogPost en `publishAt`.
 * En dev sin credenciales, simula con `setTimeout` + fetch local.
 */
export async function enqueueBlogPublishTask(params: { postId: string; publishAt: Date }): Promise<void> {
    const { postId, publishAt } = params;

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:9002';
    const workerUrl = `${baseUrl}/api/marketing/blog/publish`;
    const token = process.env.INTERNAL_WORKER_TOKEN || '';

    const payload = { postId };

    // Dev fallback: setTimeout local (limitado a procesos vivos)
    if (process.env.NODE_ENV === 'development' && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const delay = Math.max(0, publishAt.getTime() - Date.now());
        console.log(`[BlogPublishQueue:dev] publicación en ${Math.round(delay / 1000)}s → ${workerUrl}`);
        setTimeout(() => {
            fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-token': token,
                },
                body: JSON.stringify(payload),
            }).catch(e => console.error('[BlogPublishQueue:dev] fetch failed', e));
        }, Math.min(delay, 2_147_000_000)); // setTimeout max ≈ 24.8d
        return;
    }

    // Prod: Cloud Tasks
    const client = new CloudTasksClient();
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
    const queue = process.env.GCP_TASKS_QUEUE_BLOG || 'marketing-queue';
    const location = process.env.GCP_TASKS_LOCATION || 'europe-west1';
    const parent = client.queuePath(project, location, queue);

    const task: any = {
        httpRequest: {
            httpMethod: 'POST',
            url: workerUrl,
            headers: {
                'Content-Type': 'application/json',
                'x-internal-token': token,
            },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: {
            seconds: Math.floor(publishAt.getTime() / 1000),
        },
    };

    try {
        const [response] = await client.createTask({ parent, task });
        console.log(`[BlogPublishQueue] task creada: ${response.name}`);
    } catch (err) {
        console.error('[BlogPublishQueue] error encolando', err);
        throw err;
    }
}
