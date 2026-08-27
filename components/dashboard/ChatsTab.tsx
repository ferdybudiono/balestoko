"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Home,
  MapPin,
  MessageSquare,
  Pause,
  Play,
  Search,
  Send,
  Store,
  TriangleAlert,
  User
} from "lucide-react";
import {
  clockTime,
  conversationLabel,
  dayLabel,
  formatPhoneDisplay,
  hasUnread,
  intentLabel,
  needsAttention,
  relativeTime,
  type Conversation
} from "./types";

interface ChatsTabProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
  /** Kirim balasan manual. `true` = terkirim, jadi kotak tulis boleh dikosongkan. */
  onSendReply: (phone: string, message: string) => Promise<boolean>;
  onToggleAiPause: (phone: string, paused: boolean) => void;
  onMarkSeen: (phone: string) => void;
  sending?: boolean;
  pausingPhone?: string | null;
  /** `false` = masa aktif toko habis; server pasti menolak pengiriman. */
  canSend?: boolean;
}

type Filter = "all" | "attention" | "unread";

/**
 * Batas pesan yang disimpan per percakapan — cerminan `MAX_STORED_MESSAGES` di
 * `lib/supabase.ts`. Dipakai hanya untuk memberi tahu bahwa riwayat lama sudah
 * terpotong; tanpa pemberitahuan itu, chat panjang tampak seolah dimulai di
 * tengah-tengah dan pemilik toko mencari-cari pesan awal yang tidak ada lagi.
 */
const MAX_STORED_MESSAGES = 200;

/** Tanggal berubah dibanding pesan sebelumnya → tampilkan pemisah hari. */
function isNewDay(prevIso?: string, currIso?: string): boolean {
  if (!currIso) return false;
  if (!prevIso) return true;
  const a = new Date(prevIso);
  const b = new Date(currIso);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
}

