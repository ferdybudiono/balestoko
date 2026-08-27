"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  BookOpen,
  CheckCircle,
  CircleHelp,
  ClipboardList,
  Clock,
  Crown,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  Smartphone,
  TriangleAlert,
  Wifi,
  WifiOff
} from "lucide-react";

import ChatsTab from "@/components/dashboard/ChatsTab";
import OrdersTab from "@/components/dashboard/OrdersTab";
import OverviewTab from "@/components/dashboard/OverviewTab";
import ProductsTab from "@/components/dashboard/ProductsTab";
import StoreTab, { type StoreForm } from "@/components/dashboard/StoreTab";
import TeamMembers from "@/components/dashboard/TeamMembers";
import WhatsappTab from "@/components/dashboard/WhatsappTab";
import { computeStats } from "@/components/dashboard/stats";
import { isDeviceConnected } from "@/components/dashboard/types";
import type {
  BuyerOrder,
  BuyerOrderStatus,
  Conversation,
  FonnteStatus,
  Product,
  StoreDevice,
  TabId
} from "@/components/dashboard/types";
import { getPlan, hasAdvancedAnalytics, monthlyConversationLimit } from "@/lib/packages";
// Modul murni (tanpa env/fetch), jadi aman diimpor komponen client. Normalisasi
// dijalankan DI SINI supaya bentuk form selalu kanonik dan `sameForm` — yang
// membandingkan dengan JSON.stringify — tidak salah menandai "belum disimpan".
import { DEFAULT_LOCAL_COURIER, normalizeActiveCouriers, normalizeLocalCourier } from "@/lib/couriers";
import { normalizeAiTone, normalizePaymentAccounts } from "@/lib/reply-format";

const TABS: Array<{ id: TabId; icon: typeof LayoutDashboard; label: string; short: string }> = [
  { id: "overview", icon: LayoutDashboard, label: "Ringkasan", short: "Ringkasan" },
  { id: "whatsapp", icon: Smartphone, label: "Hubungkan WhatsApp", short: "WhatsApp" },
  { id: "store", icon: ShoppingBag, label: "Pengaturan Toko", short: "Toko" },
  { id: "products", icon: Package, label: "Produk", short: "Produk" },
  { id: "orders", icon: ClipboardList, label: "Pesanan", short: "Pesanan" },
  { id: "chats", icon: MessageSquare, label: "Chat AI", short: "Chat" }
];

const TAB_IDS = TABS.map((t) => t.id);

/** Konfirmasi per tahap — kalimatnya menyebut apa yang berubah, bukan "berhasil". */
const ORDER_STATUS_TOAST: Record<BuyerOrderStatus, string> = {
  new: "Pesanan dibuka kembali.",
  paid: "Pesanan ditandai sudah dibayar.",
  shipped: "Pesanan ditandai sudah dikirim.",
  done: "Pesanan ditandai selesai."
};

/**
 * Status masa aktif toko — cerminan `storeActivityState()` di server.
 * Hanya "active" & "trial" yang berarti bot benar-benar melayani pesan masuk.
 */
type ActivityState = "active" | "trial" | "trial_expired" | "subscription_expired" | "inactive";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sisa hari ketika peringatan langganan mulai ditampilkan. */
const RENEWAL_WARNING_DAYS = 7;

const DEFAULT_AI_PROMPT =
  "Kamu adalah Customer Service AI yang ramah dan profesional. Tugasmu adalah menyapa pembeli dengan hangat, menjawab pertanyaan produk, dan membantu mengecek tarif ongkos kirim (ongkir) menggunakan kurir ekspedisi.";
const DEFAULT_GREETING =
  "Halo! Selamat datang di toko kami 👋 Ada yang bisa saya bantu untuk produk atau cek tarif ongkir ke kota Kakak?";

const EMPTY_FORM: StoreForm = {
  storeName: "",
  originCityName: "",
  originSubdistrictId: "",
  defaultWeight: "1000",
  aiPromptSystem: DEFAULT_AI_PROMPT,
  greetingMessage: DEFAULT_GREETING,

  // Kosong = SEMUA ekspedisi ditawarkan ke pembeli (bukan "tidak ada satu pun").
  activeCouriers: [],
  localCourierEnabled: false,
  localCourierLabel: DEFAULT_LOCAL_COURIER.label,
  localCourierCost: "",
  localCourierEtd: DEFAULT_LOCAL_COURIER.etd,

  paymentAccounts: [],
  codEnabled: false,
  paymentNote: "",

  aiTone: "ramah",
  includeTotal: true,
  includePayment: true,

  alertPhone: "",
  notifyEnabled: true
};

/** Bandingkan isi form (flat, semua kunci sama) untuk deteksi perubahan. */
function sameForm(a: StoreForm, b: StoreForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `_id` Mengantar berupa ObjectId 24 karakter hex. Nilai lain (default lama
 * "3171010" atau hasil contoh offline) berarti ongkir masih PERKIRAAN.
 */
function isMengantarId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test((id || "").trim());
}

const POLL_MS = 25_000;
/**
 * Penyegaran khusus saat tab Chat terbuka.
 *
 * 25 detik cukup untuk kartu ringkasan, tapi terasa rusak pada percakapan yang
 * sedang ditangani manusia: pemilik toko sudah membalas dan menunggu jawaban
 * pembeli sambil menatap layar. Hanya berjalan saat tab Chat aktif & terlihat,
 * jadi biayanya tidak dibayar tab lain.
 */
const CHAT_POLL_MS = 8_000;
const QR_POLL_MS = 5_000;
/** QR Fonnte kedaluwarsa; berhenti polling setelah ~3 menit. */
const QR_MAX_TICKS = 36;

/**
 * Endpoint QR untuk satu nomor. `deviceId` adalah jalur utama; data lama yang
 * dibaca dari kolom `stores` (belum migrasi) tidak punya id, jadi dicocokkan
 * lewat nomornya.
 */
function qrEndpoint(device: StoreDevice): string {
  const param = device.id
    ? `deviceId=${encodeURIComponent(device.id)}`
    : `phone=${encodeURIComponent(device.phone)}`;
  return `/api/fonnte/qr?${param}`;
}

/**
 * Pertahankan hasil pembacaan setelan Fonnte saat daftar nomor dimuat ulang
 * tanpa `status=1`.
 *
 * Hanya pembacaan `live` yang tahu kondisi webhook & auto read di Fonnte. Polling
 * biasa (dan `GET /api/store`) mengembalikan baris database apa adanya, jadi
 * menimpanya mentah-mentah membuat panel *Jalur terima chat pembeli* kembali ke
 * "belum diperiksa" setiap 30 detik — persis diagnosa yang paling dibutuhkan
 * hilang tepat ketika pemilik toko sedang membacanya.
 */
