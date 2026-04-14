import { slugify } from "./account";

export function buildCallFolderName(args: {
  startedAt: string;
  account: string;
  title: string;
}): string {
  const datePart = args.startedAt.slice(0, 10); // YYYY-MM-DD from ISO
  const accountSlug = slugify(args.account);
  const titleSlug = slugify(args.title || "untitled");
  return `${datePart}_${accountSlug}_${titleSlug}`;
}
