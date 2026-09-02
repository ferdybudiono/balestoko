"use client";

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BotOff,
  CheckCircle2,
  Circle,
  Crown,
  Inbox,
  MapPin,
  MessageSquare,
  Package,
  PackageX,
  Receipt,
  Send,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
  Wallet
} from "lucide-react";
import type { DashboardStats } from "./stats";
import {
  conversationLabel,
  formatCompact,
  formatRupiah,
  hasUnread,
  intentLabel,
  relativeTime,
  type Conversation,
  type TabId
} from "./types";

interface OverviewTabProps {
  stats: DashboardStats;
  conversations: Conversation[];
  whatsappConnected: boolean;
  originValid: boolean;
  originCityName: string;
  planName: string;
  /** Kuota percakapan bulan ini; `null` = paket tanpa batas. */
  conversationLimit: number | null;
  /** Grafik tren & sebaran topik hanya untuk paket yang berhak. */
  advancedAnalytics: boolean;
  onGoTo: (tab: TabId) => void;
  onOpenChat: (convo: Conversation) => void;
}

/**
 * Meter kuota percakapan bulanan.
 *
 * Wajib ada begitu kuota ditegakkan di server: kalau bot berhenti membalas
 * karena kuota habis, pemilik toko harus bisa melihat sebabnya di sini — bukan
 * menebak-nebak kenapa pembeli tidak dijawab.
 */
