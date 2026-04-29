/**
 * Next.js instrumentation hook — se ejecuta una vez por proceso al arrancar.
 * Registra los event handlers de dominio para que Side-Effects como
 * "al confirmar booking → inscribir en reminders + mover deal" funcionen
 * sin intervención explícita de los callers.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { registerEventListeners } = await import('./src/backend/shared/events/register-listeners');
        registerEventListeners();
    }
}