export default function ChatsTab({
  conversations,
  selectedPhone,
  onSelect,
  onSendReply,
  onToggleAiPause,
  onMarkSeen,
  sending = false,
  pausingPhone = null,
  canSend = true
}: ChatsTabProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.customer_phone === selectedPhone) || null,
    [conversations, selectedPhone]
  );

  const counts = useMemo(
    () => ({
      all: conversations.length,
      attention: conversations.filter(needsAttention).length,
      unread: conversations.filter(hasUnread).length
    }),
    [conversations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "attention" && !needsAttention(c)) return false;
      if (filter === "unread" && !hasUnread(c)) return false;
      if (!q) return true;
      if (c.customer_phone.toLowerCase().includes(q)) return true;
      if ((c.customer_name || "").toLowerCase().includes(q)) return true;
      if ((c.destination_city || "").toLowerCase().includes(q)) return true;
      if ((c.customer_address || "").toLowerCase().includes(q)) return true;
      return (c.messages || []).some((m) => (m.content || "").toLowerCase().includes(q));
    });
  }, [conversations, filter, query]);

  const messageCount = selected?.messages?.length ?? 0;
  const aiPaused = selected?.ai_paused === true;
  const pausing = !!selected && pausingPhone === selected.customer_phone;

  // Gulir ke pesan terbaru saat percakapan dibuka / ada pesan baru.
  // Sebelumnya thread selalu berhenti di pesan paling ATAS, jadi balasan
  // terakhir AI tidak terlihat tanpa scroll manual.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [selectedPhone, messageCount]);

  // Ganti percakapan = kotak tulis dikosongkan. Mengirim draf yang ditulis untuk
  // pembeli lain adalah kesalahan yang tidak bisa ditarik kembali.
  useEffect(() => {
    setDraft("");
  }, [selectedPhone]);

  // Membuka percakapan berarti membacanya. Dikirim sekali per pembukaan, dan hanya
  // bila memang masih ada yang belum dibaca — supaya tab ini tidak menembak PATCH
  // setiap kali polling menyegarkan daftar.
  const seenSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPhone) {
      seenSentRef.current = null;
      return;
    }
    if (seenSentRef.current === selectedPhone) return;
    const conv = conversations.find((c) => c.customer_phone === selectedPhone);
    if (!conv) return;
    seenSentRef.current = selectedPhone;
    if (hasUnread(conv)) onMarkSeen(selectedPhone);
  }, [selectedPhone, conversations, onMarkSeen]);

  async function submitReply() {
    if (!selected || !draft.trim() || sending) return;
    const ok = await onSendReply(selected.customer_phone, draft);
    if (ok) setDraft("");
  }

  if (conversations.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Riwayat percakapan AI
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pantau pesan pembeli, balas sendiri kapan pun, dan jeda AI saat Anda mengambil alih.
          </p>
        </div>
        <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-2xl space-y-2">
          <MessageSquare className="w-10 h-10 mx-auto text-slate-300" aria-hidden="true" />
          <p className="text-sm text-slate-500">Belum ada percakapan masuk</p>
          <p className="text-xs text-slate-400">
            Gunakan <strong>Uji coba balasan AI</strong> di tab Hubungkan WhatsApp untuk mengetes.
          </p>
        </div>
      </section>
    );
  }

  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: "all", label: "Semua" },
    { id: "attention", label: "Perlu dijawab" },
    { id: "unread", label: "Belum dibaca" }
  ];

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-brand-600" aria-hidden="true" />
          Riwayat percakapan AI
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Pantau pesan pembeli, balas sendiri kapan pun, dan jeda AI saat Anda mengambil alih.
        </p>
      </div>

      {/*
        Tinggi mengikuti layar, bukan angka tetap: 420px membuat kotak tulis
        terdorong keluar pandangan di laptop kecil, dan menyisakan ruang kosong
        besar di monitor lebar.
      */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:h-[min(70vh,620px)] md:min-h-[420px]">
        {/* ── Daftar percakapan ──────────────────────────────────────── */}
        <div
          className={`md:col-span-1 flex flex-col gap-2.5 min-h-0 ${
            selected ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Cari percakapan"
              placeholder="Cari nama, kota, nomor, isi pesan…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          {/* Penyaring "perlu dijawab" adalah alasan utama tab ini dibuka: dari
              50 percakapan, yang menunggu manusia biasanya cuma dua-tiga. */}
          <div
            role="tablist"
            aria-label="Saring percakapan"
            className="flex gap-1 bg-slate-100 p-1 rounded-xl"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
                  filter === f.id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"
                }`}
              >
                {f.label} ({counts[f.id]})
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-0.5 max-h-[52vh] md:max-h-none">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">
                Tidak ada percakapan yang cocok.
              </p>
            )}
            {filtered.map((c) => {
              const active = c.customer_phone === selectedPhone;
              const unread = hasUnread(c);
              const attention = needsAttention(c);
              const paused = c.ai_paused === true;
              const last = (c.messages || [])[Math.max(0, (c.messages || []).length - 1)];
              return (
                <button
                  key={c.customer_phone}
                  type="button"
                  onClick={() => onSelect(c.customer_phone)}
                  aria-current={active ? "true" : undefined}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    active
                      ? "bg-brand-50 border-brand-300"
                      : attention
                        ? "bg-white border-amber-200 hover:border-amber-300"
                        : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm truncate ${
                        unread ? "font-bold text-ink" : "font-semibold text-ink"
                      }`}
                    >
                      {conversationLabel(c)}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {unread && (
                        <span
                          className="w-2 h-2 rounded-full bg-brand-600"
                          title="Belum dibaca"
                          aria-label="Belum dibaca"
                        />
                      )}
                      <span className="text-[10px] text-slate-400">
                        {relativeTime(last?.timestamp || c.updated_at)}
                      </span>
                    </div>
                  </div>
                  {last?.content && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {last.role === "assistant" ? "↩ " : ""}
                      {last.content}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                      {intentLabel(c.last_intent)}
                    </span>
                    {c.last_intent === "FALLBACK" && (
                      <span className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-semibold">
                        AI gagal jawab
                      </span>
                    )}
                    {paused && (
                      <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-semibold">
                        AI dijeda
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Thread percakapan ──────────────────────────────────────── */}
        <div
          className={`md:col-span-2 min-h-0 flex-col ${selected ? "flex" : "hidden md:flex"}`}
        >
          {!selected ? (
            <div className="h-full min-h-[220px] flex items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl">
              <p className="text-sm text-slate-400">Pilih percakapan untuk melihat isinya</p>
            </div>
          ) : (
            <div className="h-full flex flex-col min-h-0 border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-start gap-2">
                {/* Di ponsel daftar & thread saling menimpa, jadi harus ada jalan pulang. */}
                <button
                  type="button"
                  onClick={() => onSelect("")}
                  aria-label="Kembali ke daftar percakapan"
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-200 shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink truncate">
                    {conversationLabel(selected)}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {formatPhoneDisplay(selected.customer_phone)}
                  </p>
                  {selected.customer_address && (
                    <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1">
                      <Home className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="line-clamp-2">{selected.customer_address}</span>
                    </p>
                  )}
                  {!selected.customer_address && selected.destination_city && (
                    <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {selected.destination_city}
                    </p>
                  )}
                </div>
                {/*
                  Jeda AI ada di kepala thread, bukan di daftar: keputusan
                  "saya ambil alih" selalu diambil setelah membaca isi chat.
                */}
                <button
                  type="button"
                  onClick={() => onToggleAiPause(selected.customer_phone, !aiPaused)}
                  disabled={pausing}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-60 ${
                    aiPaused
                      ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                      : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                  }`}
                  title={
                    aiPaused
                      ? "Nyalakan lagi balasan otomatis untuk pembeli ini"
                      : "Bungkam AI untuk pembeli ini — Anda yang menjawab"
                  }
                >
                  {aiPaused ? (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {pausing ? "Menyimpan…" : aiPaused ? "Aktifkan AI" : "Jeda AI"}
                </button>
              </div>

              {aiPaused && (
                <p className="px-3 sm:px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex items-start gap-1.5">
                  <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                  <span>
                    AI dijeda untuk pembeli ini. Pesan masuk <strong>tidak dibalas otomatis</strong>{" "}
                    sampai Anda mengaktifkannya kembali.
                  </span>
                </p>
              )}

              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
                {/*
                  Riwayat dipangkas di server (200 pesan terakhir). Tanpa catatan
                  ini, chat panjang tampak seolah dimulai di tengah pembicaraan.
                */}
                {messageCount >= MAX_STORED_MESSAGES && (
                  <p className="text-[11px] text-slate-400 text-center bg-slate-50 border border-slate-200 rounded-lg py-2 px-3">
                    Hanya {MAX_STORED_MESSAGES} pesan terakhir yang disimpan. Pesan yang lebih lama
                    sudah tidak tersedia.
                  </p>
                )}

                {(selected.messages || []).map((m, i) => {
                  const prev = (selected.messages || [])[i - 1];
                  const fromCustomer = m.role === "user";
                  const byOwner = !fromCustomer && m.manual === true;
                  return (
                    <div key={`${m.timestamp || "t"}-${i}`}>
                      {isNewDay(prev?.timestamp, m.timestamp) && (
                        <p className="text-[10px] font-semibold text-slate-400 text-center my-3">
                          {dayLabel(m.timestamp)}
                        </p>
                      )}
                      <div className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}>
                        <div className="max-w-[85%] sm:max-w-[75%]">
                          <div
                            className={`flex items-center gap-1 mb-1 text-[10px] font-semibold ${
                              fromCustomer ? "text-slate-500" : "justify-end text-slate-500"
                            }`}
                          >
                            {fromCustomer ? (
                              <>
                                <User className="w-3 h-3" aria-hidden="true" />
                                Pembeli
                              </>
                            ) : byOwner ? (
                              <>
                                <Store className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                                Anda
                              </>
                            ) : (
                              <>
                                <Bot className="w-3 h-3 text-brand-600" aria-hidden="true" />
                                AI CS
                              </>
                            )}
                          </div>
                          <div
                            className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                              fromCustomer
                                ? "bg-slate-100 text-ink rounded-tl-sm"
                                : byOwner
                                  ? "bg-emerald-600 text-white rounded-tr-sm"
                                  : "bg-brand-600 text-white rounded-tr-sm"
                            }`}
                          >
                            {m.content}
                          </div>
                          {m.timestamp && (
                            <p
                              className={`text-[10px] text-slate-400 mt-1 ${
                                fromCustomer ? "" : "text-right"
                              }`}
                            >
                              {clockTime(m.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Kotak tulis ─────────────────────────────────────── */}
              <div className="border-t border-slate-200 bg-white p-2.5 sm:p-3 space-y-2">
                {!canSend && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                    <span>
                      Masa aktif toko sudah habis, jadi pesan tidak bisa dikirim. Perpanjang
                      langganan untuk membalas dari sini.
                    </span>
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter mengirim, Shift+Enter ganti baris — kebiasaan dari
                      // WhatsApp itu sendiri, supaya tidak perlu dipelajari ulang.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void submitReply();
                      }
                    }}
                    rows={2}
                    disabled={!canSend || sending}
                    aria-label="Tulis balasan"
                    placeholder={
                      canSend ? "Tulis balasan Anda… (Enter kirim, Shift+Enter baris baru)" : "Tidak bisa mengirim"
                    }
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 resize-none focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void submitReply()}
                    disabled={!canSend || sending || !draft.trim()}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    {sending ? "Mengirim…" : "Kirim"}
                  </button>
                </div>
                {/* Konsekuensi kirim manual disebut lebih dulu, bukan disesali sesudahnya. */}
                {!aiPaused && canSend && (
                  <p className="text-[11px] text-slate-400">
                    Mengirim balasan sendiri otomatis menjeda AI untuk pembeli ini.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
