/**
 * Worker HTTP : traite les analyses en attente (pending).
 * Utilisé pour retry manuel ou cron. En temps normal, after() appelle processAnalysisInBackground directement.
 */
import { NextRequest, NextResponse } from "next/server";
import { processAnalysisInBackground } from "@/lib/analyze-process";

const SECRET = process.env.ANALYZE_PROCESS_SECRET;

export async function POST(request: NextRequest) {
  if (!SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("x-internal-secret");
  if (authHeader !== SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { analysisId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { analysisId } = body;
  if (!analysisId) {
    return NextResponse.json({ error: "analysisId required" }, { status: 400 });
  }

  await processAnalysisInBackground(analysisId);
  return NextResponse.json({ success: true });
}
