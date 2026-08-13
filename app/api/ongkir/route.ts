import { NextResponse } from "next/server";
import { searchMengantarLocation, calculateMengantarOngkir } from "@/lib/mengantar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint internal Cek Ongkir Mengantar API
 * GET /api/ongkir?type=search&q=Bandung
 * POST /api/ongkir { originId, destinationId, weightGram }
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const apiKey = searchParams.get("apiKey") || undefined;

  if (!q.trim()) {
    return NextResponse.json({ locations: [] });
  }

  try {
    const locations = await searchMengantarLocation(q, apiKey);
    return NextResponse.json({ locations });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { originId = "3171010", destinationId = "3273010", weightGram = 1000, apiKey } = body;

    const rates = await calculateMengantarOngkir({
      originSubdistrictId: String(originId),
      destinationSubdistrictId: String(destinationId),
      weightGram: Number(weightGram) || 1000,
      apiKey: apiKey ? String(apiKey) : undefined
    });

    return NextResponse.json({ rates });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
