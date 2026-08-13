/**
 * Klien Supabase PostgREST (REST API bawaan Supabase) —
 * tanpa memerlukan SDK tambahan.
 *
 * Semua fungsi di sini SERVER-ONLY karena memakai SERVICE_ROLE_KEY.
 */

function getConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured(): boolean {
  return getConfig() !== null;
}

export interface StoreRecord {
  id?: string;
  email: string;
  store_name: string;
  customer_name?: string;
  customer_phone?: string;
  is_paid?: boolean;
  package_id?: string;
  fonnte_token?: string;
  fonnte_device_status?: string;
  mengantar_api_key?: string;
  origin_subdistrict_id?: string;
  origin_city_name?: string;
  default_weight?: number;
  ai_prompt_system?: string;
  greeting_message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductRecord {
  id?: string;
  store_id: string;
  name: string;
  price: number;
  weight: number;
  stock?: number;
  description?: string;
  created_at?: string;
}

export interface ConversationRecord {
  id?: string;
  store_id: string;
  customer_phone: string;
  customer_name?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
  last_intent?: string;
  destination_city?: string;
  updated_at?: string;
  created_at?: string;
}

export interface OrderRecord {
  order_id: string;
  package_id: string;
  package_name: string;
  gross_amount: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  store_name: string;
  snap_token?: string | null;
  raw_notification?: Record<string, unknown> | null;
}

interface DbResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  skipped?: boolean;
}

function headers(key: string, prefer: string = "return=representation"): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer
  };
}

// ---------------- ORDER METHODS ----------------

export async function insertPendingOrder(order: OrderRecord): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) {
    console.warn("[supabase] Env belum di-set — lewati insert order.");
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`${cfg.url}/rest/v1/orders`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(order),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  rawNotification?: Record<string, unknown>
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const url = `${cfg.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({
        status,
        raw_notification: rawNotification ?? null,
        updated_at: new Date().toISOString()
      }),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `update ${res.status}: ${text}` };
    }

    const updated = await res.json();

    // Jika pembayaran sukses, otomatis buat/aktifkan akun toko di tabel `stores`
    if (status === "PAID" && Array.isArray(updated) && updated.length > 0) {
      const order = updated[0] as OrderRecord;
      await upsertStore({
        email: order.customer_email,
        store_name: order.store_name,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        is_paid: true,
        package_id: order.package_id
      });
    }

    return { ok: true, data: updated };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- STORE METHODS ----------------

export async function getStoreByEmail(email: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  try {
    const url = `${cfg.url}/rest/v1/stores?email=eq.${encodeURIComponent(email)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

export async function getStoreByFonnteToken(token: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  if (!cfg || !token) return null;

  try {
    const url = `${cfg.url}/rest/v1/stores?fonnte_token=eq.${encodeURIComponent(token)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

export async function upsertStore(store: Partial<StoreRecord> & { email: string }): Promise<DbResult<StoreRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const existing = await getStoreByEmail(store.email);
    let res: Response;

    if (existing && existing.id) {
      // Update
      const url = `${cfg.url}/rest/v1/stores?id=eq.${existing.id}`;
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({ ...store, updated_at: new Date().toISOString() }),
        cache: "no-store"
      });
    } else {
      // Insert
      res = await fetch(`${cfg.url}/rest/v1/stores`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify(store),
        cache: "no-store"
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `store upsert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- PRODUCT METHODS ----------------

export async function getProductsByStoreId(storeId: string): Promise<ProductRecord[]> {
  const cfg = getConfig();
  if (!cfg || !storeId) return [];

  try {
    const url = `${cfg.url}/rest/v1/products?store_id=eq.${encodeURIComponent(storeId)}&order=created_at.desc`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return [];
    return (await res.json()) as ProductRecord[];
  } catch {
    return [];
  }
}

export async function insertProduct(product: Omit<ProductRecord, "id">): Promise<DbResult<ProductRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/products`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(product),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `product insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deleteProduct(productId: string): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`, {
      method: "DELETE",
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- CONVERSATION METHODS ----------------

export async function getConversation(storeId: string, phone: string): Promise<ConversationRecord | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  try {
    const url = `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(
      storeId
    )}&customer_phone=eq.${encodeURIComponent(phone)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as ConversationRecord) : null;
  } catch {
    return null;
  }
}

export async function getAllConversations(storeId: string): Promise<ConversationRecord[]> {
  const cfg = getConfig();
  if (!cfg) return [];

  try {
    const url = `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(storeId)}&order=updated_at.desc`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return [];
    return (await res.json()) as ConversationRecord[];
  } catch {
    return [];
  }
}

export async function saveConversationMessage(
  storeId: string,
  phone: string,
  userMsg: string,
  assistantReply: string,
  intent?: string,
  destinationCity?: string
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const existing = await getConversation(storeId, phone);
    const nowStr = new Date().toISOString();

    const newMessages = existing && Array.isArray(existing.messages) ? [...existing.messages] : [];

    newMessages.push({ role: "user", content: userMsg, timestamp: nowStr });
    newMessages.push({ role: "assistant", content: assistantReply, timestamp: nowStr });

    let res: Response;
    if (existing && existing.id) {
      const url = `${cfg.url}/rest/v1/conversations?id=eq.${existing.id}`;
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          messages: newMessages,
          last_intent: intent || existing.last_intent,
          destination_city: destinationCity || existing.destination_city,
          updated_at: nowStr
        }),
        cache: "no-store"
      });
    } else {
      res = await fetch(`${cfg.url}/rest/v1/conversations`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          store_id: storeId,
          customer_phone: phone,
          messages: newMessages,
          last_intent: intent,
          destination_city: destinationCity
        }),
        cache: "no-store"
      });
    }

    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
