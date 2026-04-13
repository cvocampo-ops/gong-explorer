"use client";

import { useCredentials } from "@/components/credential-provider";
import { CredentialForm } from "@/components/credential-form";
import { CallList } from "@/components/call-list";

export default function Home() {
  const { isConfigured } = useCredentials();

  return isConfigured ? <CallList /> : <CredentialForm />;
}
