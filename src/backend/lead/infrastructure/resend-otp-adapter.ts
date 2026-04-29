import 'server-only';
import { OtpService } from '../domain/otp-service';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

export class ResendOtpAdapter implements OtpService {
    generateCode(length: number = 6): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async sendOtp(email: string, code: string): Promise<void> {
        const html = renderOtpHtml(code);
        const text = `Tu código de verificación Grupo RG: ${code}\n\nVálido durante 15 minutos. Si no lo solicitaste, ignora este correo.`;

        const { id, error } = await ResendEmailService.send({
            to: email,
            subject: 'Tu código de acceso seguro · Grupo RG',
            html,
            text,
            tags: [{ name: 'category', value: 'otp' }],
        });

        if (id) {
            console.log(`[OTP] Código enviado a ${email} (resend id=${id})`);
            return;
        }

        // Mensajes específicos según la causa para que el frontend pueda
        // mostrar guía útil al usuario.
        const userMessage = (() => {
            switch (error) {
                case 'NETWORK_ERROR':
                    return 'No pudimos contactar con el servicio de email. Comprueba tu conexión e inténtalo de nuevo en unos segundos.';
                case 'INVALID_API_KEY':
                    return 'Configuración de email incorrecta en el servidor. Si eres el administrador, verifica RESEND_API_KEY.';
                case 'DOMAIN_NOT_VERIFIED':
                    return 'El dominio del remitente no está verificado en Resend. Si eres el administrador, revisa RESEND_FROM_EMAIL.';
                case 'RATE_LIMITED':
                    return 'Estamos enviando muchos códigos. Espera 1 minuto y vuelve a intentarlo.';
                case 'PROVIDER_ERROR':
                    return 'El servicio de email tiene un problema temporal. Inténtalo en unos minutos.';
                case 'NOT_CONFIGURED':
                    return 'El envío de email no está configurado en el servidor.';
                default:
                    return 'No se pudo enviar el código de verificación. Inténtalo de nuevo.';
            }
        })();
        throw new Error(userMessage);
    }
}

function renderOtpHtml(code: string): string {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Código de Acceso · Grupo RG</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
        <tr><td align="center">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:500px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
                <tr><td style="padding:40px 40px 8px;text-align:center;">
                    <h1 style="margin:0;font-size:18px;letter-spacing:2px;color:#0f172a;">GRUPO RG</h1>
                </td></tr>
                <tr><td style="padding:8px 40px 40px;">
                    <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0f172a;text-align:center;">Verificación de seguridad</h2>
                    <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#475569;text-align:center;">
                        Has solicitado acceder a tu sesión. Introduce este código de 6 dígitos para continuar:
                    </p>
                    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;">
                        <span style="font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:36px;font-weight:700;color:#0f172a;letter-spacing:8px;">${code}</span>
                    </div>
                    <p style="margin:28px 0 0;font-size:13px;color:#64748b;text-align:center;">
                        Este código expira en <strong>15 minutos</strong>.
                    </p>
                </td></tr>
                <tr><td style="background:#0f172a;padding:24px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#94a3b8;">
                        Grupo RG © ${year} · Si no solicitaste este código, ignora este correo.
                    </p>
                </td></tr>
            </table>
        </td></tr>
    </table>
</body>
</html>`;
}
