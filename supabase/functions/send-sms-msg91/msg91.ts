// MSG91 Flow API helpers (pure parts are unit-tested). Never log the OTP or a full phone number.

export const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow';

export interface Msg91Config {
  authKey: string;
  templateId: string;
  androidHash: string;
}

export function msg91Config(get: (k: string) => string | undefined): Msg91Config | null {
  const authKey = get('MSG91_AUTH_KEY');
  const templateId = get('MSG91_TEMPLATE_ID');
  if (!authKey || !templateId) return null;
  return { authKey, templateId, androidHash: get('MSG91_ANDROID_HASH') ?? '' };
}

/** MSG91 wants the number as digits with country code and no "+". */
export function mobilesFor(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** "**42": last two digits only, for logs. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length >= 2 ? `**${d.slice(-2)}` : '**';
}

export function flowBody(cfg: Msg91Config, mobiles: string, otp: string) {
  return {
    template_id: cfg.templateId,
    short_url: '0',
    recipients: [{ mobiles, otp, hash: cfg.androidHash }],
  };
}

export interface HookPayload {
  phone: string;
  otp: string;
}

export function parseHookPayload(raw: unknown): HookPayload | null {
  const p = raw as { user?: { phone?: unknown }; sms?: { otp?: unknown } } | null;
  const phone = p?.user?.phone;
  const otp = p?.sms?.otp;
  if (typeof phone !== 'string' || typeof otp !== 'string' || !otp) return null;
  return { phone, otp };
}

/** Supabase hook error envelope. */
export const hookError = (httpCode: number, message: string) => ({ error: { http_code: httpCode, message } });

/** True when MSG91 accepted the message. MSG91 answers 200 with `type: "error"` for many failures. */
export function msg91Accepted(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  const type = (body as { type?: unknown } | null)?.type;
  return type !== 'error';
}
