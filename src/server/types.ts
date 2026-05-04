export type SortMode = "created_desc" | "created_asc" | "name_asc" | "name_desc";
export type UserRole = "admin" | "user";
export type ThemeSetting = "light" | "dark" | "system";

export interface SessionRecord {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
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
}

export interface InstanceSettings {
  defaultTheme: ThemeSetting;
  shareSlugLength: number;
  shareCharset: string;
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
  slug: string;
  password_hash: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface ShareSummary {
  filename: string;
  slug: string;
  urlPath: string;
  hasPassword: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}
