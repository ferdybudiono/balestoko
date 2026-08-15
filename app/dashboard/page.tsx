"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  MessageSquare,
  Package,
  QrCode,
  CheckCircle,
  Plus,
  Trash2,
  RefreshCw,
  Send,
  LogOut,
  Sparkles,
  Search,
  MapPin,
  Save,
  Smartphone,
  ShoppingBag,
  Wifi,
  WifiOff,
  ChevronRight,
  Clock,
  Crown,
  AlertTriangle
} from "lucide-react";

interface Product {
  id?: string;
  name: string;
  price: number;
  weight: number;
  description?: string;
}

interface Conversation {
  id?: string;
  customer_phone: string;
  customer_name?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
  last_intent?: string;
  destination_city?: string;
  updated_at?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"whatsapp" | "store" | "products" | "chats">("whatsapp");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // User State
  const [userEmail, setUserEmail] = useState("demo@balestoko.com");
  const [isPaid, setIsPaid] = useState(true);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  // Store Configuration State
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("Toko Online Saya");
  const [fonnteToken, setFonnteToken] = useState("");
  const [fonnteStatus, setFonnteStatus] = useState<{ status: boolean; device?: string; reason?: string }>({
    status: false,
    device: "DISCONNECTED",
    reason: "Belum terhubung"
  });
  const [originCityName, setOriginCityName] = useState("Jakarta Pusat");
  const [originSubdistrictId, setOriginSubdistrictId] = useState("3171010");
  const [defaultWeight, setDefaultWeight] = useState(1000);
  const [aiPromptSystem, setAiPromptSystem] = useState(
    "Kamu adalah Customer Service AI yang ramah dan profesional. Tugasmu adalah menyapa pembeli dengan hangat, menjawab pertanyaan produk, dan membantu mengecek tarif ongkos kirim (ongkir) menggunakan kurir ekspedisi."
  );
  const [greetingMessage, setGreetingMessage] = useState(
    "Halo! Selamat datang di toko kami 👋 Ada yang bisa saya bantu untuk produk atau cek tarif ongkir ke kota Kakak?"
  );

  // Location Search State
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<Array<{ id: string; subdistrict_name: string; city_name: string }>>([]);
  const [searchingLoc, setSearchingLoc] = useState(false);

