export const STATUS = {
  UP: "UP",
  DNS_ERROR: "DNS_ERROR",
  STORE_UNAVAILABLE: "STORE_UNAVAILABLE",
  RAW_SHOPIFY_DOMAIN: "RAW_SHOPIFY_DOMAIN",
  PASSWORD_PROTECTED: "PASSWORD_PROTECTED",
  SITE_ERROR: "SITE_ERROR",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_LABELS: Record<Status, string> = {
  UP: "Up and Running",
  DNS_ERROR: "DNS Issue",
  STORE_UNAVAILABLE: "Store Unavailable",
  RAW_SHOPIFY_DOMAIN: "Raw Shopify Domain (no public domain)",
  PASSWORD_PROTECTED: "Password Protected",
  SITE_ERROR: "Site Error",
  TIMEOUT: "Timed Out",
  UNKNOWN: "Unknown Issue",
};

export function isErrorStatus(status: string): boolean {
  return status !== STATUS.UP;
}
