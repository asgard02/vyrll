import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    return NextResponse.json({ database: null, error: "Supabase non configuré" });
  }
  const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
  return NextResponse.json({
    database: url,
    projectRef,
    host: new URL(url).host,
  });
}
