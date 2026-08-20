"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Home, MapPin, MessageSquare, Search, User } from "lucide-react";
import {
  clockTime,
  conversationLabel,
  dayLabel,
  formatPhoneDisplay,
  intentLabel,
  relativeTime,
  type Conversation
} from "./types";

interface ChatsTabProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

/** Tanggal berubah dibanding pesan sebelumnya → tampilkan pemisah hari. */
function isNewDay(prevIso?: string, currIso?: string): boolean {
  if (!currIso) return false;
  if (!prevIso) return true;
  const a = new Date(prevIso);
  const b = new Date(currIso);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
}

export default function ChatsTab({ conversations, selectedPhone, onSelect }: ChatsTabProps) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.customer_phone === selectedPhone) || null,
    [conversations, selectedPhone]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      if (c.customer_phone.toLowerCase().includes(q)) return true;
      if ((c.customer_name || "").toLowerCase().includes(q)) return true;
      if ((c.destination_city || "").toLowerCase().includes(q)) return true;
      if ((c.customer_address || "").toLowerCase().includes(q)) return true;
      return (c.messages || []).some((m) => (m.content || "").toLowerCase().includes(q));
    });
  }, [conversations, query]);

  const messageCount = selected?.messages?.length ?? 0;

  // Gulir ke pesan terbaru saat percakapan dibuka / ada pesan baru.
  // Sebelumnya thread selalu berhenti di pesan paling ATAS, jadi balasan
  // terakhir AI tidak terlihat tanpa scroll manual.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [selectedPhone, messageCount]);

  if (conversations.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Riwayat percakapan AI
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pantau pesan pembeli dan balasan otomatis AI CS.
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

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-brand-600" aria-hidden="true" />
          Riwayat percakapan AI
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Pantau pesan pembeli dan balasan otomatis AI CS. Data disegarkan berkala.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:min-h-[460px]">
        {/* ── Daftar percakapan ──────────────────────────────────────── */}
        <div
          className={`md:col-span-1 flex flex-col gap-2.5 ${selected ? "hidden md:flex" : "flex"}`}
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

          {filtered.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Tidak ada percakapan yang cocok.
            </p>
          ) : (
            <ul className="border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden overflow-y-auto md:max-h-[420px]">
              {filtered.map((c) => {
                const isActive = c.customer_phone === selectedPhone;
                const last = c.messages?.[c.messages.length - 1];
                return (
                  <li key={c.customer_phone}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.customer_phone)}
                      aria-current={isActive ? "true" : undefined}
                      className={`w-full text-left p-3.5 transition-colors ${
                        isActive
                          ? "bg-brand-50 border-l-4 border-brand-600"
                          : "bg-white hover:bg-slate-50 border-l-4 border-transparent"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-sm text-ink truncate">
                          {conversationLabel(c)}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {relativeTime(c.updated_at || last?.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {last?.role === "assistant" && (
                          <span className="text-slate-500 font-medium">AI: </span>
                        )}
                        {last?.content || "Tidak ada pesan"}
                      </p>
                      {c.last_intent && (
                        <span className="inline-block mt-2 text-[10px] bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full font-semibold">
                          {intentLabel(c.last_intent)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Thread ─────────────────────────────────────────────────── */}
        <div
          className={`md:col-span-2 border border-slate-200 rounded-2xl bg-slate-50 flex flex-col overflow-hidden ${
            selected ? "flex" : "hidden md:flex"
          }`}
        >
          {selected ? (
            <>
              <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-start gap-3">
                {/* Di mobile daftar & thread saling menggantikan — sediakan jalan kembali. */}
                <button
                  type="button"
                  onClick={() => onSelect("")}
                  className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-ink rounded-lg"
                  aria-label="Kembali ke daftar percakapan"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-ink truncate">
                    {conversationLabel(selected)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-[11px] text-slate-400">
                      {formatPhoneDisplay(selected.customer_phone)} · {messageCount} pesan ·{" "}
                      {relativeTime(selected.updated_at)}
                    </span>
                    {selected.destination_city && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {selected.destination_city}
                      </span>
                    )}
                  </div>
                  {/* Alamat yang sudah direkam bot ditampilkan penuh: ini data yang
                      dipakai mengirim barang, jadi pemilik toko harus bisa
                      membacanya tanpa menelusuri isi chat. */}
                  {selected.customer_address && (
                    <p className="flex items-start gap-1 text-[11px] text-slate-500 mt-1">
                      <Home className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="break-words">{selected.customer_address}</span>
                    </p>
                  )}
                </div>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]"
              >
                {selected.messages.map((m, idx) => {
                  const prev = selected.messages[idx - 1];
                  const showDay = isNewDay(prev?.timestamp, m.timestamp);
                  const mine = m.role === "assistant";

                  return (
                    <div key={idx}>
                      {showDay && m.timestamp && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] font-medium text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">
                            {dayLabel(m.timestamp)}
                          </span>
                        </div>
                      )}

                      <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                        <div
                          className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                            mine
                              ? "bg-brand-600 text-white rounded-tr-none shadow-card"
                              : "bg-white border border-slate-200 text-ink rounded-tl-none"
                          }`}
                        >
                          <span
                            className={`flex items-center gap-1 font-bold text-[10px] mb-1 ${
                              mine ? "text-brand-100" : "text-slate-400"
                            }`}
                          >
                            {mine ? (
                              <Bot className="w-3 h-3" aria-hidden="true" />
                            ) : (
                              <User className="w-3 h-3" aria-hidden="true" />
                            )}
                            {mine ? "AI CS" : "Pembeli"}
                          </span>
                          {m.content}
                        </div>
                        {/* Stempel waktu tersimpan di DB tapi dulu tidak pernah ditampilkan. */}
                        {m.timestamp && (
                          <span className="text-[10px] text-slate-400 mt-1 px-1">
                            {clockTime(m.timestamp)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-8 text-center">
              Pilih percakapan di sebelah kiri untuk melihat isinya.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
