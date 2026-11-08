import { env } from '$env/dynamic/public';

export const APP_NAME = env.PUBLIC_APP_NAME || 'zevkamail';
export const EMAIL_DOMAIN = env.PUBLIC_EMAIL_DOMAIN || 'cloakmail.com';

/** No real mail domain configured yet (placeholder value). */
export const NO_REAL_DOMAIN = ['localhost', 'example.com', 'cloakmail.com'].includes(EMAIL_DOMAIN);
