export type SortMode = "created_desc" | "created_asc" | "name_asc" | "name_desc";
export type UserRole = "admin" | "user";
export type ThemeSetting = "light" | "dark" | "system";
export type ShareState = "disabled" | "read" | "edit";
export type ShareLinkKind = "read" | "edit";

export interface SessionRecord {
  id: number;
  user_id: number;
  token_hash: string;
  ip: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

export interface UserRecord {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  blocked: number;
  created_at: string;
  updated_at: string;
}

export interface NoteMeta {
  filename: string;
  displayName: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NoteMetadataRecord {
  id: number;
  username: string;
  filename: string;
  version: number;
  updated_at: string;
  created_at: string;
}

export interface NoteRevisionRecord {
  id: number;
  username: string;
  filename: string;
  note_version: number;
  revision_path: string;
  size_bytes: number;
  created_at: string;
}

export interface InstanceSettings {
  defaultTheme: ThemeSetting;
  defaultReadSlugLength: number;
  defaultEditSlugLength: number;
  shareCharset: string;
  maxNoteRevisions: number;
}

export interface UserSummary {
  id: number;
  username: string;
  role: UserRole;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

export interface ShareRecord {
  id: number;
  user_id: number;
  filename: string;
  read_enabled: number;
  read_slug: string | null;
  edit_enabled: number;
  edit_slug: string | null;
  password_hash: string | null;
  expires_at: string | null;
  view_count: number;
  edit_count: number;
  created_at: string;
  updated_at: string;
}

export interface ShareSummary {
  filename: string;
  state: ShareState;
  readEnabled: boolean;
  readSlug: string | null;
  readUrlPath: string | null;
  editEnabled: boolean;
  editSlug: string | null;
  editUrlPath: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}
