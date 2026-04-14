export function assertPublicHttpsUrl(rawUrl: string): URL | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "Invalid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { error: "Only HTTPS URLs are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isPrivate =
    hostname === "localhost" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".local") ||
    hostname.startsWith("0.");
  if (isPrivate) {
    return { error: "Internal URLs are not allowed" };
  }

  return parsed;
}