  // Products State
  const [products, setProducts] = useState<Product[]>([]);
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductWeight, setNewProductWeight] = useState("1000");
  const [newProductDesc, setNewProductDesc] = useState("");

  // Chat Conversations State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);

  // QR Code State
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [connectPhone, setConnectPhone] = useState("");

  // Test Message State
  const [testPhone, setTestPhone] = useState("");
  const [testMessageText, setTestMessageText] = useState("Halo, cek ongkir ke Bandung dong");
  const [sendingTest, setSendingTest] = useState(false);

  const handleFetchQr = async () => {
    if (connectPhone.replace(/\D/g, "").length < 9 && !fonnteToken) {
      showToast("Masukkan nomor WhatsApp yang valid terlebih dahulu.");
      return;
    }
    setLoadingQr(true);
    try {
      const res = await fetch(`/api/fonnte/qr?phone=${encodeURIComponent(connectPhone)}`);
      const data = await res.json();
      if (res.ok) {
        if (data.connected) {
          showToast("WhatsApp sudah terhubung! 🎉");
          setQrUrl(null);
          fetchStoreData();
        } else if (data.qrUrl) {
          setQrUrl(data.qrUrl);
        } else {
          showToast(data.error || "QR Code belum tersedia. Silakan coba lagi.");
        }
      } else {
        showToast(data.error || "Gagal memuat QR Code.");
      }
    } catch {
      showToast("Gagal memuat QR Code.");
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    fetchStoreData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchStoreData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/store`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.store) {
          setStoreId(data.store.id || "");
          setUserEmail(data.store.email || "");
          setIsPaid(!!data.store.is_paid);
          setTrialEndsAt(data.store.trial_ends_at || null);
          setStoreName(data.store.store_name || "Toko Online Saya");
          setFonnteToken(data.store.fonnte_token || "");
          if (data.store.customer_phone && !connectPhone) setConnectPhone(data.store.customer_phone);
          setOriginCityName(data.store.origin_city_name || "Jakarta Pusat");
          setOriginSubdistrictId(data.store.origin_subdistrict_id || "3171010");
          setDefaultWeight(data.store.default_weight || 1000);
          if (data.store.ai_prompt_system) setAiPromptSystem(data.store.ai_prompt_system);
          if (data.store.greeting_message) setGreetingMessage(data.store.greeting_message);
        }

        if (data.fonnteStatus) {
          setFonnteStatus(data.fonnteStatus);
        }

        if (Array.isArray(data.products)) setProducts(data.products);
        if (Array.isArray(data.conversations)) {
          setConversations(data.conversations);
          if (data.conversations.length > 0) setSelectedChat(data.conversations[0]);
        }
      }
    } catch (err) {
      console.error("Gagal memuat data toko:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStoreConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_name: storeName,
          origin_city_name: originCityName,
          origin_subdistrict_id: originSubdistrictId,
          default_weight: defaultWeight,
          ai_prompt_system: aiPromptSystem,
          greeting_message: greetingMessage
        })
      });

      if (res.ok) {
        showToast("Pengaturan toko berhasil disimpan! ✨");
        fetchStoreData();
      } else {
        showToast("Gagal menyimpan pengaturan.");
      }
    } catch {
      showToast("Terjadi kesalahan saat menyimpan.");
    } finally {
      setSaving(false);
    }
  };

  const handleSearchLocation = async () => {
    if (!locationQuery.trim()) return;
    setSearchingLoc(true);
    try {
      const res = await fetch(`/api/ongkir?q=${encodeURIComponent(locationQuery)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.locations)) {
          setLocationResults(data.locations);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchingLoc(false);
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName || !newProductPrice || !storeId) return;

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProductName,
          price: Number(newProductPrice),
          weight: Number(newProductWeight) || 1000,
          description: newProductDesc
        })
      });

      if (res.ok) {
        showToast("Produk berhasil ditambahkan!");
        setNewProductName("");
        setNewProductPrice("");
        setNewProductDesc("");
        fetchStoreData();
      }
    } catch {
      showToast("Gagal menambah produk.");
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      const res = await fetch(`/api/products?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Produk berhasil dihapus.");
        fetchStoreData();
      }
    } catch {
      showToast("Gagal menghapus produk.");
    }
  };

  const handleSendTestWebhook = async () => {
    if (!testPhone) {
      showToast("Masukkan nomor WA penguji terlebih dahulu!");
      return;
    }
    setSendingTest(true);
    try {
      const res = await fetch("/api/fonnte/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: testPhone,
          message: testMessageText,
          device: fonnteToken
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast("Simulasi berhasil! Cek tab Riwayat Chat.");
        fetchStoreData();
        setActiveTab("chats");
      } else if (res.ok && data.status === "ignored") {
        showToast("Hubungkan WhatsApp dulu agar simulasi bisa diproses.");
      } else {
        showToast(data.error || "Gagal memicu simulasi.");
      }
    } catch {
      showToast("Terjadi kesalahan.");
    } finally {
      setSendingTest(false);
    }
  };

  const tabs = [
    { id: "whatsapp" as const, icon: Smartphone, label: "Hubungkan WhatsApp" },
    { id: "store" as const, icon: ShoppingBag, label: "Pengaturan Toko" },
    { id: "products" as const, icon: Package, label: `Produk (${products.length})` },
    { id: "chats" as const, icon: MessageSquare, label: `Chat AI (${conversations.length})` }
  ];

  // Status uji coba (trial) — dipakai untuk banner & gating akses.
  const trialMs = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : 0;
  const trialActive = !isPaid && !!trialEndsAt && trialMs > 0;
  const trialExpired = !isPaid && !!trialEndsAt && trialMs <= 0;
  const trialDaysLeft = trialActive ? Math.max(1, Math.ceil(trialMs / (24 * 60 * 60 * 1000))) : 0;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-600 text-white font-medium px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4" />
          <span className="text-sm">{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-xl tracking-tight">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-200">
              <Bot className="w-5 h-5" />
            </div>
            <span className="text-gray-900">BalesToko<span className="text-emerald-600">.ai</span></span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-sm font-semibold text-gray-800">{storeName}</span>
              <span className="text-xs text-gray-400">{userEmail}</span>
            </div>

            {/* Connection Status Badge */}
            {fonnteStatus.status ? (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Wifi className="w-3.5 h-3.5" />
                WhatsApp Terhubung
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                <WifiOff className="w-3.5 h-3.5" />
                Belum Terhubung
              </span>
            )}

            <button
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST" });
                } catch {
                  /* abaikan */
                }
                router.push("/login");
              }}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              title="Keluar"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Trial Status Banner */}
      {trialActive && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-800">
              <Clock className="w-4 h-4" />
              Masa uji coba Anda: <strong>{trialDaysLeft} hari tersisa</strong>. Nikmati semua fitur Pro.
            </span>
            <Link
              href="/#harga"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            >
              <Crown className="w-3.5 h-3.5" /> Upgrade Sekarang
            </Link>
          </div>
        </div>
      )}

      {/* Gate: masa uji coba berakhir & belum berlangganan */}
      {trialExpired ? (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <div className="bg-white border border-amber-200 rounded-3xl shadow-sm p-8 text-center space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Masa Uji Coba Telah Berakhir</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Terima kasih telah mencoba BalesToko.ai! Untuk melanjutkan menggunakan bot WhatsApp AI dan cek ongkir otomatis, silakan berlangganan salah satu paket.
            </p>
            <Link
              href="/#harga"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-200 transition-all"
            >
              <Crown className="h-4 w-4" /> Lihat Paket Berlangganan
            </Link>
          </div>
        </div>
      ) : (
      /* Main Content Layout */
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1 space-y-3">
          <div className="bg-white border border-gray-200 rounded-2xl p-2.5 space-y-1 shadow-sm">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <tab.icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </div>
                {activeTab === tab.id && <ChevronRight className="w-4 h-4 text-emerald-400" />}
              </button>
            ))}
          </div>

          {/* Quick Status Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status Bot AI</span>
              <button onClick={() => fetchStoreData()} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {fonnteStatus.status ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium text-emerald-700">WhatsApp Aktif & Online</span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                  <span className="text-xs text-gray-400">Menunggu koneksi WhatsApp</span>
                </>
              )}
            </div>
            <div className="pt-2 border-t border-gray-100">
              <div className="text-xs text-gray-400">Lokasi Pengiriman</div>
              <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                {originCityName}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Content Panels */}
        <div className="lg:col-span-3 space-y-6">

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 1: HUBUNGKAN WHATSAPP (QR SCAN) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "whatsapp" && (
            <div className="space-y-6">
              {/* QR Scan Card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 pt-6 pb-4">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Smartphone className="w-5 h-5 text-emerald-600" />
                    Hubungkan WhatsApp Toko Anda
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Scan QR Code di bawah untuk menghubungkan nomor WhatsApp toko. Setelah terhubung, semua pesan pembeli akan otomatis dijawab oleh AI.
                  </p>
                </div>

                <div className="px-6 pb-6">
                  {/* Connection Status Banner */}
                  {fonnteStatus.status ? (
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl mb-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-emerald-800">WhatsApp Sudah Terhubung! 🎉</p>
                        <p className="text-xs text-emerald-600 mt-0.5">Bot AI CS dan Cek Ongkir otomatis sudah aktif menerima pesan pembeli.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-6 space-y-5">
                      <div className="w-full max-w-sm text-left space-y-1.5">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Nomor WhatsApp yang ingin dihubungkan
                        </label>
                        <input
                          type="tel"
                          inputMode="tel"
                          placeholder="mis. 0812xxxxxxx"
                          value={connectPhone}
                          onChange={(e) => setConnectPhone(e.target.value)}
                          disabled={!!fonnteToken}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                        />
                        <p className="text-[11px] text-gray-400">
                          {fonnteToken
                            ? "Device sudah dibuat untuk nomor ini. Scan QR di bawah untuk menautkan."
                            : "Nomor ini akan didaftarkan sebagai device WhatsApp khusus toko Anda."}
                        </p>
                      </div>
                      {qrUrl ? (
                        <>
                          <div className="p-4 bg-white border-2 border-emerald-200 rounded-3xl shadow-lg shadow-emerald-100/50 inline-block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={qrUrl} alt="WhatsApp QR Code" className="w-56 h-56 object-contain" />
                          </div>
                          <div className="space-y-2 max-w-sm">
                            <p className="text-sm font-semibold text-gray-800">Scan dengan WhatsApp Anda</p>
                            <ol className="text-xs text-gray-500 text-left list-decimal list-inside space-y-1">
                              <li>Buka aplikasi <strong>WhatsApp</strong> di HP toko Anda</li>
                              <li>Ketuk menu <strong>⋮</strong> &rarr; <strong>Perangkat Tertaut</strong></li>
                              <li>Ketuk <strong>Tautkan Perangkat</strong></li>
                              <li>Arahkan kamera ke QR Code di atas</li>
                            </ol>
                          </div>
                          <button onClick={handleFetchQr} disabled={loadingQr} className="text-xs text-emerald-600 hover:underline font-medium">
                            {loadingQr ? "Memuat ulang..." : "Muat ulang QR Code"}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-20 h-20 rounded-3xl bg-gray-100 flex items-center justify-center">
                            <QrCode className="w-10 h-10 text-gray-300" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-gray-700">WhatsApp belum terhubung</p>
                            <p className="text-xs text-gray-400">Klik tombol di bawah untuk menampilkan QR Code dan mulai menghubungkan.</p>
                          </div>
                          <button
                            onClick={handleFetchQr}
                            disabled={loadingQr}
                            className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-emerald-200 flex items-center gap-2"
                          >
                            <QrCode className="w-4 h-4" />
                            <span>{loadingQr ? "Memuat QR Code..." : "Tampilkan QR Code"}</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Test Simulator Card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  Uji Coba Simulasi Chat AI
                </h3>
                <p className="text-xs text-gray-400">Simulasikan pesan dari pembeli untuk menguji respons AI dan pengecekan ongkir otomatis.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Nomor WA penguji (08xxx)"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    type="text"
                    placeholder="Pesan simulasi pembeli..."
                    value={testMessageText}
                    onChange={(e) => setTestMessageText(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <button
                  onClick={handleSendTestWebhook}
                  disabled={sendingTest}
                  className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4 text-emerald-500" />
                  <span>{sendingTest ? "Menguji..." : "Kirim Simulasi Chat"}</span>
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 2: PENGATURAN TOKO */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "store" && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-emerald-600" />
                  Pengaturan Toko & Ongkir
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Atur nama toko, lokasi pengiriman asal, serta pesan sapaan dan instruksi AI CS.
                </p>
              </div>

              <form onSubmit={handleSaveStoreConfig} className="space-y-6">
                {/* Store Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Nama Toko</label>
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                {/* Origin Location Search */}
                <div className="p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">Lokasi Asal Pengiriman Toko</label>
                  <p className="text-xs text-gray-400">Pilih kecamatan/kota tempat toko Anda mengirimkan barang untuk perhitungan ongkir otomatis.</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                      <input
                        type="text"
                        placeholder="Cari kota atau kecamatan (misal: Bandung)"
                        value={locationQuery}
                        onChange={(e) => setLocationQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSearchLocation}
                      disabled={searchingLoc}
                      className="px-4 py-2.5 bg-white hover:bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700 rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>{searchingLoc ? "Cari..." : "Cari"}</span>
                    </button>
                  </div>

                  {locationResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
                      {locationResults.map((loc) => (
                        <div
                          key={loc.id}
                          onClick={() => {
                            setOriginCityName(`${loc.subdistrict_name}, ${loc.city_name}`);
                            setOriginSubdistrictId(loc.id);
                            setLocationResults([]);
                            setLocationQuery("");
                            showToast(`Lokasi asal diubah ke ${loc.subdistrict_name}`);
                          }}
                          className="p-3 hover:bg-emerald-50 cursor-pointer text-sm flex justify-between items-center transition-colors"
                        >
                          <span className="font-medium text-gray-700">{loc.subdistrict_name}, {loc.city_name}</span>
                          <ChevronRight className="w-4 h-4 text-gray-300" />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-gray-400">Lokasi aktif:</span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {originCityName}
                    </span>
                  </div>
                </div>

                {/* AI Settings */}
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                      Pesan Sambutan Otomatis (Saat Pembeli Chat Pertama Kali)
                    </label>
                    <textarea
                      rows={2}
                      value={greetingMessage}
                      onChange={(e) => setGreetingMessage(e.target.value)}
                      className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                      Instruksi Khusus untuk AI CS
                    </label>
                    <textarea
                      rows={3}
                      value={aiPromptSystem}
                      onChange={(e) => setAiPromptSystem(e.target.value)}
                      className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <p className="text-xs text-gray-400 mt-1">Tentukan cara AI menjawab, gaya bahasa, aturan khusus toko, dll.</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-emerald-200 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "Menyimpan..." : "Simpan Pengaturan"}</span>
                </button>
              </form>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 3: KATALOG PRODUK */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "products" && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-600" />
                    Katalog Produk
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Tambahkan produk agar AI dapat memberikan info harga, berat, dan rekomendasi kepada pembeli di WhatsApp.
                  </p>
                </div>

                {/* Add Product Form */}
                <form onSubmit={handleAddProduct} className="p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-4">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tambah Produk Baru</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Nama Produk"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400"
                    />
                    <input
                      type="number"
                      required
                      placeholder="Harga (Rp)"
                      value={newProductPrice}
                      onChange={(e) => setNewProductPrice(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400"
                    />
                    <input
                      type="number"
                      placeholder="Berat (Gram)"
                      value={newProductWeight}
                      onChange={(e) => setNewProductWeight(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Deskripsi singkat produk (opsional)"
                    value={newProductDesc}
                    onChange={(e) => setNewProductDesc(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Produk</span>
                  </button>
                </form>

                {/* Product List */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Daftar Produk</h3>
                  {products.length === 0 ? (
                    <div className="p-10 text-center border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 text-sm">
                      <Package className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                      Belum ada produk. Tambahkan produk pertama Anda di atas.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {products.map((p) => (
                        <div key={p.id || p.name} className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex justify-between items-start hover:border-emerald-300 transition-colors">
                          <div>
                            <h4 className="font-bold text-sm text-gray-800">{p.name}</h4>
                            <p className="text-sm font-semibold text-emerald-600 mt-0.5">
                              Rp {p.price.toLocaleString("id-ID")}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">Berat: {p.weight} gram</p>
                            {p.description && <p className="text-xs text-gray-500 mt-2">{p.description}</p>}
                          </div>
                          {p.id && (
                            <button
                              onClick={() => handleDeleteProduct(p.id!)}
                              className="text-gray-300 hover:text-red-400 p-1.5 rounded-lg transition-colors"
                              title="Hapus produk"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 4: RIWAYAT CHAT AI */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "chats" && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-600" />
                  Riwayat Percakapan AI
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Pantau pesan pembeli dan respons otomatis AI CS secara real-time.
                </p>
              </div>

              {conversations.length === 0 ? (
                <div className="p-14 text-center border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 space-y-2">
                  <MessageSquare className="w-10 h-10 mx-auto text-gray-300" />
                  <p className="text-sm">Belum ada percakapan masuk.</p>
                  <p className="text-xs">Gunakan <strong>Uji Coba Simulasi</strong> pada tab Hubungkan WhatsApp untuk mengetes.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 min-h-[400px]">
                  {/* Left Chat List */}
                  <div className="md:col-span-1 border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden bg-gray-50">
                    {conversations.map((c) => (
                      <div
                        key={c.customer_phone}
                        onClick={() => setSelectedChat(c)}
                        className={`p-3.5 cursor-pointer transition-colors ${
                          selectedChat?.customer_phone === c.customer_phone
                            ? "bg-emerald-50 border-l-3 border-emerald-500"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        <div className="font-semibold text-sm text-gray-800">{c.customer_phone}</div>
                        <div className="text-xs text-gray-400 mt-0.5 truncate">
                          {c.messages[c.messages.length - 1]?.content || "Tidak ada pesan"}
                        </div>
                        {c.last_intent && (
                          <span className="inline-block mt-2 text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                            {c.last_intent}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Right Chat Viewer */}
                  <div className="md:col-span-2 border border-gray-200 rounded-2xl p-4 bg-gray-50 flex flex-col justify-between">
                    {selectedChat ? (
                      <div className="space-y-4 flex-1 overflow-y-auto max-h-[450px] pr-2">
                        <div className="pb-3 border-b border-gray-200 flex justify-between items-center">
                          <div>
                            <span className="font-semibold text-sm text-gray-800">{selectedChat.customer_phone}</span>
                            {selectedChat.destination_city && (
                              <span className="block text-xs text-emerald-600 mt-0.5">
                                Tujuan Ongkir: {selectedChat.destination_city}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          {selectedChat.messages.map((m, idx) => (
                            <div
                              key={idx}
                              className={`flex flex-col ${m.role === "user" ? "items-start" : "items-end"}`}
                            >
                              <div
                                className={`max-w-[85%] p-3 rounded-2xl text-sm whitespace-pre-wrap ${
                                  m.role === "user"
                                    ? "bg-white border border-gray-200 text-gray-800 rounded-tl-none"
                                    : "bg-emerald-600 text-white rounded-tr-none shadow-sm"
                                }`}
                              >
                                <span className={`block font-bold text-[10px] mb-1 ${m.role === "user" ? "text-gray-400" : "text-emerald-200"}`}>
                                  {m.role === "user" ? "Pembeli" : "AI CS"}
                                </span>
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        Pilih percakapan di sebelah kiri.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
      )}
    </div>
  );
}
