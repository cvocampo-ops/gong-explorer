import { NextRequest } from "next/server";
import { fetchCallById } from "@/lib/gong-client";
import type { GongCredentials } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as { credentials?: GongCredentials };

  if (!body.credentials?.accessKey || !body.credentials?.accessKeySecret || !body.credentials?.baseUrl) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const result = await fetchCallById(body.credentials, id);

  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  const call = result.data?.calls?.[0];
  if (!call) {
    return Response.json({ error: "Call not found" }, { status: 404 });
  }

  return Response.json(call);
}
