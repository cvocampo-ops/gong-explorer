export interface GongCredentials {
  accessKey: string;
  accessKeySecret: string;
  baseUrl: string;
}

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

export interface ApiResult<T> {
  data?: T;
  error?: string;
  rateLimitRemaining?: number;
}

export interface ExportOptions {
  includeMedia: boolean;
  includeTranscripts: boolean;
}

export interface ExportFilter {
  fromDate?: string;
  toDate?: string;
}

export interface ExportRequestPayload {
  credentials: GongCredentials;
  callIds?: string[];
  filter?: ExportFilter;
  options: ExportOptions;
}

export interface ManifestRow {
  id: string;
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
