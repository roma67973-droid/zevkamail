export interface InboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface StoredEmail extends InboundEmail {
  id: string;
  receivedAt: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  totalEmails: number;
  totalPages: number;
  hasMore: boolean;
}

export interface InboxResponse {
  emails: StoredEmail[];
  pagination: PaginationInfo;
}

export interface SpamResult {
  isSpam: boolean;
  reason: string | null;
}

export interface Env {
  DB: D1Database;
  /** Optional: without it big bodies are trimmed and kept in D1. */
  R2?: R2Bucket;
  DOMAIN: string;
  EMAIL_TTL_SECONDS: string;
  MAX_EMAIL_SIZE_MB: string;
  /** Optional. When set, /api/* (except /api/health) requires X-API-Key. */
  API_KEY?: string;
}
