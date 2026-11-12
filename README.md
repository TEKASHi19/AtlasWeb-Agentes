# Atlas Web Agentes

Agente de WhatsApp para negocios (WhatsApp Cloud API + Claude), desplegado en Vercel.

- `api/webhook.js`: recibe mensajes de Meta y responde con Claude.
- `lib/negocio.js`: información del negocio y reglas del asistente.
- `api/diag.js`: diagnóstico temporal (se elimina antes de producción).

Variables de entorno (en Vercel): PHONE_NUMBER_ID, WABA_ID, VERIFY_TOKEN, WHATSAPP_TOKEN, APP_SECRET, ANTHROPIC_API_KEY.