function mergeDeviceDiagnostics(prev: StoreDevice[], next: StoreDevice[]): StoreDevice[] {
  if (prev.length === 0) return next;
  const before = new Map(prev.map((d) => [d.id || d.phone, d]));
  return next.map((d) => {
    const old = before.get(d.id || d.phone);
    // Data baru yang sudah diperiksa selalu menang; tanpa pembacaan lama, biarkan.
    if (d.inbound_checked || !old?.inbound_checked) return d;
    return {
      ...d,
      inbound_checked: true,
      autoread: old.autoread,
      webhook_url: old.webhook_url,
      webhook_synced: old.webhook_synced,
      inbound_error: old.inbound_error
      // `inbound_repaired` sengaja TIDAK dibawa: itu peristiwa sekali-jalan,
      // bukan kondisi yang berlaku terus.
    };
  });
}

export default function DashboardPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error"; key: number } | null>(null);

  // Akun & langganan
  const [storeId, setStoreId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState<string | null>(null);
  // Status masa aktif menurut SERVER — aturan yang sama dipakai webhook untuk
  // memutuskan apakah bot masih melayani pesan masuk. Default "active" supaya
  // satu respons gagal tidak mengunci dashboard pelanggan yang sah.
  const [activityState, setActivityState] = useState<ActivityState>("active");
  const [nowTs, setNowTs] = useState(() => Date.now());

  // Konfigurasi toko: `form` = yang diedit, `savedForm` = kondisi di server.
  const [form, setForm] = useState<StoreForm>(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState<StoreForm>(EMPTY_FORM);
  const formRef = useRef(form);
  const savedFormRef = useRef(savedForm);
  formRef.current = form;
  savedFormRef.current = savedForm;

  const [packageId, setPackageId] = useState<string>("");
  const [fonnteStatus, setFonnteStatus] = useState<FonnteStatus>({
    status: false,
    device: "DISCONNECTED",
    reason: "Belum terhubung"
  });

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Simpan NOMOR, bukan objek: refetch berkala tidak lagi melempar user
  // kembali ke percakapan pertama.
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  // Balasan manual sedang dikirim / mode AI sedang diubah untuk nomor ini.
  const [chatSending, setChatSending] = useState(false);
  const [chatPausingPhone, setChatPausingPhone] = useState<string | null>(null);

  // Pesanan pembeli hasil rekaman AI (tab "Pesanan").
  const [buyerOrders, setBuyerOrders] = useState<BuyerOrder[]>([]);
  const [ordersNeedMigration, setOrdersNeedMigration] = useState(false);
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);

  // WhatsApp: nomor-nomor toko (Starter 1, Pro 3) + QR per nomor
  const [devices, setDevices] = useState<StoreDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [devicesNeedMigration, setDevicesNeedMigration] = useState(false);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addingDevice, setAddingDevice] = useState(false);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  // Diagnosa jalur TERIMA (Fonnte → aplikasi): URL webhook yang berlaku dan
  // peringatan bila NEXT_PUBLIC_BASE_URL tidak bisa dijangkau dari internet.
  const [expectedWebhookUrl, setExpectedWebhookUrl] = useState<string | null>(null);
  const [baseUrlWarning, setBaseUrlWarning] = useState<string | null>(null);
  const [repairingDeviceId, setRepairingDeviceId] = useState<string | null>(null);
  // Nomor yang sedang menyimpan cakupan produknya (paket Pro: 3 nomor).
  const [savingScopeId, setSavingScopeId] = useState<string | null>(null);
  // Simpan device-nya (bukan hanya id) supaya polling QR tahu endpoint mana yang
  // harus dipanggil, termasuk untuk data lama yang belum punya id.
  const [qrDevice, setQrDevice] = useState<StoreDevice | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrTicks, setQrTicks] = useState(0);

  // Uji coba
  const [testPhone, setTestPhone] = useState("");
  const [testMessageText, setTestMessageText] = useState("Halo, cek ongkir ke Bandung dong");
  const [testDeviceId, setTestDeviceId] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  // ── Toast: bersihkan timer lama supaya toast kedua tidak ikut terpotong ──
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // ── Tab tersimpan di URL: refresh & tombol Back tidak balik ke tab 1 ──
  useEffect(() => {
    const syncFromUrl = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      setActiveTab(t && (TAB_IDS as string[]).includes(t) ? (t as TabId) : "overview");
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const goToTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url);
  }, []);

  // Navigasi panah untuk `role="tablist"` (pola ARIA: panah memindah fokus
  // sekaligus mengaktifkan tab, Home/End ke ujung).
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = TABS.length - 1;
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      if (next === null) return;
      e.preventDefault();
      const id = TABS[next].id;
      goToTab(id);
      tabRefs.current[id]?.focus();
    },
    [goToTab]
  );

  // ── Muat data toko ────────────────────────────────────────────────────
  const fetchStoreData = useCallback(
    async (opts: { light?: boolean; silent?: boolean; syncForm?: boolean } = {}) => {
      const { light = false, silent = false, syncForm = false } = opts;
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await fetch(`/api/store${light ? "?light=1" : ""}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) return;

        const data = await res.json();
        if (!data.store) {
          // Session valid tapi belum ada record toko (akun belum aktif).
          router.push("/login");
          return;
        }

        const s = data.store;
        setStoreId(s.id || "");
        setUserEmail(s.email || "");
        setIsPaid(!!s.is_paid);
        setTrialEndsAt(s.trial_ends_at || null);
        setSubscriptionEndsAt(s.subscription_ends_at || null);
        if (data.activity?.state) setActivityState(data.activity.state as ActivityState);
        setPackageId(s.package_id || "");

        const local = normalizeLocalCourier(s.local_courier);
        const next: StoreForm = {
          storeName: s.store_name || "",
          originCityName: s.origin_city_name || "",
          originSubdistrictId: s.origin_subdistrict_id || "",
          defaultWeight: String(s.default_weight || 1000),
          aiPromptSystem: s.ai_prompt_system || DEFAULT_AI_PROMPT,
          greetingMessage: s.greeting_message || DEFAULT_GREETING,

          activeCouriers: normalizeActiveCouriers(s.active_couriers),
          localCourierEnabled: local.enabled,
          localCourierLabel: local.label,
          // `0` dari server = "tanya dulu" → tampil sebagai kolom kosong, bukan
          // angka 0 yang mengesankan gratis.
          localCourierCost: local.cost > 0 ? String(local.cost) : "",
          localCourierEtd: local.etd,

          paymentAccounts: normalizePaymentAccounts(s.payment_accounts),
          codEnabled: s.cod_enabled === true,
          paymentNote: s.payment_note || "",

          aiTone: normalizeAiTone(s.ai_tone),
          // `?? true`: kolomnya baru, jadi baris yang belum pernah disimpan sejak
          // migrasi harus tetap dianggap menyertakan total & cara bayar.
          includeTotal: s.ai_include_total ?? true,
          includePayment: s.ai_include_payment ?? true,

          alertPhone: s.alert_phone || "",
          // Kolom `not null default true`, tapi baris lama yang dibaca sebelum
          // migrasi bisa mengirim undefined — dan diam-diam mematikan kabar
          // penting jauh lebih merugikan daripada mengirim satu kabar berlebih.
          notifyEnabled: s.notify_enabled ?? true
        };
        // Jangan timpa apa yang sedang diedit user saat polling berjalan.
        const wasDirty = !sameForm(formRef.current, savedFormRef.current);
        setSavedForm(next);
        if (syncForm || !wasDirty) setForm(next);

        // `light=1` mengembalikan null — pertahankan status yang sudah ada.
        if (data.fonnteStatus) setFonnteStatus(data.fonnteStatus);

        if (Array.isArray(data.devices)) {
          // Gabungkan, jangan timpa: endpoint ini tidak membawa hasil pembacaan
          // setelan dari Fonnte (`webhook_synced`, `inbound_checked`), jadi
          // penimpaan mentah akan mengembalikan panel diagnosa ke "belum
          // diperiksa" setiap kali polling berjalan.
          setDevices((prev) => mergeDeviceDiagnostics(prev, data.devices as StoreDevice[]));
        }
        if (typeof data.deviceLimit === "number") setDeviceLimit(data.deviceLimit);
        setDevicesNeedMigration(!!data.devicesNeedMigration);

        if (Array.isArray(data.products)) setProducts(data.products);
        if (Array.isArray(data.buyerOrders)) setBuyerOrders(data.buyerOrders as BuyerOrder[]);
        setOrdersNeedMigration(!!data.ordersNeedMigration);
        if (Array.isArray(data.conversations)) {
          const list = data.conversations as Conversation[];
          setConversations(list);
          // Hanya pilih otomatis bila belum ada / percakapan terpilih hilang.
          setSelectedPhone((prev) =>
            prev && list.some((c) => c.customer_phone === prev) ? prev : null
          );
        }
      } catch (err) {
        console.error("Gagal memuat data toko:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    fetchStoreData();
  }, [fetchStoreData]);

  // Segarkan berkala (mode ringan: tanpa panggilan status ke Fonnte) hanya
  // saat tab browser terlihat, plus sekali lagi saat user kembali ke tab.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") fetchStoreData({ light: true, silent: true });
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchStoreData]);

  // Tab Chat: penyegaran lebih cepat, dan HANYA selama tab itu terbuka. Pemilik
  // toko yang sedang membalas sendiri menunggu jawaban pembeli sambil menatap
  // layar — 25 detik terasa seperti aplikasinya menggantung.
  useEffect(() => {
    if (activeTab !== "chats") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchStoreData({ light: true, silent: true });
    }, CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [activeTab, fetchStoreData]);

  // Countdown uji coba ikut berjalan tanpa perlu refresh halaman.
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Nomor WhatsApp (multi-device) ─────────────────────────────────────
  /** `live` = ikut menanyakan status tiap nomor ke Fonnte (lebih lambat). */
  const refreshDevices = useCallback(
    async (opts: { live?: boolean } = {}) => {
      const { live = false } = opts;
      if (live) setRefreshingDevices(true);
      try {
        const res = await fetch(`/api/fonnte/devices${live ? "?status=1" : ""}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.devices)) {
          setDevices((prev) => mergeDeviceDiagnostics(prev, data.devices as StoreDevice[]));
        }
        if (typeof data.limit === "number") setDeviceLimit(data.limit);
        setDevicesNeedMigration(!!data.needsMigration);
        setExpectedWebhookUrl(data.expectedWebhookUrl || null);
        setBaseUrlWarning(data.baseUrlWarning || null);
      } catch {
        /* diamkan — polling berikutnya mencoba lagi */
      } finally {
        setRefreshingDevices(false);
      }
    },
    []
  );

  const handleFetchQr = useCallback(
    async (device: StoreDevice) => {
      setLoadingQr(true);
      setQrTicks(0);
      setQrDevice(device);
      try {
        const res = await fetch(qrEndpoint(device));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setQrDevice(null);
          showToast(data.error || "Gagal memuat QR Code.", "error");
          return;
        }
        if (data.connected) {
          setQrUrl(null);
          setQrDevice(null);
          // `warning` = tersambung, tapi jalur pesan masuk belum siap. Jangan
          // ucapkan "berhasil" kalau bot-nya akan bisu.
          if (data.warning) showToast(data.warning, "error");
          else showToast("Nomor ini sudah terhubung! 🎉");
          refreshDevices({ live: true });
          fetchStoreData({ light: true, silent: true });
        } else if (data.qrUrl) {
          setQrUrl(data.qrUrl);
          if (data.warning) showToast(data.warning, "error");
        } else {
          setQrDevice(null);
          showToast(data.error || "QR Code belum tersedia. Coba lagi sebentar.", "error");
        }
      } catch {
        setQrDevice(null);
        showToast("Gagal memuat QR Code.", "error");
      } finally {
        setLoadingQr(false);
      }
    },
    [fetchStoreData, refreshDevices, showToast]
  );

  const handleAddDevice = useCallback(async () => {
    if (newPhone.replace(/\D/g, "").length < 10) {
      showToast("Masukkan nomor WhatsApp yang valid (mis. 0812xxxxxxx).", "error");
      return;
    }
    setAddingDevice(true);
    try {
      const res = await fetch("/api/fonnte/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: newPhone, label: newLabel })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menambahkan nomor.", "error");
        return;
      }
      setNewPhone("");
      setNewLabel("");
      // `warning` = nomor tersimpan tapi jalur pesan masuk belum siap (mis. URL
      // webhook belum bisa dijangkau). Itu harus terlihat sekarang, bukan nanti
      // saat pembeli pertama tidak dibalas.
      showToast(
        data.warning || "Nomor terdaftar. Scan QR untuk menghubungkan WhatsApp-nya.",
        data.warning ? "error" : "success"
      );
      await refreshDevices();
      // Langsung tampilkan QR-nya: nomor baru belum berguna sebelum di-scan.
      if (data.device) handleFetchQr(data.device as StoreDevice);
    } catch {
      showToast("Gagal menambahkan nomor.", "error");
    } finally {
      setAddingDevice(false);
    }
  }, [newPhone, newLabel, handleFetchQr, refreshDevices, showToast]);

  const handleRemoveDevice = useCallback(
    async (device: StoreDevice) => {
      if (!device.id) return;
      setRemovingDeviceId(device.id);
      try {
        const res = await fetch(`/api/fonnte/devices?id=${encodeURIComponent(device.id)}`, {
          method: "DELETE"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || "Gagal menghapus nomor.", "error");
          return;
        }
        if (qrDevice?.id === device.id) {
          setQrUrl(null);
          setQrDevice(null);
        }
        // Server hanya menjawab sukses setelah device benar-benar terhapus di
        // Fonnte, jadi tidak ada lagi kondisi "terhapus separuh" untuk dilaporkan.
        showToast("Nomor berhasil dihapus dari dashboard dan dari Fonnte.", "success");
        await refreshDevices();
        fetchStoreData({ light: true, silent: true });
      } catch {
        showToast("Gagal menghapus nomor.", "error");
      } finally {
        setRemovingDeviceId(null);
      }
    },
    [qrDevice, fetchStoreData, refreshDevices, showToast]
  );

  /**
   * Dorong ulang setelan penerimaan pesan satu nomor ke Fonnte (URL webhook +
   * auto read), lalu tampilkan hasil pembacaan terbarunya.
   *
   * Ini jalan keluar mandiri untuk kondisi "bot bisa mengirim tapi tidak pernah
   * menerima" — pemilik toko tidak perlu masuk ke dashboard Fonnte.
   */
  const handleRepairDevice = useCallback(
    async (device: StoreDevice) => {
      if (!device.id) return;
      setRepairingDeviceId(device.id);
      try {
        const res = await fetch(`/api/fonnte/devices?id=${encodeURIComponent(device.id)}`, {
          method: "PATCH"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          showToast(data.error || "Gagal memperbaiki setelan nomor ini.", "error");
        } else {
          showToast("Setelan penerimaan pesan diperbaiki. Coba chat ke nomor ini untuk mengetes.");
        }
        // Baca ulang kondisi sebenarnya dari Fonnte, jangan percaya klaim tombol.
        await refreshDevices({ live: true });
      } catch {
        showToast("Gagal memperbaiki setelan nomor ini.", "error");
      } finally {
        setRepairingDeviceId(null);
      }
    },
    [refreshDevices, showToast]
  );

  // Pantau status selama QR tampil; berhenti begitu terhubung atau kedaluwarsa.
  useEffect(() => {
    if (!qrUrl || !qrDevice) return;
    if (qrTicks >= QR_MAX_TICKS) {
      setQrUrl(null);
      setQrDevice(null);
      showToast("QR Code kedaluwarsa. Klik Scan QR lagi.", "error");
      return;
    }
    const id = setTimeout(async () => {
      setQrTicks((n) => n + 1);
      try {
        const res = await fetch(qrEndpoint(qrDevice));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (data.connected) {
          setQrUrl(null);
          setQrDevice(null);
          showToast("WhatsApp berhasil terhubung! 🎉");
          // `live` — device yang baru ditautkan adalah saat paling rawan setelan
          // webhook/auto read-nya belum terpasang. Rekonsiliasi sekarang, jangan
          // tunggu pembeli pertama yang tidak dibalas.
          refreshDevices({ live: true });
          fetchStoreData({ light: true, silent: true });
        } else if (data.qrUrl) {
          setQrUrl(data.qrUrl);
        }
      } catch {
        /* diamkan — dicoba lagi pada tick berikutnya */
      }
    }, QR_POLL_MS);
    return () => clearTimeout(id);
  }, [qrUrl, qrTicks, qrDevice, fetchStoreData, refreshDevices, showToast]);

  // Buka tab WhatsApp = periksa jalur terima. Pembacaan `live` inilah yang
  // membaca setelan nyata di Fonnte dan memperbaikinya bila melenceng, jadi
  // sekadar membuka tab ini sudah menyembuhkan device yang webhook/auto read-nya
  // hilang — tanpa itu, panel diagnosa hanya bisa bilang "belum diperiksa".
  const inboundChecked = useRef(false);
  useEffect(() => {
    if (activeTab !== "whatsapp" || inboundChecked.current) return;
    inboundChecked.current = true;
    refreshDevices({ live: true });
  }, [activeTab, refreshDevices]);

  // Nomor pengirim untuk uji coba: jaga agar selalu menunjuk nomor yang valid.
  useEffect(() => {
    const usable = devices
      .slice(0, deviceLimit)
      .filter((d) => String(d.device_status).toUpperCase() === "CONNECTED");
    if (usable.some((d) => d.id === testDeviceId)) return;
    setTestDeviceId(usable.find((d) => d.is_primary)?.id || usable[0]?.id || "");
  }, [devices, deviceLimit, testDeviceId]);

  // ── Simpan pengaturan toko ────────────────────────────────────────────
  const patchForm = useCallback((patch: Partial<StoreForm>) => {
    setForm((f) => ({ ...f, ...patch }));
  }, []);

  const handleSaveStoreConfig = useCallback(async () => {
    if (!form.storeName.trim()) {
      showToast("Nama toko tidak boleh kosong.", "error");
      return;
    }
    const weight = Number(form.defaultWeight);
    if (!Number.isFinite(weight) || weight < 100 || weight > 50000) {
      showToast("Berat default harus antara 100 dan 50.000 gram.", "error");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        store_name: form.storeName.trim(),
        origin_city_name: form.originCityName,
        origin_subdistrict_id: form.originSubdistrictId,
        default_weight: weight,
        ai_prompt_system: form.aiPromptSystem,
        greeting_message: form.greetingMessage,
        active_couriers: form.activeCouriers,
        local_courier: {
          enabled: form.localCourierEnabled,
          label: form.localCourierLabel,
          // Kolom kosong / bukan angka → 0, yang di sisi pembeli berarti
          // "tarif ditanyakan dulu" dan tidak pernah dicetak sebagai Rp 0.
          cost: Number(form.localCourierCost) || 0,
          etd: form.localCourierEtd
        },
        payment_accounts: form.paymentAccounts,
        cod_enabled: form.codEnabled,
        payment_note: form.paymentNote,
        ai_tone: form.aiTone,
        ai_include_total: form.includeTotal,
        ai_include_payment: form.includePayment,
        alert_phone: form.alertPhone.trim(),
        notify_enabled: form.notifyEnabled
      };

      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menyimpan pengaturan.", "error");
        return;
      }
      showToast("Pengaturan toko disimpan.");
      await fetchStoreData({ light: true, silent: true, syncForm: true });
    } catch {
      showToast("Terjadi kesalahan saat menyimpan.", "error");
    } finally {
      setSaving(false);
    }
  }, [form, fetchStoreData, showToast]);

  // ── Uji coba balasan AI ───────────────────────────────────────────────
  const handleSendTest = useCallback(async () => {
    if (testPhone.replace(/\D/g, "").length < 9) {
      showToast("Masukkan nomor WA penguji yang valid.", "error");
      return;
    }
    if (!testMessageText.trim()) {
      showToast("Isi dulu pesan uji cobanya.", "error");
      return;
    }
    setSendingTest(true);
    try {
      // Endpoint khusus yang WAJIB login — bukan webhook publik. Nomor device
      // dan token toko diambil server-side dari sesi, tidak dari browser.
      const res = await fetch("/api/test-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: testPhone,
          message: testMessageText,
          // Nomor pengirim yang dipilih user; server tetap memverifikasi bahwa
          // device ini milik toko pemanggil dan masih di dalam kuota paket.
          deviceId: testDeviceId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(
          data.delivered
            ? "Pesan uji coba terkirim. Lihat hasilnya di Chat AI."
            : "Balasan AI tersimpan, tetapi pengiriman WhatsApp gagal.",
          data.delivered ? "success" : "error"
        );
        await fetchStoreData({ light: true, silent: true });
        if (data.sender) setSelectedPhone(String(data.sender));
        goToTab("chats");
      } else {
        showToast(data.error || "Gagal mengirim pesan uji coba.", "error");
      }
    } catch {
      showToast("Terjadi kesalahan.", "error");
    } finally {
      setSendingTest(false);
    }
  }, [testPhone, testMessageText, testDeviceId, fetchStoreData, goToTab, showToast]);

  // ── Pesanan pembeli ───────────────────────────────────────────────────
  //
  // Perubahan status ditulis OPTIMIS ke state supaya tombol tahap berikutnya
  // terasa langsung, lalu SELURUH baris lama dipulihkan bila server menolak.
  // Memulihkan barisnya (bukan hanya `status`) penting sejak pesanan punya empat
  // tahap: satu PATCH gagal juga tidak boleh meninggalkan stempel waktu atau
  // nomor resi yang sebenarnya tidak pernah tersimpan.
  const handleSetOrderStatus = useCallback(
    async (
      order: BuyerOrder,
      status: BuyerOrderStatus,
      extra?: { tracking_number?: string; payment_proof_url?: string }
    ) => {
      if (!order.id) return;
      const id = order.id;
      const before = order;
      const nowIso = new Date().toISOString();
      setOrderBusyId(id);
      setBuyerOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                status,
                ...(extra?.tracking_number !== undefined
                  ? { tracking_number: extra.tracking_number || null }
                  : {}),
                ...(extra?.payment_proof_url !== undefined
                  ? { payment_proof_url: extra.payment_proof_url || null }
                  : {}),
                paid_at: status === "new" ? null : o.paid_at || nowIso,
                shipped_at:
                  status === "shipped" || status === "done" ? o.shipped_at || nowIso : null,
                done_at: status === "done" ? nowIso : null
              }
            : o
        )
      );
      try {
        const res = await fetch("/api/buyer-orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status, ...(extra || {}) })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBuyerOrders((prev) => prev.map((o) => (o.id === id ? before : o)));
          showToast(data.error || "Gagal memperbarui pesanan.", "error");
          return;
        }
        // Server mengembalikan baris hasilnya; dipakai supaya stempel waktu di
        // layar adalah yang BENAR-BENAR tersimpan, bukan tebakan optimis.
        if (data.order?.id) {
          setBuyerOrders((prev) => prev.map((o) => (o.id === id ? (data.order as BuyerOrder) : o)));
        }
        showToast(ORDER_STATUS_TOAST[status]);
      } catch {
        setBuyerOrders((prev) => prev.map((o) => (o.id === id ? before : o)));
        showToast("Terjadi kesalahan saat memperbarui pesanan.", "error");
      } finally {
        setOrderBusyId(null);
      }
    },
    [showToast]
  );

  const handleDeleteOrder = useCallback(
    async (order: BuyerOrder) => {
      if (!order.id) return;
      const id = order.id;
      setOrderBusyId(id);
      try {
        const res = await fetch(`/api/buyer-orders?id=${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || "Gagal menghapus pesanan.", "error");
          return;
        }
        setBuyerOrders((prev) => prev.filter((o) => o.id !== id));
        showToast("Pesanan dihapus.");
      } catch {
        showToast("Terjadi kesalahan saat menghapus pesanan.", "error");
      } finally {
        setOrderBusyId(null);
      }
    },
    [showToast]
  );

  // ── Ambil alih percakapan dari bot ────────────────────────────────────
  //
  // Tiga aksi yang membuat tab Chat bukan lagi jendela baca-saja: kirim balasan
  // sendiri, jeda/lanjutkan AI, dan tandai sudah dibaca. Semuanya lewat
  // `/api/conversations`, dan `store_id`-nya selalu dari session — nomor pembeli
  // di body hanya dipakai untuk mencari percakapan milik toko ini.
  const handleSendManualReply = useCallback(
    async (phone: string, message: string): Promise<boolean> => {
      const text = message.trim();
      if (!phone || !text) return false;
      setChatSending(true);
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, message: text })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || "Pesan gagal dikirim.", "error");
          return false;
        }
        // Tampilkan pesannya SEKARANG. Pesan sudah benar-benar terkirim ke
        // pembeli (server mengirim dulu, mencatat kemudian), jadi menunggu
        // polling berikutnya hanya membuat pemilik toko ragu apakah tombolnya
        // bekerja.
        const nowIso = new Date().toISOString();
        setConversations((prev) =>
          prev.map((c) =>
            c.customer_phone === phone
              ? {
                  ...c,
                  messages: [
                    ...(Array.isArray(c.messages) ? c.messages : []),
                    { role: "assistant" as const, content: text, timestamp: nowIso }
                  ],
                  ai_paused: data.aiPaused === true ? true : c.ai_paused,
                  last_seen_at: nowIso,
                  updated_at: nowIso
                }
              : c
          )
        );
        if (data.stored === false) {
          // Terkirim, tapi gagal masuk riwayat. Muat ulang supaya layar tidak
          // memamerkan pesan yang tidak ada di database.
          fetchStoreData({ light: true, silent: true });
        }
        if (data.aiPaused === true) showToast("Balasan terkirim. AI dijeda untuk chat ini.");
        else showToast("Balasan terkirim.");
        return true;
      } catch {
        showToast("Terjadi kesalahan saat mengirim balasan.", "error");
        return false;
      } finally {
        setChatSending(false);
      }
    },
    [fetchStoreData, showToast]
  );

  const handleToggleAiPause = useCallback(
    async (phone: string, paused: boolean) => {
      if (!phone) return;
      setChatPausingPhone(phone);
      const before = conversations.find((c) => c.customer_phone === phone)?.ai_paused ?? null;
      setConversations((prev) =>
        prev.map((c) => (c.customer_phone === phone ? { ...c, ai_paused: paused } : c))
      );
      try {
        const res = await fetch("/api/conversations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, ai_paused: paused })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.customer_phone === phone ? { ...c, ai_paused: before } : c))
          );
          showToast(data.error || "Gagal mengubah mode AI.", "error");
          return;
        }
        showToast(
          paused
            ? "AI dijeda. Chat ini menunggu balasan Anda."
            : "AI kembali menjawab chat ini otomatis."
        );
      } catch {
        setConversations((prev) =>
          prev.map((c) => (c.customer_phone === phone ? { ...c, ai_paused: before } : c))
        );
        showToast("Terjadi kesalahan saat mengubah mode AI.", "error");
      } finally {
        setChatPausingPhone(null);
      }
    },
    [conversations, showToast]
  );

  /**
   * Tandai percakapan sudah dibaca saat dibuka.
   *
   * Sengaja tidak pernah memunculkan pesan galat: ini penanda kenyamanan, dan
   * kegagalannya paling banyak menyisakan satu lencana "belum dibaca" — jauh
   * lebih kecil ruginya daripada toast merah setiap kali pemilik toko mengklik
   * sebuah chat.
   */
  const handleMarkChatSeen = useCallback(async (phone: string) => {
    if (!phone) return;
    const nowIso = new Date().toISOString();
    setConversations((prev) =>
      prev.map((c) => (c.customer_phone === phone ? { ...c, last_seen_at: nowIso } : c))
    );
    try {
      await fetch("/api/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, seen: true })
      });
    } catch {
      /* diamkan — polling berikutnya memuat status yang benar */
    }
  }, []);

  // ── Cakupan produk per nomor WhatsApp ─────────────────────────────────
  const handleSaveDeviceScope = useCallback(
    async (deviceId: string, productIds: string[]) => {
      setSavingScopeId(deviceId);
      try {
        const res = await fetch("/api/fonnte/devices/scope", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, productIds })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || "Gagal menyimpan cakupan produk.", "error");
          return;
        }
        setDevices((prev) =>
          prev.map((d) => (d.id === deviceId ? { ...d, product_ids: productIds } : d))
        );
        showToast(
          productIds.length === 0
            ? "Nomor ini sekarang menjawab semua produk."
            : `Nomor ini menjawab ${productIds.length} produk pilihan.`
        );
      } catch {
        showToast("Terjadi kesalahan saat menyimpan cakupan produk.", "error");
      } finally {
        setSavingScopeId(null);
      }
    },
    [showToast]
  );

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* abaikan */
    }
    router.push("/login");
  }, [router]);

  // ── Menu bantuan ──────────────────────────────────────────────────────
  //
  // Sebelumnya dashboard tidak punya satu pun jalan keluar ketika pemilik toko
  // bingung: tautan panduan & alamat support hanya ada di halaman pemasaran,
  // yang justru tidak dibuka orang yang sudah login.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!helpOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [helpOpen]);

  // ── Turunan ───────────────────────────────────────────────────────────
  // `buyerOrders` ikut masuk: tanpa itu Ringkasan hanya bisa bercerita soal
  // jumlah chat — bukan berapa yang jadi pesanan dan berapa rupiah yang masuk.
  const stats = useMemo(
    () => computeStats(conversations, products, buyerOrders),
    [conversations, products, buyerOrders]
  );
  const dirty = useMemo(() => !sameForm(form, savedForm), [form, savedForm]);
  const originValid = isMengantarId(savedForm.originSubdistrictId);

  const planName = getPlan(packageId)?.name || "Starter";
  // Kemampuan per paket dibaca dari sumber yang sama dengan yang ditegakkan
  // server, jadi tampilan dashboard tidak pernah menjanjikan lebih dari isi bot.
  const conversationLimit = monthlyConversationLimit(packageId);
  const advancedAnalytics = hasAdvancedAnalytics(packageId);
  // Toko dianggap terhubung bila ADA nomor yang aktif — `fonnteStatus` hanya
  // mencerminkan nomor utama, jadi Pro dengan nomor utama mati tapi nomor kedua
  // aktif tetap harus terbaca "terhubung".
  const whatsappConnected = fonnteStatus.status || devices.some(isDeviceConnected);

  const trialMs = trialEndsAt ? new Date(trialEndsAt).getTime() - nowTs : 0;
  const trialActive = !isPaid && !!trialEndsAt && trialMs > 0;
  const trialExpired = !isPaid && !!trialEndsAt && trialMs <= 0;
  const trialLabel = trialActive
    ? trialMs < 24 * 60 * 60 * 1000
      ? `${Math.max(1, Math.ceil(trialMs / (60 * 60 * 1000)))} jam tersisa`
      : `${Math.ceil(trialMs / (24 * 60 * 60 * 1000))} hari tersisa`
    : "";

  // Langganan berbayar: masa aktifnya 30 hari per pembayaran, jadi dashboard
  // harus bisa memberi tahu SEBELUM mati — bukan hanya sesudah. Dihitung dari
  // `nowTs` yang berdetak supaya tab yang dibiarkan terbuka ikut berubah.
  const subMs = subscriptionEndsAt ? new Date(subscriptionEndsAt).getTime() - nowTs : 0;
  const subActive = isPaid && !!subscriptionEndsAt && subMs > 0;
  const subExpired = isPaid && !!subscriptionEndsAt && subMs <= 0;
  const subDaysLeft = Math.max(0, Math.ceil(subMs / DAY_MS));
  const subEndingSoon = subActive && subDaysLeft <= RENEWAL_WARNING_DAYS;

  // Terkunci = server bilang masa aktif habis, ATAU hitungan lokal sudah lewat
  // (tab yang dibiarkan terbuka melewati tengah malam tanpa polling baru).
  const lockedByServer =
    activityState === "trial_expired" ||
    activityState === "subscription_expired" ||
    activityState === "inactive";
  const locked = lockedByServer || trialExpired || subExpired;
  // Bedakan salinan teksnya: "uji coba habis" dan "langganan habis" adalah dua
  // situasi berbeda, dan menyebutnya keliru membuat pelanggan berbayar bingung.
  const lockedIsTrial = activityState === "trial_expired" || (trialExpired && !isPaid);

  const tabCounts: Partial<Record<TabId, number>> = {
    products: products.length,
    // Yang ditampilkan adalah pesanan yang PERLU DIPROSES — angka itulah yang
    // menjadi alasan pemilik toko membuka tab ini, bukan total sepanjang masa.
    orders: buyerOrders.filter((o) => o.status !== "done").length,
    chats: conversations.length
  };

  // Cegah "flash" data kosong: tampilkan skeleton hingga data toko termuat.
  if (loading && !storeId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin text-brand-600" aria-hidden="true" />
          <p className="text-sm">Memuat dashboard toko Anda…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-ink font-sans">
      {/* ── Toast ─────────────────────────────────────────────────────── */}
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:max-w-sm z-50 pointer-events-none"
      >
        {toast && (
          <div
            key={toast.key}
            className={`pointer-events-auto text-white font-medium px-4 py-3 rounded-2xl shadow-card-lg flex items-start gap-2 animate-scale-in ${
              toast.type === "error" ? "bg-red-600" : "bg-brand-700"
            }`}
          >
            {toast.type === "error" ? (
              <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span className="text-sm">{toast.msg}</span>
          </div>
        )}
      </div>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight shrink-0">
            <span className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </span>
            <span className="hidden xs:inline text-ink">
              BalesToko<span className="text-brand-600">.ai</span>
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex flex-col text-right min-w-0">
              <span className="text-sm font-semibold text-ink truncate max-w-[9rem] sm:max-w-none">
                {savedForm.storeName || "Toko Anda"}
              </span>
              <span className="hidden sm:block text-xs text-slate-400 truncate">{userEmail}</span>
            </div>

            {isPaid && (
              <span className="hidden md:inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                {planName}
              </span>
            )}

            {whatsappConnected ? (
              <span className="inline-flex items-center gap-1.5 bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">WhatsApp Terhubung</span>
                <span className="sm:hidden">Aktif</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Belum Terhubung</span>
                <span className="sm:hidden">Nonaktif</span>
              </span>
            )}

            <div className="relative shrink-0" ref={helpRef}>
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={helpOpen}
                aria-label="Bantuan"
                title="Bantuan"
                className="p-2 text-slate-400 hover:text-ink hover:bg-slate-100 rounded-xl transition-colors"
              >
                <CircleHelp className="w-5 h-5" aria-hidden="true" />
              </button>
              {helpOpen && (
                <div
                  role="menu"
                  aria-label="Bantuan"
                  className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-card-lg p-2 z-50"
                >
                  <p className="px-3 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Butuh bantuan?
                  </p>
                  <Link
                    href="/#cara-kerja"
                    role="menuitem"
                    onClick={() => setHelpOpen(false)}
                    className="flex items-start gap-2 px-3 py-2 rounded-xl hover:bg-slate-50"
                  >
                    <BookOpen className="w-4 h-4 mt-0.5 text-brand-600 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium text-ink">Panduan cara kerja</span>
                      <span className="block text-[11px] text-slate-400">
                        Dari sambungkan nomor sampai bot menjawab
                      </span>
                    </span>
                  </Link>
                  <Link
                    href="/#faq"
                    role="menuitem"
                    onClick={() => setHelpOpen(false)}
                    className="flex items-start gap-2 px-3 py-2 rounded-xl hover:bg-slate-50"
                  >
                    <CircleHelp
                      className="w-4 h-4 mt-0.5 text-brand-600 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">Pertanyaan umum</span>
                      <span className="block text-[11px] text-slate-400">
                        Ongkir, kuota chat, ganti nomor
                      </span>
                    </span>
                  </Link>
                  {/* Email dibawa lengkap dengan email akun & paket: keluhan yang
                      menyertakannya bisa langsung ditelusuri tanpa tanya-jawab. */}
                  <a
                    href={`mailto:halo@balestoko.ai?subject=${encodeURIComponent(
                      "Bantuan dashboard BalesToko"
                    )}&body=${encodeURIComponent(
                      `Email akun: ${userEmail}\nPaket: ${planName}\n\nKendala saya:\n`
                    )}`}
                    role="menuitem"
                    onClick={() => setHelpOpen(false)}
                    className="flex items-start gap-2 px-3 py-2 rounded-xl hover:bg-slate-50"
                  >
                    <LifeBuoy className="w-4 h-4 mt-0.5 text-brand-600 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium text-ink">Hubungi tim support</span>
                      <span className="block text-[11px] text-slate-400">halo@balestoko.ai</span>
                    </span>
                  </a>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-ink hover:bg-slate-100 rounded-xl transition-colors shrink-0"
              aria-label="Keluar dari akun"
              title="Keluar"
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Banner uji coba ───────────────────────────────────────────── */}
      {trialActive && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-900">
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
              Masa uji coba: <strong>{trialLabel}</strong>. Semua fitur Pro aktif.
            </span>
            <Link
              href="/#harga"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            >
              <Crown className="w-3.5 h-3.5" aria-hidden="true" /> Upgrade
            </Link>
          </div>
        </div>
      )}

      {/* ── Banner langganan hampir habis ─────────────────────────────── */}
      {subEndingSoon && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-900">
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
              Langganan berakhir dalam{" "}
              <strong>{subDaysLeft <= 1 ? "kurang dari 1 hari" : `${subDaysLeft} hari`}</strong>.
              Perpanjang supaya bot tidak berhenti membalas.
            </span>
            <Link
              href="/#harga"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            >
              <Crown className="w-3.5 h-3.5" aria-hidden="true" /> Perpanjang
            </Link>
          </div>
        </div>
      )}

      {locked ? (
        /* ── Gate: masa aktif berakhir ───────────────────────────────── */
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <div className="bg-white border border-amber-200 rounded-3xl shadow-card p-8 text-center space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <TriangleAlert className="h-8 w-8 text-amber-600" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold text-ink">
              {lockedIsTrial ? "Masa uji coba telah berakhir" : "Masa langganan telah berakhir"}
            </h2>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              {lockedIsTrial
                ? "Terima kasih telah mencoba BalesToko.ai. Untuk melanjutkan bot WhatsApp AI dan cek ongkir otomatis, silakan berlangganan salah satu paket."
                : "Bot WhatsApp Anda sementara berhenti membalas pesan pembeli. Perpanjang langganan untuk mengaktifkannya kembali — semua produk, nomor, dan riwayat chat Anda tetap tersimpan."}
            </p>
            <Link
              href="/#harga"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 px-6 py-3.5 text-sm font-semibold text-white shadow-card transition-colors"
            >
              <Crown className="h-4 w-4" aria-hidden="true" />
              {lockedIsTrial ? "Lihat paket berlangganan" : "Perpanjang langganan"}
            </Link>
            {!lockedIsTrial && (
              <p className="text-xs text-slate-400">
                Gunakan email <strong className="text-slate-500">{userEmail}</strong> saat
                memperpanjang agar langganan menempel ke toko ini.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
          {/* ── Navigasi ───────────────────────────────────────────────── */}
          <div className="lg:col-span-1 lg:space-y-3">
            {/* Mobile: pil horizontal yang bisa digeser. Desktop: daftar vertikal. */}
            <div
              role="tablist"
              aria-label="Bagian dashboard"
              className="flex lg:flex-col gap-1.5 lg:gap-1 overflow-x-auto lg:overflow-visible -mx-4 px-4 lg:mx-0 lg:px-2.5 lg:py-2.5 pb-1 lg:pb-2.5 lg:bg-white lg:border lg:border-slate-200 lg:rounded-2xl lg:shadow-card scrollbar-none"
            >
              {TABS.map((tab, index) => {
                const active = activeTab === tab.id;
                const count = tabCounts[tab.id];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    ref={(el) => {
                      tabRefs.current[tab.id] = el;
                    }}
                    aria-selected={active}
                    aria-controls={`panel-${tab.id}`}
                    tabIndex={active ? 0 : -1}
                    onKeyDown={(e) => handleTabKeyDown(e, index)}
                    onClick={() => goToTab(tab.id)}
                    className={`shrink-0 lg:w-full flex items-center gap-2 lg:gap-3 px-3.5 lg:px-4 py-2.5 lg:py-3 rounded-full lg:rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? "bg-brand-600 lg:bg-brand-50 text-white lg:text-brand-800 lg:border lg:border-brand-200 font-semibold"
                        : "bg-white lg:bg-transparent border border-slate-200 lg:border-transparent text-slate-500 hover:text-ink hover:bg-slate-50"
                    }`}
                  >
                    <tab.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="lg:hidden">{tab.short}</span>
                    <span className="hidden lg:inline">{tab.label}</span>
                    {count !== undefined && count > 0 && (
                      <span
                        className={`ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${
                          active
                            ? "bg-white/20 lg:bg-brand-100 text-white lg:text-brand-800"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Kartu status ringkas — hanya desktop, di mobile sudah ada di header. */}
            <div className="hidden lg:block bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-card">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status bot
                </span>
                <button
                  type="button"
                  onClick={() => fetchStoreData({ silent: true })}
                  className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label="Segarkan data"
                  title="Segarkan data"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-slate-400 ${refreshing ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {whatsappConnected ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-500" />
                    </span>
                    <span className="text-xs font-medium text-brand-800">WhatsApp aktif &amp; online</span>
                  </>
                ) : (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
                    <span className="text-xs text-slate-400">Menunggu koneksi WhatsApp</span>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="text-xs text-slate-400">Lokasi pengiriman</div>
                <div className="text-sm font-semibold text-ink flex items-start gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-brand-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{savedForm.originCityName || "Belum diatur"}</span>
                </div>
                {!originValid && (
                  <button
                    type="button"
                    onClick={() => goToTab("store")}
                    className="mt-2 inline-flex items-start gap-1 text-[11px] font-medium text-amber-700 hover:underline text-left"
                  >
                    <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                    Ongkir masih perkiraan — atur lokasi asal
                  </button>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-ink leading-none">{products.length}</div>
                  <div className="text-[11px] text-slate-400 mt-1">Produk</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-ink leading-none">{conversations.length}</div>
                  <div className="text-[11px] text-slate-400 mt-1">Percakapan</div>
                </div>
              </div>

              {subActive && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs text-slate-400">Langganan aktif sampai</div>
                  <div
                    className={`text-sm font-semibold mt-0.5 ${
                      subEndingSoon ? "text-amber-700" : "text-ink"
                    }`}
                  >
                    {new Date(subscriptionEndsAt as string).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                      year: "numeric"
                    })}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {subDaysLeft <= 1 ? "kurang dari 1 hari lagi" : `${subDaysLeft} hari lagi`}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Panel ──────────────────────────────────────────────────── */}
          <div className="lg:col-span-3">
            <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={activeTab !== "overview"}>
              {activeTab === "overview" && (
                <OverviewTab
                  stats={stats}
                  conversations={conversations}
                  whatsappConnected={whatsappConnected}
                  originValid={originValid}
                  originCityName={savedForm.originCityName || "lokasi toko"}
                  planName={planName}
                  conversationLimit={conversationLimit}
                  advancedAnalytics={advancedAnalytics}
                  onGoTo={goToTab}
                  onOpenChat={(c) => {
                    setSelectedPhone(c.customer_phone);
                    goToTab("chats");
                  }}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-whatsapp" aria-labelledby="tab-whatsapp" hidden={activeTab !== "whatsapp"}>
              {activeTab === "whatsapp" && (
                <WhatsappTab
                  devices={devices}
                  deviceLimit={deviceLimit}
                  planName={planName}
                  devicesNeedMigration={devicesNeedMigration}
                  refreshingDevices={refreshingDevices}
                  onRefreshDevices={() => refreshDevices({ live: true })}
                  expectedWebhookUrl={expectedWebhookUrl}
                  baseUrlWarning={baseUrlWarning}
                  repairingDeviceId={repairingDeviceId}
                  onRepairDevice={handleRepairDevice}
                  newPhone={newPhone}
                  setNewPhone={setNewPhone}
                  newLabel={newLabel}
                  setNewLabel={setNewLabel}
                  addingDevice={addingDevice}
                  onAddDevice={handleAddDevice}
                  removingDeviceId={removingDeviceId}
                  onRemoveDevice={handleRemoveDevice}
                  qrDeviceId={qrDevice ? qrDevice.id || qrDevice.phone : null}
                  qrUrl={qrUrl}
                  loadingQr={loadingQr}
                  onFetchQr={handleFetchQr}
                  onCancelQr={() => {
                    setQrUrl(null);
                    setQrDevice(null);
                    setQrTicks(0);
                  }}
                  testPhone={testPhone}
                  setTestPhone={setTestPhone}
                  testMessageText={testMessageText}
                  setTestMessageText={setTestMessageText}
                  testDeviceId={testDeviceId}
                  setTestDeviceId={setTestDeviceId}
                  sendingTest={sendingTest}
                  onSendTest={handleSendTest}
                  products={products}
                  savingScopeId={savingScopeId}
                  onSaveScope={handleSaveDeviceScope}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-store" aria-labelledby="tab-store" hidden={activeTab !== "store"}>
              {activeTab === "store" && (
                /* TeamMembers berdiri di luar StoreTab, bukan di dalamnya: akar
                   StoreTab adalah <form>, dan form bersarang tidak sah di HTML
                   — tombol "Tambah anggota" akan ikut men-submit pengaturan toko. */
                <div className="space-y-6">
                  <StoreTab
                    form={form}
                    setForm={patchForm}
                    dirty={dirty}
                    saving={saving}
                    onSave={handleSaveStoreConfig}
                    onReset={() => setForm(savedForm)}
                    originValid={originValid}
                    showToast={showToast}
                  />
                  <TeamMembers showToast={showToast} />
                </div>
              )}
            </div>

            <div role="tabpanel" id="panel-products" aria-labelledby="tab-products" hidden={activeTab !== "products"}>
              {activeTab === "products" && (
                <ProductsTab
                  products={products}
                  showToast={showToast}
                  onChanged={() => fetchStoreData({ light: true, silent: true })}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-orders" aria-labelledby="tab-orders" hidden={activeTab !== "orders"}>
              {activeTab === "orders" && (
                <OrdersTab
                  orders={buyerOrders}
                  needsMigration={ordersNeedMigration}
                  busyId={orderBusyId}
                  onSetStatus={handleSetOrderStatus}
                  onDelete={handleDeleteOrder}
                  showToast={showToast}
                />
              )}
            </div>

            <div role="tabpanel" id="panel-chats" aria-labelledby="tab-chats" hidden={activeTab !== "chats"}>
              {activeTab === "chats" && (
                <ChatsTab
                  conversations={conversations}
                  selectedPhone={selectedPhone}
                  onSelect={(phone) => setSelectedPhone(phone || null)}
                  onSendReply={handleSendManualReply}
                  onToggleAiPause={handleToggleAiPause}
                  onMarkSeen={handleMarkChatSeen}
                  sending={chatSending}
                  pausingPhone={chatPausingPhone}
                  canSend={!locked}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
