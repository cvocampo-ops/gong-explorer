"use client";

import { use } from "react";
import { CallDetail } from "@/components/call-detail";

export default function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CallDetail callId={id} />;
}
