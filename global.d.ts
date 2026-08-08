// Global type augmentations.

export {};

/**
 * Midtrans Snap.js is loaded via a <script> tag in app/layout.tsx and attaches
 * itself to `window.snap`. We declare its shape here for type-safe usage.
 */
interface MidtransSnapResult {
  order_id?: string;
  transaction_id?: string;
  payment_type?: string;
  transaction_status?: string;
  fraud_status?: string;
  gross_amount?: string;
  status_code?: string;
  status_message?: string;
  [key: string]: unknown;
}

interface MidtransSnapCallbacks {
  onSuccess?: (result: MidtransSnapResult) => void;
  onPending?: (result: MidtransSnapResult) => void;
  onError?: (result: MidtransSnapResult) => void;
  onClose?: () => void;
}

interface MidtransSnap {
  pay: (token: string, callbacks?: MidtransSnapCallbacks) => void;
  hide: () => void;
  show: () => void;
}

declare global {
  interface Window {
    snap?: MidtransSnap;
  }
}
