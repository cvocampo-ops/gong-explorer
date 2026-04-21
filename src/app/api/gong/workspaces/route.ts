import { NextRequest } from "next/server";
import { fetchWorkspaces } from "@/lib/gong-client";
import type { GongCredentials } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    credentials?: { provider?: string } & GongCredentials;
  };

  if (
    !body.credentials?.accessKey ||
    !body.credentials?.accessKeySecret ||
    !body.credentials?.baseUrl
  ) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const creds: GongCredentials = {
    accessKey: body.credentials.accessKey,
    accessKeySecret: body.credentials.accessKeySecret,
    baseUrl: body.credentials.baseUrl,
  };

  const result = await fetchWorkspaces(creds);

  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json(result.data);
}
