import { NextRequest } from "next/server";
import { fetchConversationById, fetchConversationRecordingUrl } from "@/lib/salesloft-client";
import type { SalesLoftCredentials } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    credentials?: { provider?: string } & SalesLoftCredentials;
  };

  if (!body.credentials?.apiKey) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const creds = { apiKey: body.credentials.apiKey };
  const result = await fetchConversationById(creds, id);

  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "Not found" }, { status: 502 });
  }

  // If the detail payload didn't include a recording URL, try the dedicated endpoint.
  let call = result.data;
  if (!call.audioUrl) {
    const recording = await fetchConversationRecordingUrl(creds, id);
    if (recording.data?.url) {
      call = { ...call, audioUrl: recording.data.url };
    }
  }

  return Response.json(call);
}