function QuotaMeter({
  used,
  limit,
  planName
}: {
  used: number;
  limit: number;
  planName: string;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const exhausted = used >= limit;
  const nearLimit = !exhausted && pct >= 80;

  const tone = exhausted
    ? { box: "bg-rose-50 border-rose-200", bar: "bg-rose-500", text: "text-rose-900" }
    : nearLimit
      ? { box: "bg-amber-50 border-amber-200", bar: "bg-amber-500", text: "text-amber-900" }
      : { box: "bg-white border-slate-200", bar: "bg-brand-500", text: "text-slate-600" };

  return (
    <div className={`border rounded-2xl p-4 sm:p-5 shadow-card ${tone.box}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-ink">
          Percakapan bulan ini{" "}
          <span className="font-medium text-slate-400">&middot; paket {planName}</span>
        </h3>
        <p className={`text-sm font-semibold ${tone.text}`}>
          {used.toLocaleString("id-ID")} / {limit.toLocaleString("id-ID")}
        </p>
      </div>

      <div
        className="mt-3 h-2 w-full rounded-full bg-slate-200/70 overflow-hidden"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label="Pemakaian kuota percakapan bulan ini"
      >
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>

      <p className={`mt-2.5 text-xs leading-relaxed ${exhausted || nearLimit ? tone.text : "text-slate-500"}`}>
        {exhausted ? (
          <>
            <strong>Kuota habis — bot berhenti membalas pembeli baru.</strong> Pembeli yang sudah
            chat bulan ini tetap dilayani. Kuota reset pada tanggal 1.
          </>
        ) : nearLimit ? (
          <>
            Sisa {(limit - used).toLocaleString("id-ID")} percakapan. Setelah habis, pembeli baru
            tidak dibalas sampai tanggal 1.
          </>
        ) : (
          <>Satu pembeli dihitung satu percakapan, sebanyak apa pun pesannya. Reset tanggal 1.</>
        )}
      </p>

      {(exhausted || nearLimit) && (
        <Link
          href="/#harga"
          className={`mt-3 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition-colors ${
            exhausted ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          <Crown className="w-3.5 h-3.5" aria-hidden="true" />
          Upgrade ke Pro — percakapan tanpa batas
        </Link>
      )}
    </div>
  );
}

/** Ajakan upgrade di tempat analitik lanjutan seharusnya berada. */
function AnalyticsLocked() {
  return (
    <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
        <Crown className="w-6 h-6 text-amber-600" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-sm font-bold text-ink">Analitik lanjutan ada di paket Pro</h3>
      <p className="mt-1.5 text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
        Grafik tren 7 hari, sebaran topik percakapan, dan kota tujuan ongkir terpopuler — supaya
        Anda tahu apa yang paling sering ditanyakan pembeli dan dari mana mereka.
      </p>
      <Link
        href="/#harga"
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
      >
        <Crown className="w-3.5 h-3.5" aria-hidden="true" />
        Lihat paket Pro
      </Link>
    </div>
  );
}

/**
 * Stat tile: label sentence-case, nilai tebal dengan angka proporsional
 * (BUKAN tabular-nums — itu bikin angka besar terlihat renggang).
 */
function StatTile({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="w-4 h-4 text-brand-600" aria-hidden="true" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-ink leading-none">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Grafik kolom 7 hari — satu seri, jadi satu warna sekuensial (brand-600,
 * kontras >= 3:1 terhadap permukaan kartu) dan tanpa legenda.
 * Nilai hanya di-label langsung pada bar tertinggi; sisanya lewat hover/fokus
 * plus teks sr-only, supaya angka tidak menumpuk di setiap bar.
 */
function WeeklyChart({ stats }: { stats: DashboardStats }) {
  const { daily, dailyMax } = stats;
  const PLOT_HEIGHT = 132; // px — tinggi area plot saja; label sumbu-x di bawahnya.

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 className="text-sm font-bold text-ink">Pesan pembeli masuk</h3>
        <span className="text-xs text-slate-400">7 hari terakhir</span>
      </figcaption>

      <div className="flex items-end gap-1.5 sm:gap-3" style={{ height: PLOT_HEIGHT }}>
        {daily.map((day) => {
          const ratio = dailyMax > 0 ? day.count / dailyMax : 0;
          const isMax = dailyMax > 0 && day.count === dailyMax;
          // Bar kosong tetap disisakan garis 2px supaya harinya terlihat ada tapi nol.
          const barHeight = day.count === 0 ? 2 : Math.max(4, Math.round(ratio * (PLOT_HEIGHT - 24)));

          return (
            <div
              key={day.key}
              tabIndex={0}
              className="group relative flex-1 flex flex-col justify-end items-center h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              {/* Label langsung hanya pada nilai tertinggi. */}
              {isMax && (
                <span className="mb-1 text-[11px] font-semibold text-ink tabular-nums">{day.count}</span>
              )}

              {/* Tooltip muncul pada hover DAN fokus keyboard. */}
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full mb-1 z-10 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {day.fullLabel}: {day.count} pesan
              </span>

              <div
                aria-hidden="true"
                className={`w-full max-w-[24px] rounded-t-[4px] transition-colors ${
                  day.count === 0 ? "bg-slate-200" : isMax ? "bg-brand-600" : "bg-brand-600/80"
                } group-hover:bg-brand-700`}
                style={{ height: barHeight }}
              />
              <span className="sr-only">
                {day.fullLabel}: {day.count} pesan
              </span>
            </div>
          );
        })}
      </div>

      {/* Baseline: hairline solid satu tingkat dari permukaan — bukan dashed. */}
      <div className="h-px bg-slate-200" />

      <div className="flex gap-1.5 sm:gap-3 pt-2">
        {daily.map((day) => (
          <span key={day.key} className="flex-1 text-center text-[10px] text-slate-400 tabular-nums">
            {day.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Sebaran topik: bar horizontal satu warna, tiap baris sudah di-label langsung. */
function IntentBreakdown({ stats }: { stats: DashboardStats }) {
  const max = stats.intents.reduce((m, i) => Math.max(m, i.count), 0);

  return (
    <div>
      <h3 className="text-sm font-bold text-ink mb-4">Topik percakapan</h3>
      <ul className="space-y-3">
        {stats.intents.map((item) => (
          <li key={item.intent}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-xs font-medium text-slate-600">{intentLabel(item.intent)}</span>
              <span className="text-xs font-semibold text-ink tabular-nums">{item.count}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${max > 0 ? Math.max(4, (item.count / max) * 100) : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-400">
        Dihitung dari topik terakhir tiap percakapan.
      </p>
    </div>
  );
}

/**
 * Percakapan yang menunggu manusia.
 *
 * Ini kartu paling penting di Ringkasan begitu bot berjalan: yang mahal bukan
 * chat yang dibalas bot, tapi chat yang TIDAK dibalas siapa pun. Daftar dibatasi
 * lima baris — kalau lebih dari itu, yang dibutuhkan adalah tab Chat dengan
 * penyaringnya, bukan daftar panjang di halaman ringkasan.
 */
function AttentionPanel({
  stats,
  conversations,
  onGoTo,
  onOpenChat
}: {
  stats: DashboardStats;
  conversations: Conversation[];
  onGoTo: (tab: TabId) => void;
  onOpenChat: (convo: Conversation) => void;
}) {
  // Urutan sengaja: gagal dijawab bot lebih dulu, karena pembeli itu menerima
  // jawaban ngambang — bukan cuma menunggu.
  const queue = conversations
    .filter((c) => c.last_intent === "FALLBACK" || c.ai_paused === true || hasUnread(c))
    .sort((a, b) => {
      const rank = (c: Conversation) => (c.last_intent === "FALLBACK" ? 0 : c.ai_paused ? 1 : 2);
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    })
    .slice(0, 5);

  if (queue.length === 0) return null;

  return (
    <section className="bg-white border border-amber-200 rounded-2xl shadow-card overflow-hidden">
      <div className="px-5 sm:px-6 py-4 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
            <BotOff className="w-4 h-4" aria-hidden="true" />
            Perlu dijawab Anda ({stats.needsAttentionCount})
          </h3>
          <p className="text-[11px] text-amber-800/80 mt-0.5">
            {stats.unansweredCount > 0
              ? `${stats.unansweredCount} percakapan tidak bisa dijawab AI.`
              : "Pembeli menunggu balasan manusia."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onGoTo("chats")}
          className="inline-flex items-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
        >
          Buka tab Chat
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {queue.map((convo) => (
          <li key={convo.customer_phone}>
            <button
              type="button"
              onClick={() => onOpenChat(convo)}
              className="w-full flex items-center gap-3 px-5 sm:px-6 py-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">
                  {conversationLabel(convo)}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {convo.messages?.[convo.messages.length - 1]?.content || "Tidak ada pesan"}
                </p>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                  convo.last_intent === "FALLBACK"
                    ? "bg-rose-50 text-rose-700"
                    : convo.ai_paused
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {convo.last_intent === "FALLBACK"
                  ? "AI gagal jawab"
                  : convo.ai_paused
                    ? "AI dijeda"
                    : "Belum dibaca"}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400 hidden sm:inline">
                {relativeTime(convo.updated_at)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-slate-300" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Panel penjualan — satu-satunya tempat di dashboard yang menjawab "apakah chat
 * ini menghasilkan uang?".
 *
 * Dipisah dari KPI bot di atasnya dengan sengaja: jumlah pesan dan jumlah rupiah
 * adalah dua pertanyaan berbeda, dan menaruhnya dalam satu baris membuat
 * keduanya sama-sama sulit dibaca. Uang MASUK (terbayar) dipisah dari uang yang
 * masih DITAGIH — menjumlahkan keduanya akan melaporkan pendapatan yang belum
 * pernah diterima.
 */
function SalesPanel({ stats, onGoTo }: { stats: DashboardStats; onGoTo: (tab: TabId) => void }) {
  const funnel = [
    { label: "Pembeli chat", value: stats.totalConversations, pct: 100 },
    { label: "Jadi pesanan", value: stats.orderCount, pct: stats.chatToOrderPct },
    {
      label: "Pesanan selesai",
      value: stats.ordersDone,
      pct: stats.totalConversations > 0 ? Math.round((stats.ordersDone / stats.totalConversations) * 100) : 0
    }
  ];

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <Banknote className="w-4 h-4 text-brand-600" aria-hidden="true" />
          Penjualan
        </h3>
        <button
          type="button"
          onClick={() => onGoTo("orders")}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
        >
          Buka pesanan
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-medium">Sudah dibayar</span>
          </div>
          <p className="mt-2 text-xl font-bold text-emerald-900 leading-none">
            {formatRupiah(stats.revenuePaid)}
          </p>
          <p className="mt-1.5 text-[11px] text-emerald-700">
            {formatRupiah(stats.revenueThisMonth)} bulan ini
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <Receipt className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-medium">Menunggu bayar</span>
          </div>
          <p className="mt-2 text-xl font-bold text-amber-900 leading-none">
            {formatRupiah(stats.revenuePending)}
          </p>
          <p className="mt-1.5 text-[11px] text-amber-700">
            {stats.ordersAwaitingPayment} pesanan belum dibayar
          </p>
        </div>
        <StatTile
          icon={Truck}
          label="Siap dikirim"
          value={formatCompact(stats.ordersAwaitingShipment)}
          hint="Sudah dibayar, belum dikirim"
        />
        <StatTile
          icon={TrendingUp}
          label="Rata-rata pesanan"
          value={formatRupiah(stats.averageOrderValue)}
          hint={`${stats.ordersThisMonth} pesanan bulan ini`}
        />
      </div>

      {/* Corong: batangnya relatif terhadap jumlah pembeli yang chat, jadi
          penyusutan di setiap tahap langsung terlihat sebagai panjang bar. */}
      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-3">
          Dari chat sampai selesai
        </h4>
        <ul className="space-y-2.5">
          {funnel.map((step) => (
            <li key={step.label}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs text-slate-600">{step.label}</span>
                <span className="text-xs font-semibold text-ink tabular-nums">
                  {step.value.toLocaleString("id-ID")}
                  <span className="ml-1.5 font-medium text-slate-400">{step.pct}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${Math.max(step.value > 0 ? 4 : 0, step.pct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-400">
          {stats.chatToOrderPct}% pembeli yang chat berakhir jadi pesanan, dan {stats.orderToDonePct}%
          pesanan sudah tuntas.
        </p>
      </div>
    </section>
  );
}

export default function OverviewTab({
  stats,
  conversations,
  whatsappConnected,
  originValid,
  originCityName,
  planName,
  conversationLimit,
  advancedAnalytics,
  onGoTo,
  onOpenChat
}: OverviewTabProps) {
  const steps = [
    {
      done: whatsappConnected,
      title: "Hubungkan WhatsApp toko",
      desc: "Scan QR sekali agar bot bisa menerima & membalas chat pembeli.",
      cta: "Hubungkan",
      tab: "whatsapp" as TabId
    },
    {
      done: originValid,
      title: "Tetapkan lokasi asal pengiriman",
      desc: originValid
        ? `Ongkir dihitung dari ${originCityName}.`
        : "Wajib dipilih dari hasil pencarian, kalau tidak ongkir masih simulasi.",
      cta: "Atur lokasi",
      tab: "store" as TabId
    },
    {
      done: stats.productCount > 0,
      title: "Isi katalog produk",
      desc: "AI memakai nama, harga, dan berat produk untuk menjawab pembeli.",
      cta: "Tambah produk",
      tab: "products" as TabId
    }
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const recent = conversations.slice(0, 5);
  const hasActivity = stats.totalConversations > 0;

  return (
    <div className="space-y-6">
      {/* ── Checklist aktivasi ─────────────────────────────────────────── */}
      <section
        className={`rounded-2xl border shadow-card overflow-hidden ${
          allDone ? "bg-brand-50 border-brand-200" : "bg-white border-slate-200"
        }`}
      >
        <div className="p-5 sm:p-6">
          {allDone ? (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-full bg-brand-100 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-brand-700" />
              </div>
              <div>
                <h2 className="text-base font-bold text-brand-900">Bot Anda siap melayani pembeli</h2>
                <p className="text-sm text-brand-800/80 mt-0.5">
                  WhatsApp terhubung, lokasi ongkir valid, dan katalog sudah terisi. Setiap chat masuk
                  akan dibalas otomatis oleh AI.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h2 className="text-base font-bold text-ink">Selesaikan penyiapan bot</h2>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {doneCount} dari {steps.length} selesai
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-5">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all duration-500"
                  style={{ width: `${(doneCount / steps.length) * 100}%` }}
                />
              </div>

              <ol className="space-y-2.5">
                {steps.map((step) => (
                  <li
                    key={step.title}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border ${
                      step.done ? "border-brand-200 bg-brand-50/60" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    {step.done ? (
                      <CheckCircle2 className="w-5 h-5 shrink-0 text-brand-600 mt-0.5" aria-hidden="true" />
                    ) : (
                      <Circle className="w-5 h-5 shrink-0 text-slate-300 mt-0.5" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold ${
                          step.done ? "text-brand-900" : "text-ink"
                        }`}
                      >
                        {step.title}
                        <span className="sr-only">{step.done ? " — selesai" : " — belum selesai"}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{step.desc}</p>
                    </div>
                    {!step.done && (
                      <button
                        type="button"
                        onClick={() => onGoTo(step.tab)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        {step.cta}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>

      {/* ── Peringatan berat produk ────────────────────────────────────── */}
      {stats.productsMissingWeight > 0 && (
        <div className="flex items-start gap-2.5 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-amber-900 leading-relaxed">
            <strong>{stats.productsMissingWeight} produk</strong> belum punya berat yang wajar, sehingga
            ongkirnya bisa salah hitung.{" "}
            <button
              type="button"
              onClick={() => onGoTo("products")}
              className="font-semibold underline hover:no-underline"
            >
              Perbaiki di katalog produk
            </button>
          </p>
        </div>
      )}

      {/* ── Peringatan stok habis ──────────────────────────────────────── */}
      {stats.productsOutOfStock > 0 && (
        <div className="flex items-start gap-2.5 p-4 bg-rose-50 border border-rose-200 rounded-2xl">
          <PackageX className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-rose-900 leading-relaxed">
            <strong>{stats.productsOutOfStock} produk</strong> stoknya habis. AI akan menolak pesanan
            untuk produk itu dan menawarkan alternatif.{" "}
            <button
              type="button"
              onClick={() => onGoTo("products")}
              className="font-semibold underline hover:no-underline"
            >
              Perbarui stok
            </button>
          </p>
        </div>
      )}

      {/* ── Percakapan yang menunggu manusia ───────────────────────────── */}
      <AttentionPanel
        stats={stats}
        conversations={conversations}
        onGoTo={onGoTo}
        onOpenChat={onOpenChat}
      />

      {/* ── KPI row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          icon={Users}
          label="Percakapan"
          value={formatCompact(stats.totalConversations)}
          hint={`${stats.activeConversations7d} aktif dalam 7 hari`}
        />
        <StatTile
          icon={Inbox}
          label="Pesan pembeli"
          value={formatCompact(stats.incomingMessages)}
          hint={`${stats.incoming24h} dalam 24 jam terakhir`}
        />
        <StatTile
          icon={Send}
          label="Balasan AI"
          value={formatCompact(stats.aiReplies)}
          hint="Terkirim otomatis tanpa admin"
        />
        <StatTile
          icon={Package}
          label="Produk aktif"
          value={formatCompact(stats.productCount)}
          hint="Dipakai AI untuk menjawab"
        />
      </div>

      {/* ── Kuota percakapan bulanan (hanya paket berbatas) ────────────── */}
      {conversationLimit !== null && (
        <QuotaMeter
          used={stats.conversationsThisMonth}
          limit={conversationLimit}
          planName={planName}
        />
      )}

      {/* ── Penjualan ──────────────────────────────────────────────────── */}
      {/* Ditampilkan begitu ada pembeli yang chat, bukan hanya setelah ada
          pesanan: toko dengan 50 chat dan 0 pesanan justru paling perlu
          melihat angka itu. */}
      {hasActivity && <SalesPanel stats={stats} onGoTo={onGoTo} />}

      {/* ── Grafik & topik ─────────────────────────────────────────────── */}
      {!hasActivity ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
          <MessageSquare className="w-9 h-9 mx-auto text-slate-300 mb-3" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">Belum ada percakapan</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Statistik dan grafik aktivitas akan muncul di sini begitu pembeli pertama mengirim chat ke
            WhatsApp toko Anda.
          </p>
          <button
            type="button"
            onClick={() => onGoTo("whatsapp")}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            Coba kirim chat uji coba
          </button>
        </div>
      ) : advancedAnalytics ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6">
            <WeeklyChart stats={stats} />
          </div>
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6">
            {stats.intents.length > 0 ? (
              <IntentBreakdown stats={stats} />
            ) : (
              <div className="h-full flex items-center justify-center text-center text-xs text-slate-400">
                Topik percakapan akan muncul setelah bot membalas pesan pertama.
              </div>
            )}
          </div>
        </div>
      ) : (
        <AnalyticsLocked />
      )}

      {/* ── Percakapan terbaru (+ tujuan ongkir untuk paket Pro) ───────── */}
      {hasActivity && (
        <div className={`grid grid-cols-1 gap-6 ${advancedAnalytics ? "lg:grid-cols-2" : ""}`}>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6">
            <h3 className="text-sm font-bold text-ink mb-4">Percakapan terbaru</h3>
            <ul className="divide-y divide-slate-100 -my-1">
              {recent.map((convo) => (
                <li key={convo.customer_phone}>
                  <button
                    type="button"
                    onClick={() => onOpenChat(convo)}
                    className="w-full flex items-center gap-3 py-2.5 text-left rounded-lg hover:bg-slate-50 px-2 -mx-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">
                        {conversationLabel(convo)}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {convo.messages?.[convo.messages.length - 1]?.content || "Tidak ada pesan"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {relativeTime(convo.updated_at)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {advancedAnalytics && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6">
              <h3 className="text-sm font-bold text-ink mb-4">Tujuan ongkir terpopuler</h3>
              {stats.topDestinations.length > 0 ? (
                <ul className="space-y-2.5">
                  {stats.topDestinations.map((dest) => (
                    <li key={dest.city} className="flex items-center gap-2.5">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                      <span className="flex-1 text-sm text-slate-700 truncate">{dest.city}</span>
                      <span className="text-xs font-semibold text-ink tabular-nums">{dest.count}×</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  Belum ada pembeli yang menanyakan ongkir ke kota tertentu.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
