"use client";

import { useCredentials } from "@/components/credential-provider";
import type { ExportOptions, ExportFilter, ExportRequestPayload } from "@/lib/types";

export function useExport() {
  const { credentials } = useCredentials();

  function submitExport(args: {
    callIds?: string[];
    filter?: ExportFilter;
    options: ExportOptions;
  }): { error?: string } {
    if (!credentials) return { error: "Not connected" };

    const payload: ExportRequestPayload = {
      credentials,
      callIds: args.callIds,
      filter: args.filter,
      options: args.options,
    };

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/export";
    form.target = "_self";
    form.enctype = "application/x-www-form-urlencoded";

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    return {};
  }

  return { submitExport };
}
