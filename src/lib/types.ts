export type Provider = "gong" | "salesloft";

export interface GongCredentials {
  accessKey: string;
  accessKeySecret: string;
  baseUrl: string;
}

export interface SalesLoftCredentials {
  apiKey: string;
}

export type Credentials =
  | ({ provider: "gong" } & GongCredentials)
  | ({ provider: "salesloft" } & SalesLoftCredentials);

export interface GongParty {
  emailAddress?: string;
  name?: string;
  title?: string;
  userId?: string;
  speakerId?: string;
  context?: Array<{
    system?: string;
    objects?: Array<{
      objectType?: string;
      objectId?: string;
      fields?: Array<{ name: string; value: string }>;
    }>;
  }>;
  affiliation?: "Internal" | "External" | "Unknown";
  phoneNumber?: string;
  methods?: string[];
}

export interface GongCallMetadata {
  id: string;
  url: string;
  title: string;
  scheduled?: string;
  started: string;
  duration: number;
  primaryUserId?: string;
  direction: string;
  system: string;
  scope: string;
  media: string;
  language?: string;
  workspaceId?: string;
  purpose?: string;
}

export interface GongCallMedia {
  audioUrl?: string;
  videoUrl?: string;
}

export interface GongCallContent {
  brief?: string;
  outline?: Array<{
    section: string;
    startTime?: number;
    duration?: number;
    items?: string[];
  }>;
  highlights?: Array<{
    title: string;
    items: Array<{ text: string; startTimes?: number[] }>;
  }>;
  callOutcome?: string;
  topics?: Array<{ name: string; duration?: number }>;
  trackers?: Array<{
    id: string;
    name: string;
    count: number;
    occurrences?: Array<{
      startTime: number;
      speakerId: string;
    }>;
  }>;
}

export interface GongCallInteraction {
  interactionStats?: Array<{
    name: string;
    value: number;
  }>;
  speakers?: Array<{
    speakerId: string;
    talkTime: number;
    userId?: string;
  }>;
  video?: Array<{
    name: string;
    duration: number;
  }>;
}

export interface GongCall {
  metaData: GongCallMetadata;
  parties?: GongParty[];
  content?: GongCallContent;
  media?: GongCallMedia;
  interaction?: GongCallInteraction;
  collaboration?: {
    publicComments?: Array<{
      id: string;
      comment: string;
      commenterUserId: string;
      commentTime: string;
    }>;
  };
}

export interface GongCallsResponse {
  calls: GongCall[];
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  requestId: string;
}

export interface GongApiError {
  requestId?: string;
  errors?: Array<{ code: string; message: string }>;
}

// SalesLoft Conversations - raw payload shape (best-effort; fields are optional since
// the exact schema is not fully documented on developers.salesloft.com pages).
export interface SalesLoftParticipant {
  name?: string;
  email?: string;
  phone_number?: string;
  role?: string;
  organization?: string;
  user_id?: number | string;
}

export interface SalesLoftConversation {
  id: number | string;
  title?: string;
  subject?: string;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  duration?: number; // seconds
  direction?: string;
  call_type?: string;
  recording_url?: string;
  recording_status?: string;
  call_disposition?: string;
  summary?: string;
  participants?: SalesLoftParticipant[];
  user?: { id: number | string; name?: string; email?: string };
  to?: string;
  from?: string;
  account?: { id?: number | string; name?: string };
}

export interface SalesLoftListResponse<T> {
  data: T[];
  metadata?: {
    paging?: {
      per_page?: number;
      current_page?: number;
      next_page?: number | null;
      prev_page?: number | null;
    };
  };
}

// Unified call shape returned to the UI from both providers.
export interface NormalizedParty {
  name?: string;
  email?: string;
  title?: string;
  affiliation?: "Internal" | "External" | "Unknown";
}

export interface NormalizedCall {
  provider: Provider;
  id: string;
  title: string;
  started: string;
  durationSec: number;
  direction?: string;
  system?: string;
  scope?: string;
  media?: "Video" | "Audio" | string;
  url?: string;
  audioUrl?: string;
  videoUrl?: string;
  parties: NormalizedParty[];
  summary?: string;
  outcome?: string;
  language?: string;
  raw: GongCall | SalesLoftConversation;
}

export interface NormalizedCallsResponse {
  calls: NormalizedCall[];
  cursor?: string;
  totalRecords?: number;
}

export interface ApiResult<T> {
  data?: T;
  error?: string;
  rateLimitRemaining?: number;
}

export interface ExportOptions {
  includeMedia: boolean;
  mediaType?: "audio" | "video" | "both";
  includeMetadata?: boolean;
  includeTranscripts: boolean;
}

export interface ExportFilter {
  fromDate?: string;
  toDate?: string;
}

export interface ExportRequestPayload {
  credentials: Credentials;
  callIds?: string[];
  filter?: ExportFilter;
  options: ExportOptions;
}

export interface ManifestRow {
  id: string;
  provider: Provider;
  date: string;
  title: string;
  account: string;
  duration_min: number;
  direction: string;
  system: string;
  internal_attendees: string;
  external_attendees: string;
  outcome: string;
  folder: string;
  media_included: boolean;
  transcript_included: boolean;
  status: "ok" | "partial" | "error";
  error: string;
}
