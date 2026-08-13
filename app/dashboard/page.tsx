"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  MessageSquare,
  Truck,
  Package,
  Settings,
  QrCode,
  CheckCircle,
  AlertCircle,
  Copy,
  Plus,
  Trash2,
  RefreshCw,
  Send,
  LogOut,
  Sparkles,
  Search,
  MapPin,
  Save
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
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // User State
  const [userEmail, setUserEmail] = useState("demo@balestoko.com");

  // Store Configuration State
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("Toko Online Saya");
  const [fonnteToken, setFonnteToken] = useState("");
  const [fonnteStatus, setFonnteStatus] = useState<{ status: boolean; device?: string; reason?: string }>({
    status: false,
    device: "DISCONNECTED",
    reason: "Belum terhubung"
  });
  const [mengantarApiKey, setMengantarApiKey] = useState("");
  const [originCityName, setOriginCityName] = useState("Jakarta Pusat");
  const [originSubdistrictId, setOriginSubdistrictId] = useState("3171010");
  const [defaultWeight, setDefaultWeight] = useState(1000);
  const [aiPromptSystem, setAiPromptSystem] = useState(
    "Kamu adalah Customer Service AI yang ramah dan profesional. Tugasmu adalah menyapa pembeli dengan hangat, menjawab pertanyaan produk, dan membantu mengecek tarif ongkos kirim (ongkir) menggunakan kurir ekspedisi."
  );
  const [greetingMessage, setGreetingMessage] = useState(
    "Halo! Selamat datang di toko kami 👋 Ada yang bisa saya bantu untuk produk atau cek tarif ongkir ke kota Kakak?"
  );

  // Mengantar Search Location State
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

  // Test Message State
  const [testPhone, setTestPhone] = useState("");
  const [testMessageText, setTestMessageText] = useState("Halo, cek ongkir ke Bandung dong");
  const [sendingTest, setSendingTest] = useState(false);

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/fonnte/webhook` : "https://balestoko.vercel.app/api/fonnte/webhook";

  const handleFetchQr = async () => {
    setLoadingQr(true);
    try {
      const res = await fetch(`/api/fonnte/qr?token=${encodeURIComponent(fonnteToken)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          showToast(data.message || "WhatsApp Device sudah terhubung!");
          setQrUrl(null);
          fetchStoreData(userEmail);
        } else if (data.qrUrl) {
          setQrUrl(data.qrUrl);
          showToast("QR Code berhasil dimuat. Silakan scan dengan kamera WhatsApp Anda!");
        } else {
          showToast(data.error || "Gagal memuat QR Code.");
        }
      }
    } catch {
      showToast("Gagal mengambil QR Code.");
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const email = localStorage.getItem("user_email") || "demo@balestoko.com";
      setUserEmail(email);
      fetchStoreData(email);
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchStoreData = async (email: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/store?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.store) {
          setStoreId(data.store.id || "");
          setStoreName(data.store.store_name || "Toko Online Saya");
          setFonnteToken(data.store.fonnte_token || "");
          setMengantarApiKey(data.store.mengantar_api_key || "");
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
          email: userEmail,
          store_name: storeName,
          fonnte_token: fonnteToken,
          mengantar_api_key: mengantarApiKey,
          origin_city_name: originCityName,
          origin_subdistrict_id: originSubdistrictId,
          default_weight: defaultWeight,
          ai_prompt_system: aiPromptSystem,
          greeting_message: greetingMessage
        })
      });

      if (res.ok) {
        showToast("Konfigurasi toko berhasil disimpan! ✨");
        fetchStoreData(userEmail);
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
      const res = await fetch(`/api/ongkir?q=${encodeURIComponent(locationQuery)}&apiKey=${encodeURIComponent(mengantarApiKey)}`);
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
          store_id: storeId,
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
        fetchStoreData(userEmail);
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
        fetchStoreData(userEmail);
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

      if (res.ok) {
        const data = await res.json();
        showToast("Balasan AI berhasil terpicu! Silakan periksa Tab Chat Logs.");
        fetchStoreData(userEmail);
        setActiveTab("chats");
      } else {
        showToast("Gagal memicu webhook simulator.");
      }
    } catch {
      showToast("Terjadi kesalahan testing webhook.");
    } finally {
      setSendingTest(false);
    }
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-slate-950 font-medium px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 animate-bounce">
          <Sparkles className="w-5 h-5" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-md">
              <Bot className="w-5 h-5" />
            </div>
            <span>BalesToko<span className="text-emerald-400">.ai</span></span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-200">{storeName}</span>
              <span className="text-[11px] text-slate-400">{userEmail}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium px-2.5 py-1 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Status: LUNAS (Midtrans)</span>
            </span>
            <button
              onClick={() => {
                if (typeof window !== "undefined") localStorage.removeItem("user_email");
                router.push("/login");
              }}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Keluar"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1 space-y-2">
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-3 space-y-1">
            <button
              onClick={() => setActiveTab("whatsapp")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "whatsapp"
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>Penautan WhatsApp (Fonnte)</span>
            </button>

            <button
              onClick={() => setActiveTab("store")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "store"
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>Toko & Mengantar (Ongkir)</span>
            </button>

            <button
              onClick={() => setActiveTab("products")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "products"
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Katalog Produk ({products.length})</span>
            </button>

            <button
              onClick={() => setActiveTab("chats")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "chats"
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Riwayat Chat WA AI ({conversations.length})</span>
            </button>
          </div>

          {/* Device Quick Status Box */}
          <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Status Device Fonnte:</span>
              {fonnteStatus.status ? (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  TERHUBUNG
                </span>
              ) : (
                <span className="text-amber-400 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  STANDBY / DISCONNECTED
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              <span className="block font-medium text-slate-300">Asal Pengiriman Toko:</span>
              <span className="text-emerald-400 font-semibold">{originCityName}</span>
            </div>
          </div>
        </div>

        {/* Tab Content Panels */}
        <div className="lg:col-span-3 space-y-6">
          {/* TAB 1: FONNTE WHATSAPP LINK & SETUP */}
          {activeTab === "whatsapp" && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <QrCode className="w-5 h-5 text-emerald-400" />
                      Pengaturan Penautan Fonnte WhatsApp Gateway
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Hubungkan akun Fonnte Anda agar pesan WhatsApp dari pembeli otomatis dijawab oleh AI Model & Cek Ongkir.
                    </p>
                  </div>
                  <button
                    onClick={() => fetchStoreData(userEmail)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-xl transition-colors"
                    title="Refresh status"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                <form onSubmit={handleSaveStoreConfig} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Fonnte Device Token (API Key)
                    </label>
                    <input
                      type="text"
                      placeholder="Masukkan Token Device dari Fonnte Dashboard"
                      value={fonnteToken}
                      onChange={(e) => setFonnteToken(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      *Dapatkan token gratis atau premium Anda di{" "}
                      <a href="https://fonnte.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline">
                        Fonnte.com Dashboard
                      </a>.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      <span>{saving ? "Memproses..." : "Simpan Token Fonnte"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleFetchQr}
                      disabled={loadingQr}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm rounded-xl border border-slate-700 transition-colors flex items-center gap-2"
                    >
                      <QrCode className="w-4 h-4 text-emerald-400" />
                      <span>{loadingQr ? "Memuat QR..." : "Tampilkan QR Code WA"}</span>
                    </button>
                  </div>
                </form>

                {/* QR CODE DISPLAY BOX */}
                {qrUrl && (
                  <div className="p-6 bg-slate-950 border border-emerald-500/30 rounded-2xl text-center space-y-4 animate-fade-in">
                    <h3 className="text-sm font-bold text-emerald-400 flex items-center justify-center gap-2">
                      <QrCode className="w-5 h-5" />
                      Scan QR Code Ini Dengan Kamera WhatsApp HP Toko Anda
                    </h3>
                    <div className="p-3 bg-white inline-block rounded-2xl shadow-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrUrl} alt="WhatsApp QR Code" className="w-56 h-56 mx-auto object-contain" />
                    </div>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Buka aplikasi WhatsApp di HP Anda -&gt; Menu <strong>Perangkat Tertaut (Linked Devices)</strong> -&gt; Klik <strong>Tautkan Perangkat</strong> -&gt; Arahkan kamera ke QR Code di atas.
                    </p>
                  </div>
                )}

                {/* Webhook Settings Instructions Box */}
                <div className="pt-6 border-t border-slate-800 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    URL Webhook Otomatis (Paste di Fonnte Dashboard)
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={webhookUrl}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400"
                    />
                    <button
                      onClick={copyWebhook}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copied ? "Tersalin!" : "Salin URL"}</span>
                    </button>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl text-xs text-slate-400 space-y-2">
                    <p className="font-semibold text-slate-300">Cara Pengaturan di Fonnte:</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400">
                      <li>Buka Dashboard Fonnte -&gt; Pilih Menu <strong>Device</strong>.</li>
                      <li>Scan QR Code untuk menautkan nomor WhatsApp toko Anda.</li>
                      <li>Masukkan URL Webhook di atas ke kolom <strong>Webhook URL</strong> Fonnte.</li>
                      <li>Simpan. Setiap chat WA masuk akan otomatis dijawab oleh AI CS + Cek Ongkir!</li>
                    </ol>
                  </div>
                </div>

                {/* Interactive Simulator / Tester */}
                <div className="pt-6 border-t border-slate-800 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Uji Coba Simulator Chat WhatsApp AI
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Nomor HP Penguji (WhatsApp)</label>
                      <input
                        type="text"
                        placeholder="081234567890"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Pesan Simulasi Pembeli</label>
                      <input
                        type="text"
                        placeholder="Halo, kirim ke Bandung berapa ongkirnya?"
                        value={testMessageText}
                        onChange={(e) => setTestMessageText(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleSendTestWebhook}
                    disabled={sendingTest}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{sendingTest ? "Menguji AI..." : "Simulasi Kirim Chat ke Webhook AI"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STORE CONFIGURATION & MENGANTAR ONGKIR */}
          {activeTab === "store" && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Truck className="w-5 h-5 text-emerald-400" />
                  Konfigurasi Toko & Mengantar API (Jasa Kurir)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Atur kota pengiriman asal Mengantar API, API Key Mengantar, serta Persona & Sistem Prompt AI CS.
                </p>
              </div>

              <form onSubmit={handleSaveStoreConfig} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Nama Toko
                    </label>
                    <input
                      type="text"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Mengantar API Key (Opsional)
                    </label>
                    <input
                      type="text"
                      placeholder="API Key dari Dashboard Mengantar"
                      value={mengantarApiKey}
                      onChange={(e) => setMengantarApiKey(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono placeholder-slate-600 focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Location Search for Mengantar Origin */}
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Lokasi Asal Pengiriman Toko (Mengantar Origin)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                      <input
                        type="text"
                        placeholder="Cari Kota / Kecamatan asal (misal: Jakarta Pusat / Bandung)"
                        value={locationQuery}
                        onChange={(e) => setLocationQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSearchLocation}
                      disabled={searchingLoc}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>{searchingLoc ? "Mencari..." : "Cari Lokasi"}</span>
                    </button>
                  </div>

                  {locationResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800 bg-slate-900">
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
                          className="p-2.5 hover:bg-slate-800 cursor-pointer text-xs flex justify-between items-center"
                        >
                          <span className="font-medium text-slate-200">{loc.subdistrict_name}, {loc.city_name}</span>
                          <span className="text-[10px] text-emerald-400 font-mono">ID: {loc.id}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-slate-400 flex items-center gap-2 pt-1">
                    <span>Lokasi Asal Aktif:</span>
                    <span className="font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                      {originCityName} (ID: {originSubdistrictId})
                    </span>
                  </div>
                </div>

                {/* AI Persona Settings */}
                <div className="space-y-4 pt-4 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Sapaan Otomatis Pertama Kali (Greeting Message)
                    </label>
                    <textarea
                      rows={2}
                      value={greetingMessage}
                      onChange={(e) => setGreetingMessage(e.target.value)}
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      System Prompt & Instruksi Khusus AI CS
                    </label>
                    <textarea
                      rows={3}
                      value={aiPromptSystem}
                      onChange={(e) => setAiPromptSystem(e.target.value)}
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "Memproses..." : "Simpan Semua Pengaturan Toko"}</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: PRODUCT CATALOG */}
          {activeTab === "products" && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-400" />
                    Katalog Produk & Knowledge Base AI
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Tambahkan produk yang dijual agar AI Model dapat memberikan rincian harga dan rekomendasi kepada pembeli di WhatsApp.
                  </p>
                </div>

                {/* Form Tambah Produk */}
                <form onSubmit={handleAddProduct} className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-4">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Tambah Produk Baru</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <input
                        type="text"
                        required
                        placeholder="Nama Produk"
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div>
                      <input
                        type="number"
                        required
                        placeholder="Harga (Rp)"
                        value={newProductPrice}
                        onChange={(e) => setNewProductPrice(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div>
                      <input
                        type="number"
                        placeholder="Berat (Gram)"
                        value={newProductWeight}
                        onChange={(e) => setNewProductWeight(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Deskripsi singkat produk (opsional)"
                      value={newProductDesc}
                      onChange={(e) => setNewProductDesc(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Produk ke AI</span>
                  </button>
                </form>

                {/* List Produk */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Daftar Produk Aktif</h3>
                  {products.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                      Belum ada produk yang ditambahkan. Tambahkan produk pertama Anda di atas.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {products.map((p) => (
                        <div key={p.id} className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-sm text-slate-200">{p.name}</h4>
                            <p className="text-xs font-semibold text-emerald-400 mt-0.5">
                              Rp {p.price.toLocaleString("id-ID")}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">Berat: {p.weight} gram</p>
                            {p.description && <p className="text-xs text-slate-400 mt-2">{p.description}</p>}
                          </div>
                          {p.id && (
                            <button
                              onClick={() => handleDeleteProduct(p.id!)}
                              className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg transition-colors"
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

          {/* TAB 4: CHAT LOGS & LIVE CONVERSATIONS */}
          {activeTab === "chats" && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-400" />
                  Riwayat Percakapan WA Pembeli (Live AI Logs)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Pantau balasan otomatis AI CS, pengecekan ongkir Mengantar, dan interaksi pembeli secara real-time.
                </p>
              </div>

              {conversations.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs space-y-2">
                  <MessageSquare className="w-8 h-8 mx-auto text-slate-600" />
                  <p>Belum ada chat masuk. Anda dapat menggunakan **Uji Coba Simulator** pada Tab Penautan WA.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 min-h-[400px]">
                  {/* Left Chat List */}
                  <div className="md:col-span-1 border border-slate-800 rounded-xl divide-y divide-slate-800 overflow-hidden bg-slate-950/60">
                    {conversations.map((c) => (
                      <div
                        key={c.customer_phone}
                        onClick={() => setSelectedChat(c)}
                        className={`p-3 cursor-pointer text-xs transition-colors ${
                          selectedChat?.customer_phone === c.customer_phone
                            ? "bg-emerald-500/10 border-l-2 border-emerald-400"
                            : "hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="font-bold text-slate-200">{c.customer_phone}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {c.messages[c.messages.length - 1]?.content || "Tidak ada pesan"}
                        </div>
                        {c.last_intent && (
                          <span className="inline-block mt-2 text-[10px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
                            {c.last_intent}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Right Chat History Viewer */}
                  <div className="md:col-span-2 border border-slate-800 rounded-xl p-4 bg-slate-950 flex flex-col justify-between">
                    {selectedChat ? (
                      <div className="space-y-4 flex-1 overflow-y-auto max-h-[450px] pr-2">
                        <div className="pb-3 border-b border-slate-800 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-200">Pengirim: {selectedChat.customer_phone}</span>
                            {selectedChat.destination_city && (
                              <span className="block text-emerald-400 text-[11px]">
                                Tujuan Cek Ongkir: {selectedChat.destination_city}
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
                                className={`max-w-[85%] p-3 rounded-2xl text-xs whitespace-pre-wrap ${
                                  m.role === "user"
                                    ? "bg-slate-800 text-slate-200 rounded-tl-none"
                                    : "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 rounded-tr-none"
                                }`}
                              >
                                <span className="block font-bold text-[10px] text-slate-400 mb-1">
                                  {m.role === "user" ? "Pembeli (WA)" : "AI CS Agent"}
                                </span>
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                        Pilih kontak percakapan di sebelah kiri untuk melihat pesan.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
