import { NextRequest, NextResponse } from 'next/server';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const budgetId = searchParams.get('budgetId');

  if (!budgetId) {
    return NextResponse.json({ error: 'budgetId is required' }, { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: any) => {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Listener function targeting the new Pipeline Telemetry architecture
      const unsubscribe = adminFirestore
        .collection('pipeline_telemetry')
        .doc(budgetId)
        .collection('events')
        .orderBy('timestamp', 'asc') // Ensure order
        .onSnapshot(
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === 'added') {
                const eventData = change.doc.data();
                eventData.id = change.doc.id;
                sendEvent(eventData);
              }
            });
          },
          (error) => {
            console.error("[Stream] Firestore error:", error);
            // Don't close stream immediately, might be transient
          }
        );

      // Heartbeat to keep connection alive
      const interval = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15000);

      // Cleanup on close
      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
