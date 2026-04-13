# Contributing to Gong Explorer

**A joint project by The Kiln and 2x**

Thank you for your interest in contributing to Gong Explorer! This document outlines how to get involved.

## Project Background

Gong Explorer was created as a collaboration between **The Kiln** and **2x** to give revenue teams a fast, secure way to browse and download Gong call recordings without navigating the full Gong platform. It's designed to be simple, self-hosted, and developer-friendly.

## Development Setup

1. Clone the repository
2. Run `npm install`
3. Run `npm run dev`
4. Open `http://localhost:3000`

You'll need a Gong API Access Key and Secret to test against live data.

## Architecture

- **`src/lib/gong-client.ts`** -- Server-only Gong API client. All Gong communication goes through here.
- **`src/lib/types.ts`** -- TypeScript interfaces matching the Gong API response shapes.
- **`src/app/api/gong/`** -- Next.js Route Handlers that proxy requests to Gong. Credentials are passed per-request in the POST body, never stored server-side.
- **`src/components/`** -- React client components for the UI.
- **`src/hooks/use-gong-api.ts`** -- Client-side hook that calls our proxy routes.

## Guidelines

- Keep it simple. This is a lightweight tool, not a platform.
- No database. Everything is fetched on-demand from the Gong API.
- Credentials must never be stored server-side or logged.
- All media downloads must be streamed (never buffered in memory).
- Follow the existing Gen Z design language -- dark mode, glassmorphism, vibrant gradients.

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Your Node.js version and browser

## License

See [LICENSE](LICENSE) for details.
