# Gong Explorer

> A sleek, modern web app for browsing and downloading your Gong call recordings.

**A joint project by [The Kiln](https://thekiln.com) and [2x](https://2x.com)**

---

## What is Gong Explorer?

Gong Explorer is a lightweight, self-hosted tool that connects directly to the [Gong.io](https://www.gong.io/) API and gives your team an intuitive interface for accessing call data. Whether you're a sales leader reviewing pipeline calls, a revenue ops analyst pulling recordings for training, or a customer success manager revisiting a key conversation -- Gong Explorer puts everything at your fingertips.

No complex setup. No database. Just connect your Gong API credentials and start exploring.

## Features

### Call Library
Browse your entire Gong call history with date range filtering and infinite scroll pagination. Each call shows the title, date, duration, conferencing system, call direction, and participant count at a glance.

### Call Details
Dive into any call to see the full picture:
- **Participants** -- See who was on the call, grouped by internal team members and external contacts, with names, titles, and email addresses
- **AI Summary** -- Gong's AI-generated brief of the conversation
- **Highlights & Next Steps** -- Key moments and action items extracted by Gong AI
- **Topics Discussed** -- Auto-detected conversation topics with time spent on each
- **Call Outcome** -- AI-classified result of the call

### Media Downloads
Download call recordings directly from the app:
- **Audio** (MP3) -- Available for all recorded calls
- **Video** (MP4) -- Available for video calls with camera or screen share

Downloads are streamed through the server, so large files won't eat up your browser's memory.

### Secure by Design
- Credentials are stored only in your browser's session storage and cleared when you close the tab
- All API calls are proxied through server-side routes -- your Gong credentials never leave the server
- Media download URLs (which are temporary signed URLs) are never exposed to the browser
- No database, no cookies, no server-side credential storage
- SSRF protection on the media proxy blocks internal network access

### Rate Limit Awareness
The app displays your remaining Gong API quota in real time, so you always know where you stand against the 10,000 calls/day limit.

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- A **Gong API Access Key** and **Access Key Secret** (requires Technical Administrator role in Gong)
- The `api:calls:read:media-url` OAuth scope enabled for video/audio downloads

### Installation

```bash
git clone https://github.com/cvocampo-ops/gong-explorer.git
cd gong-explorer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter your Gong API credentials.

Find your credentials at **Company Settings > Ecosystem > API** in the Gong admin panel.

### Deploy to Vercel

This app is Vercel-ready out of the box:

```bash
npm i -g vercel
vercel
```

Or connect the GitHub repo directly in the [Vercel dashboard](https://vercel.com/new).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui |
| Typography | Space Grotesk + JetBrains Mono |
| Icons | Lucide React |

## How It Works

```
Browser                         Next.js Server                 Gong API
------                         --------------                 --------

[Credential Form]
       |
       v
[Session Storage] -- creds --> [API Route Handler]
       |              in body   /api/gong/calls
       |                             |
       |                     [gong-client.ts]
       |                     Basic Auth header
       |                             |
       |                             v
       |                     POST /v2/calls/extensive
       |                             |
       <-------- JSON ---------------+
       |
       v
[Call List] --> click --> [Call Detail]
                              |
                        [Download btn]
                              |
                              v
                     POST /api/gong/media
                              |
                     Stream signed URL
                              |
                        [File saved]
```

## About

### The Kiln

The Kiln is a technology studio building tools and platforms that help teams work smarter. We specialize in developer tools, AI integrations, and revenue operations infrastructure.

### 2x

2x helps companies scale their go-to-market operations through offshore talent and technology solutions. Together with The Kiln, we build internal tools that supercharge sales and revenue teams.

---

Built with care by The Kiln and 2x.
