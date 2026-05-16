<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

type SortMode = "created_desc" | "created_asc" | "name_asc" | "name_desc";
type ThemeMode = "light" | "dark";
type ThemeSetting = ThemeMode | "system";
type UserRole = "admin" | "user";
type MainView = "editor" | "admin" | "account";
type AdminTab = "users" | "sessions" | "shares" | "notes" | "settings";
type AccountTab = "sessions" | "shares" | "password";
type UserFilter = "all" | UserRole;
type ShareState = "read" | "edit";
type ExpirationUnit = "minutes" | "hours" | "days";

interface NoteMeta {
  filename: string;
  displayName: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  ownerUsername?: string;
}

interface InstanceSettings {
  defaultTheme: ThemeSetting;
  defaultReadSlugLength: number;
  defaultEditSlugLength: number;
  shareCharset: string;
  maxNoteRevisions: number;
}

interface UserResponse {
  user: {
    username: string;
    role: UserRole;
  };
}

interface ShareSummary {
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

interface AdminUserSummary {
  id: number;
  username: string;
  role: UserRole;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

interface AdminShareSummary extends ShareSummary {
  id: number;
  username: string;
}

interface SessionSummary {
  id: number;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  ip: string;
  userAgent: string;
}

interface AdminSessionSummary extends SessionSummary {
  username: string;
  userId: number;
}

interface NoteRevisionSummary {
  id: number;
  version: number;
  sizeBytes: number;
  createdAt: string;
}

interface NoteRevisionDetail extends NoteRevisionSummary {
  content: string;
}

const state = reactive({
  ready: false,
  authenticated: false,
  theme: "dark" as ThemeMode,
  username: "",
  role: "user" as UserRole,
  loginUsername: "",
  loginPassword: "",
  loginError: "",
  loadingNotes: false,
  saving: false,
  sort: "created_desc" as SortMode,
  notes: [] as NoteMeta[],
  selectedFilename: "",
  editorTitle: "",
  editorContent: "",
  editorVersion: 0,
  editorFontSize: 14,
  isDirty: false,
  feedback: "",
  noteRemoteUpdatePending: false,
  noteRemoteVersion: 0,
  noteRemoteUpdatedAt: "",
  noteConflict: false,
  noteConflictServerVersion: 0,
  noteConflictServerContent: "",
  noteConflictUpdatedAt: "",
  isCreatingNew: false,
  contextMenuFilename: "",
  contextMenuOpen: false,
  contextMenuStyle: {
    top: "0px",
    right: "0px"
  } as Record<string, string>,
  currentView: "editor" as MainView,
  adminTab: "users" as AdminTab,
  accountTab: "sessions" as AccountTab,
  settings: {
    defaultTheme: "dark",
    defaultReadSlugLength: 8,
    defaultEditSlugLength: 16,
    shareCharset: "abcdefghijklmnopqrstuvwxyz0123456789",
    maxNoteRevisions: 20
  } as InstanceSettings,
  shareLoading: false,
  shareSaving: false,
  userShares: [] as ShareSummary[],
  shareMode: "read" as ShareState,
  shareSlugInput: "",
  sharePasswordEnabled: false,
  sharePassword: "",
  shareHasExistingPassword: false,
  shareReadUrlPath: "",
  shareEditUrlPath: "",
  shareExpiresAt: "",
  shareExpirationAmount: "",
  shareExpirationUnit: "days" as ExpirationUnit,
  shareViewCount: 0,
  shareEditCount: 0,
  shareNotice: "",
  shareNoticeTone: "success" as "success" | "danger",
  sharePanelOpen: false,
  historyPanelOpen: false,
  historyLoading: false,
  historyClearing: false,
  historyRestoring: false,
  historyError: "",
  historySuccess: "",
  historyItems: [] as NoteRevisionSummary[],
  historySelectedRevision: null as NoteRevisionDetail | null,
  historyPreviewLoading: false,
  historyPreviewRevisionId: 0,
  adminLoading: false,
  adminUsers: [] as AdminUserSummary[],
  adminUsersFilter: "all" as UserFilter,
  adminShares: [] as AdminShareSummary[],
  adminSharesUsername: "",
  adminNotes: [] as NoteMeta[],
  adminNotesUsername: "",
  adminSessionsLoading: false,
  adminSessionsUsername: "all",
  adminSessions: [] as AdminSessionSummary[],
  adminSettingsSaving: false,
  adminSettingsSuccess: "",
  adminCreateUsername: "",
  adminCreatePassword: "",
  adminCreateRole: "user" as UserRole,
  meSessionsLoading: false,
  meSessions: [] as SessionSummary[],
  accountPasswordCurrent: "",
  accountPasswordNext: "",
  accountPasswordConfirm: "",
  accountPasswordSaving: false,
  adminUserSessionsLoading: false,
  adminUserSessionsTarget: "",
  adminUserSessions: [] as SessionSummary[],
  publicShareSlug: "",
  publicShareFilename: "",
  publicShareContent: "",
  publicSharePassword: "",
  publicShareRequiresPassword: false,
  publicShareLoading: false,
  publicShareError: "",
  publicEditSlug: "",
  publicEditFilename: "",
  publicEditContent: "",
  publicEditDirty: false,
  publicEditPassword: "",
  publicEditGrant: "",
  publicEditVersion: 0,
  publicEditRequiresPassword: false,
  publicEditLoading: false,
  publicEditSaving: false,
  publicEditError: "",
  publicEditSuccess: "",
  publicEditRemoteUpdatePending: false,
  publicEditRemoteVersion: 0,
  publicEditRemoteUpdatedAt: "",
  publicEditConflict: false,
  publicEditConflictServerVersion: 0,
  publicEditConflictServerContent: "",
  publicEditConflictUpdatedAt: ""
});

let autosaveTimer: number | undefined;
let shareNoticeTimer: number | undefined;
const editorTextarea = ref<HTMLTextAreaElement | null>(null);
let noteEvents: EventSource | undefined;
let publicEditEvents: EventSource | undefined;
let noteEventsReconnectTimer: number | undefined;
let publicEditEventsReconnectTimer: number | undefined;

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const selectedNote = computed(() =>
  state.notes.find((note) => note.filename === state.selectedFilename)
);

const hasSelection = computed(() => Boolean(state.selectedFilename) || state.isCreatingNew);
const canOperateOnSavedNote = computed(() => Boolean(state.selectedFilename) && !state.isCreatingNew);
const byteCount = computed(() => new TextEncoder().encode(state.editorContent).length);
const isAdmin = computed(() => state.role === "admin");
const adminTabs: AdminTab[] = ["users", "sessions", "shares", "notes", "settings"];
const accountTabs: AccountTab[] = ["sessions", "shares", "password"];
const publicOrigin = typeof window !== "undefined" ? window.location.origin : "";
const filteredAdminUsers = computed(() =>
  state.adminUsersFilter === "all" ? state.adminUsers : state.adminUsers.filter((user) => user.role === state.adminUsersFilter)
);
const filteredAdminShares = computed(() =>
  state.adminSharesUsername === "all"
    ? state.adminShares
    : state.adminShares.filter((share) => share.username === state.adminSharesUsername)
);
const userShareFilenameSet = computed(() => new Set(state.userShares.map((share) => share.filename)));
const activeReadShareUrl = computed(() => (state.shareReadUrlPath ? `${publicOrigin}${state.shareReadUrlPath}` : ""));
const activeEditShareUrl = computed(() => (state.shareEditUrlPath ? `${publicOrigin}${state.shareEditUrlPath}` : ""));
const isPublicShareView = computed(() => Boolean(state.publicShareSlug));
const isPublicEditView = computed(() => Boolean(state.publicEditSlug));
const activeShareUrl = computed(() => {
  if (state.shareMode === "edit") {
    return activeEditShareUrl.value;
  }
  if (state.shareMode === "read") {
    return activeReadShareUrl.value;
  }
  return "";
});
const isReadMode = computed(() => state.shareMode === "read");
const isEditMode = computed(() => state.shareMode === "edit");
const hasAnyActiveShare = computed(() => Boolean(state.shareReadUrlPath || state.shareEditUrlPath));
const currentSessionCount = computed(() => state.meSessions.filter((session) => session.current).length);
const otherSessionCount = computed(() => state.meSessions.filter((session) => !session.current).length);
const shareRemainingText = computed(() => {
  if (!state.shareExpiresAt) {
    return "";
  }

  const diffMs = new Date(state.shareExpiresAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return "expired";
  }

  const totalMinutes = Math.ceil(diffMs / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m left`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    return `${totalHours}h left`;
  }

  const totalDays = Math.ceil(totalHours / 24);
  return `${totalDays}d left`;
});
const sharePasswordWarningText = computed(() => {
  if (!(state.shareReadUrlPath || state.shareEditUrlPath) || !state.shareHasExistingPassword) {
    return "";
  }

  return state.shareMode === "edit"
    ? "This edit link now requires a password."
    : "This public link now requires a password.";
});
const shareStatusText = computed(() => state.shareNotice || sharePasswordWarningText.value);
const shareStatusIsSuccess = computed(() => state.shareNotice ? state.shareNoticeTone === "success" : false);
const publicStatusText = computed(() => {
  if (state.shareMode === "edit" && state.shareEditUrlPath) {
    return shareRemainingText.value ? `Edit link active • ${shareRemainingText.value}` : "Edit link active";
  }
  if (state.shareMode === "read" && state.shareReadUrlPath) {
    return shareRemainingText.value ? `Read link active • ${shareRemainingText.value}` : "Read link active";
  }
  return "Private note";
});

const SORT_STORAGE_KEY = "textbin-sort";

function sortNotesInPlace(notes: NoteMeta[]) {
  const toMs = (value: string) => new Date(value).getTime();
  notes.sort((left, right) => {
    switch (state.sort) {
      case "created_asc":
        return toMs(left.updatedAt) - toMs(right.updatedAt) || left.filename.localeCompare(right.filename);
      case "name_asc":
        return left.filename.localeCompare(right.filename);
      case "name_desc":
        return right.filename.localeCompare(left.filename);
      case "created_desc":
      default:
        return toMs(right.updatedAt) - toMs(left.updatedAt) || right.filename.localeCompare(left.filename);
    }
  });
}

function upsertLocalNote(note: NoteMeta, previousFilename?: string) {
  const targetFilename = previousFilename ?? note.filename;
  const existingIndex = state.notes.findIndex((item) => item.filename === targetFilename);
  if (existingIndex >= 0) {
    state.notes.splice(existingIndex, 1, note);
  } else {
    state.notes.push(note);
  }
  sortNotesInPlace(state.notes);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrfToken = getCookieValue("textbin_csrf");
    if (csrfToken && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: "Request failed" }))) as {
      message?: string;
    };
    throw new ApiError(payload.message || "Request failed", response.status, payload);
  }

  if (response.headers.get("Content-Type")?.includes("application/json")) {
    return (await response.json()) as T;
  }

  return undefined as T;
}

function disconnectNoteEvents() {
  noteEvents?.close();
  noteEvents = undefined;
  if (noteEventsReconnectTimer) {
    window.clearTimeout(noteEventsReconnectTimer);
    noteEventsReconnectTimer = undefined;
  }
}

function disconnectPublicEditEvents() {
  publicEditEvents?.close();
  publicEditEvents = undefined;
  if (publicEditEventsReconnectTimer) {
    window.clearTimeout(publicEditEventsReconnectTimer);
    publicEditEventsReconnectTimer = undefined;
  }
}

function clearNoteSyncState() {
  state.editorVersion = 0;
  state.noteRemoteUpdatePending = false;
  state.noteRemoteVersion = 0;
  state.noteRemoteUpdatedAt = "";
  state.noteConflict = false;
  state.noteConflictServerVersion = 0;
  state.noteConflictServerContent = "";
  state.noteConflictUpdatedAt = "";
}

function clearPublicEditSyncState() {
  state.publicEditVersion = 0;
  state.publicEditDirty = false;
  state.publicEditRemoteUpdatePending = false;
  state.publicEditRemoteVersion = 0;
  state.publicEditRemoteUpdatedAt = "";
  state.publicEditConflict = false;
  state.publicEditConflictServerVersion = 0;
  state.publicEditConflictServerContent = "";
  state.publicEditConflictUpdatedAt = "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

function updateDocumentTitle() {
  if (state.publicShareSlug || state.publicEditSlug) {
    return;
  }

  if (!state.authenticated) {
    document.title = "TextBin";
    return;
  }

  if (state.currentView === "admin") {
    document.title = "Admin Panel - TextBin";
    return;
  }

  if (state.currentView === "account") {
    document.title = "Account Settings - TextBin";
    return;
  }

  if (state.isCreatingNew && !state.selectedFilename) {
    document.title = "New Note - TextBin";
    return;
  }

  if (state.selectedFilename) {
    document.title = `${state.selectedFilename.replace(/\.txt$/i, "")} - TextBin`;
    return;
  }

  document.title = "TextBin";
}

function getRoleBadgeStyle(role?: UserRole) {
  if (role === "admin") {
    return { background: "var(--admin-role-soft)", color: "var(--admin-role-text)" };
  }

  return { background: "var(--user-role-soft)", color: "var(--user-role-text)" };
}

function getBlockedBadgeStyle() {
  return { background: "var(--blocked-role-soft)", color: "var(--blocked-role-text)" };
}

function clampEditorFontSize(value: number): number {
  return Math.min(28, Math.max(10, value));
}

function adjustEditorFontSize(delta: number) {
  state.editorFontSize = clampEditorFontSize(state.editorFontSize + delta);
}

function isEditorInteractionContext(target: EventTarget | null): boolean {
  if (state.currentView !== "editor" || !editorTextarea.value) {
    return false;
  }

  const isInsideTarget = target instanceof Node && editorTextarea.value.contains(target);
  const isHovered = editorTextarea.value.matches(":hover");
  const isFocused = document.activeElement === editorTextarea.value;

  return isInsideTarget || isHovered || isFocused;
}

function handleEditorWheel(event: WheelEvent) {
  if (!event.ctrlKey) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaY < 0 ? 1 : -1;
  adjustEditorFontSize(delta);
}

function handleGlobalEditorWheel(event: WheelEvent) {
  if (!event.ctrlKey) {
    return;
  }

  if (!isEditorInteractionContext(event.target)) {
    return;
  }

  handleEditorWheel(event);
}

function handleLegacyEditorWheel(event: Event) {
  const legacyEvent = event as WheelEvent & { wheelDelta?: number };
  if (!legacyEvent.ctrlKey) {
    return;
  }

  if (!isEditorInteractionContext(legacyEvent.target)) {
    return;
  }

  legacyEvent.preventDefault();
  legacyEvent.stopPropagation();
  const delta = (legacyEvent.wheelDelta ?? 0) > 0 ? 1 : -1;
  adjustEditorFontSize(delta);
}

function handleAltEditorWheel(event: WheelEvent) {
  if (!event.altKey) {
    return;
  }

  if (!isEditorInteractionContext(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaY < 0 ? 1 : -1;
  adjustEditorFontSize(delta);
}

function handleEditorKeyZoom(event: KeyboardEvent) {
  if (!isEditorInteractionContext(event.target)) {
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    adjustEditorFontSize(1);
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    adjustEditorFontSize(-1);
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    state.editorFontSize = 14;
  }
}

function handleGlobalEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") {
    return;
  }

  if (state.sharePanelOpen) {
    closeSharePanel();
    return;
  }

  if (state.historyPanelOpen) {
    state.historyPanelOpen = false;
  }
}

function getCookieValue(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function formatUserAgentLabel(userAgent: string): string {
  const source = (userAgent || "").trim();
  if (!source || source === "unknown") {
    return "Unknown browser / device";
  }

  const normalized = source.toLowerCase();

  let browser = "Unknown browser";
  if (normalized.includes("edg/")) {
    browser = "MS Edge";
  } else if (normalized.includes("opr/") || normalized.includes("opera/")) {
    browser = "Opera";
  } else if (normalized.includes("firefox/")) {
    browser = "Firefox";
  } else if (normalized.includes("chrome/") && !normalized.includes("edg/") && !normalized.includes("opr/")) {
    browser = "Chrome";
  } else if (normalized.includes("safari/") && !normalized.includes("chrome/")) {
    browser = "Safari";
  }

  let os = "Unknown OS";
  if (normalized.includes("windows")) {
    const match = normalized.match(/windows nt (\d+\.\d+)/);
    const version = match?.[1];
    if (version === "6.1") {
      os = "Win 7";
    } else if (version === "6.2") {
      os = "Win 8";
    } else if (version === "6.3") {
      os = "Win 8.1";
    } else if (version === "10.0") {
      os = "Win 10/11";
    } else {
      os = "Win";
    }
  } else if (normalized.includes("android")) {
    os = "Android";
  } else if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")) {
    os = "iOS";
  } else if (normalized.includes("mac os x") || normalized.includes("macintosh")) {
    os = "macOS";
  } else if (normalized.includes("linux")) {
    os = "Linux";
  }

  let device = "Desktop";
  if (normalized.includes("ipad") || normalized.includes("tablet")) {
    device = "Tablet";
  } else if (normalized.includes("mobile") || normalized.includes("iphone") || normalized.includes("android")) {
    device = "Phone";
  }

  return `${browser} on ${os} (${device})`;
}

function resolveThemeSetting(theme: ThemeSetting): ThemeMode {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function clearShareState(options?: { preservePanelOpen?: boolean }) {
  const preservePanelOpen = options?.preservePanelOpen ?? false;
  if (shareNoticeTimer) {
    window.clearTimeout(shareNoticeTimer);
    shareNoticeTimer = undefined;
  }
  state.shareLoading = false;
  state.shareSaving = false;
  state.shareMode = "read";
  state.shareSlugInput = "";
  state.sharePasswordEnabled = false;
  state.sharePassword = "";
  state.shareHasExistingPassword = false;
  state.shareReadUrlPath = "";
  state.shareEditUrlPath = "";
  state.shareExpiresAt = "";
  state.shareExpirationAmount = "";
  state.shareExpirationUnit = "days";
  state.shareViewCount = 0;
  state.shareEditCount = 0;
  state.shareNotice = "";
  state.shareNoticeTone = "success";
  state.sharePanelOpen = preservePanelOpen ? state.sharePanelOpen : false;
}

function clearHistoryState() {
  state.historyPanelOpen = false;
  state.historyLoading = false;
  state.historyClearing = false;
  state.historyRestoring = false;
  state.historyError = "";
  state.historySuccess = "";
  state.historyItems = [];
  state.historySelectedRevision = null;
  state.historyPreviewLoading = false;
  state.historyPreviewRevisionId = 0;
}

function showShareNotice(message: string, tone: "success" | "danger" = "success") {
  if (shareNoticeTimer) {
    window.clearTimeout(shareNoticeTimer);
  }
  state.shareNotice = message;
  state.shareNoticeTone = tone;
  shareNoticeTimer = window.setTimeout(() => {
    if (state.shareNotice === message) {
      state.shareNotice = "";
      state.shareNoticeTone = "success";
    }
    shareNoticeTimer = undefined;
  }, 2200);
}

function closeSharePanel() {
  if (shareNoticeTimer) {
    window.clearTimeout(shareNoticeTimer);
    shareNoticeTimer = undefined;
  }
  state.shareNotice = "";
  state.sharePanelOpen = false;
}

function handleShareModeChange() {
  state.shareSlugInput = "";
}

function applyExpirationFromIso(value: string | null) {
  state.shareExpiresAt = value ?? "";
  if (!value) {
    state.shareExpirationAmount = "";
    state.shareExpirationUnit = "days";
    return;
  }

  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    state.shareExpirationAmount = "";
    state.shareExpirationUnit = "days";
    return;
  }

  const totalMinutes = Math.ceil(diffMs / 60000);
  if (totalMinutes < 60) {
    state.shareExpirationAmount = String(totalMinutes);
    state.shareExpirationUnit = "minutes";
    return;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    state.shareExpirationAmount = String(totalHours);
    state.shareExpirationUnit = "hours";
    return;
  }

  state.shareExpirationAmount = String(Math.ceil(totalHours / 24));
  state.shareExpirationUnit = "days";
}

function resetEditorState() {
  state.selectedFilename = "";
  state.editorTitle = "";
  state.editorContent = "";
  clearNoteSyncState();
  disconnectNoteEvents();
  state.isCreatingNew = false;
  state.isDirty = false;
  state.feedback = "";
  clearShareState();
  clearHistoryState();
}

function closeCurrentNote() {
  resetEditorState();
  updateDocumentTitle();
}

function clearAuthState() {
  state.authenticated = false;
  state.username = "";
  state.role = "user";
  state.notes = [];
  state.currentView = "editor";
  state.accountTab = "sessions";
  state.adminUsers = [];
  state.adminShares = [];
  state.adminNotes = [];
  state.adminNotesUsername = "";
  state.adminSharesUsername = "";
  state.adminSessions = [];
  state.adminSessionsUsername = "all";
  state.meSessions = [];
  state.accountPasswordCurrent = "";
  state.accountPasswordNext = "";
  state.accountPasswordConfirm = "";
  state.adminUserSessions = [];
  state.adminUserSessionsTarget = "";
  disconnectPublicEditEvents();
  disconnectNoteEvents();
  resetEditorState();
}

async function loadInstanceSettings() {
  const payload = await api<{ settings: InstanceSettings }>("/api/settings");
  state.settings = payload.settings;
  state.settings.defaultTheme = "light";
  applyTheme("light");
}

async function loadUserShares() {
  const payload = await api<{ shares: ShareSummary[] }>("/api/shares");
  state.userShares = payload.shares;
}

async function loadNoteHistory(options?: { preservePreview?: boolean; filename?: string }) {
  const targetFilename = options?.filename ?? state.selectedFilename;
  if (!targetFilename) {
    clearHistoryState();
    return;
  }

  state.historyLoading = true;
  state.historyError = "";
  try {
    const payload = await api<{ revisions: NoteRevisionSummary[] }>(`/api/notes/${encodeURIComponent(targetFilename)}/revisions`);
    if (state.selectedFilename !== targetFilename) {
      return;
    }
    state.historyItems = payload.revisions;
    if (!options?.preservePreview) {
      state.historySelectedRevision = null;
    } else if (
      state.historySelectedRevision &&
      !payload.revisions.some((revision) => revision.id === state.historySelectedRevision?.id)
    ) {
      state.historySelectedRevision = null;
    }
  } catch (error) {
    state.historyError = error instanceof Error ? error.message : "Could not load version history";
  } finally {
    state.historyLoading = false;
  }
}

async function previewRevision(revisionId: number) {
  if (!state.selectedFilename) {
    return;
  }
  if (state.historyPreviewLoading || state.historyRestoring) {
    return;
  }

  state.historyPreviewLoading = true;
  state.historyPreviewRevisionId = revisionId;
  state.historyError = "";
  try {
    const payload = await api<NoteRevisionDetail>(
      `/api/notes/${encodeURIComponent(state.selectedFilename)}/revisions/${revisionId}`
    );
    state.historySelectedRevision = payload;
  } catch (error) {
    state.historyError = error instanceof Error ? error.message : "Could not load revision";
  } finally {
    state.historyPreviewLoading = false;
    state.historyPreviewRevisionId = 0;
  }
}

async function toggleHistoryPanel() {
  if (!canOperateOnSavedNote.value) {
    return;
  }
  state.historyPanelOpen = !state.historyPanelOpen;
  if (state.historyPanelOpen) {
    await loadNoteHistory();
  }
}

async function toggleSharePanel() {
  if (!canOperateOnSavedNote.value) {
    return;
  }

  state.sharePanelOpen = !state.sharePanelOpen;
  if (state.sharePanelOpen && state.selectedFilename) {
    await loadShareForFilename(state.selectedFilename);
  }
}

async function restoreRevision(revision: NoteRevisionSummary) {
  if (!state.selectedFilename) {
    return;
  }
  if (state.historyRestoring || state.historyPreviewLoading) {
    return;
  }

  const confirmationText = state.isDirty
    ? "Restore this version?\n\nYou have unsaved local changes in the editor. Those local changes will be lost and are not saved to version history until you save this note."
    : "Restore this version?\n\nYour current note will be replaced, but a backup of the current content will be saved if history is enabled.";
  const confirmed = window.confirm(
    confirmationText
  );
  if (!confirmed) {
    return;
  }

  state.historyRestoring = true;
  state.historyError = "";
  state.historySuccess = "";
  try {
    const payload = await api<{ success: true; version: number; updatedAt: string; content: string }>(
      `/api/notes/${encodeURIComponent(state.selectedFilename)}/revisions/${revision.id}/restore`,
      {
        method: "POST",
        body: JSON.stringify({
          baseVersion: state.editorVersion
        })
      }
    );
    state.editorContent = payload.content;
    state.editorVersion = payload.version;
    state.isDirty = false;
    state.noteRemoteUpdatePending = false;
    state.noteConflict = false;
    state.feedback = "Revision restored";
    state.historySuccess = "Revision restored";
    const existing = selectedNote.value;
    if (existing) {
      upsertLocalNote({
        ...existing,
        updatedAt: payload.updatedAt,
        version: payload.version
      });
    }
    await loadNoteHistory();
    state.historySelectedRevision = null;
    await loadShareForFilename(state.selectedFilename);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const payload = error.data as {
        error?: string;
        serverVersion?: number;
        serverContent?: string;
        updatedAt?: string;
        message?: string;
      };
      if (payload.error === "VERSION_CONFLICT") {
        state.noteConflict = true;
        state.noteConflictServerVersion = payload.serverVersion ?? 0;
        state.noteConflictServerContent = payload.serverContent ?? "";
        state.noteConflictUpdatedAt = payload.updatedAt ?? "";
        state.noteRemoteUpdatePending = true;
        state.historyError = payload.message ?? "This note was updated elsewhere.";
        return;
      }
    }
    state.historyError = error instanceof Error ? error.message : "Could not restore revision";
  } finally {
    state.historyRestoring = false;
  }
}

async function clearNoteHistory() {
  if (!state.selectedFilename) {
    return;
  }

  const confirmed = window.confirm("Clear version history for this note?");
  if (!confirmed) {
    return;
  }

  state.historyClearing = true;
  state.historyError = "";
  state.historySuccess = "";
  try {
    await api(`/api/notes/${encodeURIComponent(state.selectedFilename)}/revisions`, {
      method: "DELETE"
    });
    state.historyItems = [];
    state.historySelectedRevision = null;
    state.historySuccess = "Version history cleared";
  } catch (error) {
    state.historyError = error instanceof Error ? error.message : "Could not clear version history";
  } finally {
    state.historyClearing = false;
  }
}

async function loadMySessions() {
  state.meSessionsLoading = true;
  try {
    const payload = await api<{ sessions: SessionSummary[] }>("/api/me/sessions");
    state.meSessions = payload.sessions;
  } finally {
    state.meSessionsLoading = false;
  }
}

async function loadPublicShare() {
  if (!state.publicShareSlug) {
    return;
  }

  state.publicShareLoading = true;
  state.publicShareError = "";
  try {
    const payload = state.publicSharePassword
      ? await api<{ filename?: string; content?: string; requiresPassword: boolean }>(
          `/api/public/shares/${encodeURIComponent(state.publicShareSlug)}/access`,
          {
            method: "POST",
            body: JSON.stringify({ password: state.publicSharePassword })
          }
        )
      : await api<{ filename?: string; content?: string; requiresPassword: boolean }>(
          `/api/public/shares/${encodeURIComponent(state.publicShareSlug)}`
        );

    state.publicShareFilename = payload.filename ?? "";
    state.publicShareRequiresPassword = payload.requiresPassword;
    state.publicShareContent = payload.content ?? "";
    document.title = payload.requiresPassword
      ? "Protected TextBin Note"
      : `${(payload.filename ?? "").replace(/\.txt$/i, "") || "Shared Note"} - TextBin`;
    if (!payload.requiresPassword) {
      state.publicSharePassword = "";
    }
  } catch (error) {
    state.publicShareError = error instanceof Error ? error.message : "Could not load shared note";
    state.publicShareContent = "";
  } finally {
    state.publicShareLoading = false;
    state.ready = true;
  }
}

async function loadPublicEdit() {
  if (!state.publicEditSlug) {
    return;
  }

  state.publicEditLoading = true;
  state.publicEditError = "";
  state.publicEditSuccess = "";
  try {
    const headers = state.publicEditGrant ? { "X-Public-Edit-Grant": state.publicEditGrant } : undefined;
    const payload = await api<{ filename?: string; content?: string; requiresPassword: boolean; version?: number; updatedAt?: string }>(
      `/api/public/edit/${encodeURIComponent(state.publicEditSlug)}`,
      {
        headers
      }
    );

    state.publicEditFilename = payload.filename ?? "";
    state.publicEditRequiresPassword = payload.requiresPassword;
    state.publicEditContent = payload.content ?? "";
    if (payload.requiresPassword) {
      state.publicEditGrant = "";
      state.publicEditPassword = "";
      clearPublicEditSyncState();
      disconnectPublicEditEvents();
    } else {
      clearPublicEditSyncState();
      state.publicEditVersion = payload.version ?? 1;
      connectPublicEditEvents();
    }
    document.title = payload.requiresPassword
      ? "Protected Editable TextBin Note"
      : `${(payload.filename ?? "").replace(/\.txt$/i, "") || "Editable Text"} - TextBin`;
  } catch (error) {
    state.publicEditError = error instanceof Error ? error.message : "Could not load editable note";
    state.publicEditContent = "";
    state.publicEditGrant = "";
    clearPublicEditSyncState();
    disconnectPublicEditEvents();
  } finally {
    state.publicEditLoading = false;
    state.ready = true;
  }
}

async function loadNotes() {
  state.loadingNotes = true;
  try {
    const payload = await api<{ notes: NoteMeta[] }>(`/api/notes?sort=${state.sort}`);
    state.notes = payload.notes;
    if (state.selectedFilename && !state.notes.some((note) => note.filename === state.selectedFilename)) {
      resetEditorState();
    }
  } finally {
    state.loadingNotes = false;
  }
}

function persistSortSelection() {
  window.localStorage.setItem(SORT_STORAGE_KEY, state.sort);
}

async function changeSort() {
  persistSortSelection();
  await loadNotes();
}

async function loadSession() {
  try {
    const storedSort = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (storedSort === "created_desc" || storedSort === "created_asc" || storedSort === "name_asc" || storedSort === "name_desc") {
      state.sort = storedSort;
    }
    const payload = await api<UserResponse>("/api/auth/me", { method: "GET" });
    state.authenticated = true;
    state.username = payload.user.username;
    state.role = payload.user.role;
    history.replaceState({}, "", "/dashboard");
    await Promise.all([loadInstanceSettings(), loadNotes(), loadUserShares()]);
    updateDocumentTitle();
  } catch {
    clearAuthState();
    history.replaceState({}, "", "/login");
  } finally {
    state.ready = true;
  }
}

async function login() {
  state.loginError = "";
  try {
    const payload = await api<UserResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: state.loginUsername,
        password: state.loginPassword
      })
    });
    state.authenticated = true;
    state.username = payload.user.username;
    state.role = payload.user.role;
    state.loginPassword = "";
    history.replaceState({}, "", "/dashboard");
    await Promise.all([loadInstanceSettings(), loadNotes(), loadUserShares()]);
    updateDocumentTitle();
  } catch (error) {
    state.loginError = error instanceof Error ? error.message : "Invalid username or password";
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  clearAuthState();
  history.replaceState({}, "", "/login");
  updateDocumentTitle();
}

async function loadShareForFilename(filename: string) {
  const preservePanelOpen = state.sharePanelOpen;
  if (!filename) {
    clearShareState({ preservePanelOpen });
    return;
  }

  state.shareLoading = true;
  try {
    const payload = await api<{ share: ShareSummary | null }>(`/api/shares/${encodeURIComponent(filename)}`);
    if (state.selectedFilename !== filename) {
      return;
    }
    if (!payload.share) {
      clearShareState({ preservePanelOpen });
      return;
    }

    state.shareMode = payload.share.state === "edit" ? "edit" : "read";
    state.shareSlugInput = "";
    state.sharePasswordEnabled = payload.share.hasPassword;
    state.sharePassword = "";
    state.shareHasExistingPassword = payload.share.hasPassword;
    state.shareReadUrlPath = payload.share.readUrlPath ?? "";
    state.shareEditUrlPath = payload.share.editUrlPath ?? "";
    applyExpirationFromIso(payload.share.expiresAt);
    state.shareViewCount = payload.share.viewCount;
    state.shareEditCount = payload.share.editCount;
    state.sharePanelOpen = preservePanelOpen;
  } finally {
    state.shareLoading = false;
  }
}

async function openNote(filename: string) {
  if (!filename) {
    resetEditorState();
    return;
  }

  const payload = await api<{ filename: string; content: string; version: number; updatedAt: string }>(`/api/notes/${encodeURIComponent(filename)}`);
  state.currentView = "editor";
  state.selectedFilename = payload.filename;
  updateDocumentTitle();
  clearNoteSyncState();
  state.editorTitle = payload.filename.replace(/\.txt$/i, "");
  state.editorContent = payload.content;
  state.editorVersion = payload.version;
  state.isCreatingNew = false;
  state.isDirty = false;
  state.feedback = "";
  closeContextMenu();
  connectNoteEvents(payload.filename);
  void loadShareForFilename(payload.filename);
  if (state.historyPanelOpen) {
    void loadNoteHistory({ filename: payload.filename });
  } else {
    state.historyItems = [];
    state.historySelectedRevision = null;
    state.historyError = "";
    state.historySuccess = "";
  }
}

function createNewNote() {
  disconnectNoteEvents();
  closeContextMenu();
  state.currentView = "editor";
  state.selectedFilename = "";
  state.editorTitle = "";
  state.editorContent = "";
  clearNoteSyncState();
  state.isCreatingNew = true;
  state.isDirty = false;
  state.feedback = "";
  clearShareState();
  clearHistoryState();
  updateDocumentTitle();
}

async function saveNote() {
  const trimmedTitle = state.editorTitle.trim();
  if (!trimmedTitle) {
    state.feedback = "Filename is required";
    return;
  }

  state.saving = true;
  state.feedback = "";
  try {
    if (state.isCreatingNew) {
      const created = await api<NoteMeta>("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          title: trimmedTitle,
          content: state.editorContent
        })
      });
      state.selectedFilename = created.filename;
      state.editorVersion = created.version;
      state.isCreatingNew = false;
      upsertLocalNote(created);
      connectNoteEvents(created.filename);
      if (state.historyPanelOpen) {
        await loadNoteHistory();
      }
    } else {
      const previousDisplayName = selectedNote.value?.displayName;
      const updateResult = await api<{ success: true; version: number; updatedAt: string }>(`/api/notes/${encodeURIComponent(state.selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({
          content: state.editorContent,
          baseVersion: state.editorVersion
        })
      });
      state.editorVersion = updateResult.version;
      state.noteRemoteUpdatePending = false;
      state.noteConflict = false;

      const existing = selectedNote.value;
      if (existing) {
        upsertLocalNote({
          ...existing,
          displayName: trimmedTitle,
          updatedAt: updateResult.updatedAt,
          version: updateResult.version
        });
      }

      if (trimmedTitle !== previousDisplayName) {
        const renamed = await api<NoteMeta>(`/api/notes/${encodeURIComponent(state.selectedFilename)}/rename`, {
          method: "PATCH",
          body: JSON.stringify({
            title: trimmedTitle
          })
        });
        upsertLocalNote(renamed, state.selectedFilename);
        state.selectedFilename = renamed.filename;
        state.editorVersion = renamed.version;
        connectNoteEvents(renamed.filename);
      }
    }

    await loadUserShares();
    state.isDirty = false;
    state.feedback = "Saved";
    if (state.selectedFilename) {
      await loadShareForFilename(state.selectedFilename);
      if (state.historyPanelOpen) {
        await loadNoteHistory({ preservePreview: true });
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const payload = error.data as {
        error?: string;
        serverVersion?: number;
        serverContent?: string;
        updatedAt?: string;
        message?: string;
      };
      if (payload.error === "VERSION_CONFLICT") {
        state.noteConflict = true;
        state.noteConflictServerVersion = payload.serverVersion ?? 0;
        state.noteConflictServerContent = payload.serverContent ?? "";
        state.noteConflictUpdatedAt = payload.updatedAt ?? "";
        state.noteRemoteUpdatePending = true;
        state.feedback = payload.message ?? "This note was updated elsewhere.";
        return;
      }
    }
    throw error;
  } finally {
    state.saving = false;
  }
}

async function saveShareForCurrentNote() {
  if (!canOperateOnSavedNote.value) {
    state.feedback = "Save the note before sharing";
    return;
  }

  state.shareSaving = true;
  try {
    const amount = Number.parseInt(String(state.shareExpirationAmount || ""), 10);
    const expiresAt =
      Number.isFinite(amount) && amount > 0
        ? new Date(
            Date.now() +
              amount *
                (state.shareExpirationUnit === "minutes"
                  ? 60_000
                  : state.shareExpirationUnit === "hours"
                    ? 60 * 60_000
                    : 24 * 60 * 60_000)
          ).toISOString()
        : undefined;

    const payload = await api<{ share: ShareSummary | null }>(`/api/shares/${encodeURIComponent(state.selectedFilename)}`, {
      method: "PUT",
      body: JSON.stringify({
        readEnabled: state.shareMode === "read",
        editEnabled: state.shareMode === "edit",
        readCustomSlug: state.shareMode === "read" ? state.shareSlugInput.trim() || undefined : undefined,
        editCustomSlug: state.shareMode === "edit" ? state.shareSlugInput.trim() || undefined : undefined,
        passwordEnabled: state.sharePasswordEnabled,
        password: state.sharePassword.trim() || undefined,
        expiresAt
      })
    });

    if (payload.share) {
      state.shareMode = payload.share.state === "edit" ? "edit" : "read";
      state.shareSlugInput = "";
      state.shareHasExistingPassword = payload.share.hasPassword;
      state.sharePasswordEnabled = payload.share.hasPassword;
      state.shareReadUrlPath = payload.share.readUrlPath ?? "";
      state.shareEditUrlPath = payload.share.editUrlPath ?? "";
      applyExpirationFromIso(payload.share.expiresAt);
      state.shareViewCount = payload.share.viewCount;
      state.shareEditCount = payload.share.editCount;
      state.sharePassword = "";
      state.feedback = "";
      showShareNotice("Share settings saved");
    } else {
      clearShareState();
      state.feedback = "";
    }
    await loadUserShares();
  } catch (error) {
    state.feedback = "";
    showShareNotice(error instanceof Error ? error.message : "Could not save share settings", "danger");
  } finally {
    state.shareSaving = false;
  }
}

async function disableShareForCurrentNote() {
  if (!canOperateOnSavedNote.value) {
    return;
  }

  await api(`/api/shares/${encodeURIComponent(state.selectedFilename)}`, { method: "DELETE" });
  clearShareState();
  await loadUserShares();
  state.feedback = "";
  showShareNotice("Share removed");
}

async function deleteOwnShare(share: ShareSummary) {
  if (!window.confirm(`Delete public link for ${share.filename}?`)) {
    return;
  }

  await api(`/api/shares/${encodeURIComponent(share.filename)}`, { method: "DELETE" });
  if (state.selectedFilename === share.filename) {
    clearShareState();
  }
  await loadUserShares();
  state.feedback = "Share removed";
}

async function copyOwnShareLink(share: ShareSummary) {
  const path = share.state === "edit" ? share.editUrlPath : share.readUrlPath;
  if (!path) {
    state.feedback = "No active link to copy";
    return;
  }

  const url = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(url);
    state.feedback = "Share link copied";
  } catch {
    window.prompt("Copy this link", url);
  }
}

async function updateOwnShare(share: ShareSummary, updates: {
  customSlug?: string;
  passwordEnabled?: boolean;
  password?: string;
}) {
  const payload = await api<{ share: ShareSummary | null }>(`/api/shares/${encodeURIComponent(share.filename)}`, {
    method: "PUT",
    body: JSON.stringify({
      readEnabled: share.state === "read",
      editEnabled: share.state === "edit",
      readCustomSlug: share.state === "read" ? updates.customSlug : undefined,
      editCustomSlug: share.state === "edit" ? updates.customSlug : undefined,
      passwordEnabled: updates.passwordEnabled ?? share.hasPassword,
      password: updates.password,
      expiresAt: share.expiresAt ?? undefined
    })
  });

  await loadUserShares();

  if (state.selectedFilename === share.filename && payload.share) {
    await loadShareForFilename(share.filename);
  }

  return payload.share;
}

async function changeOwnShareSlug(share: ShareSummary) {
  const currentSlug = share.state === "edit" ? share.editSlug : share.readSlug;
  const customSlug = window.prompt(`New ${share.state} share slug`, currentSlug ?? "");
  if (!customSlug) {
    return;
  }

  await updateOwnShare(share, { customSlug });
  state.feedback = `${share.state} share slug updated`;
}

async function setOwnSharePassword(share: ShareSummary) {
  const password = window.prompt(`Password for ${share.filename}`);
  if (!password) {
    return;
  }

  await updateOwnShare(share, {
    passwordEnabled: true,
    password
  });
  state.feedback = "Share password updated";
}

async function removeOwnSharePassword(share: ShareSummary) {
  await updateOwnShare(share, { passwordEnabled: false });
  state.feedback = "Share password removed";
}

async function renameFromMenu(filename: string) {
  const note = state.notes.find((item) => item.filename === filename);
  const title = window.prompt("Rename note", note?.displayName ?? "");
  closeContextMenu();
  if (!title) {
    return;
  }
  const renamed = await api<NoteMeta>(`/api/notes/${encodeURIComponent(filename)}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
  await Promise.all([loadNotes(), loadUserShares()]);
  if (state.selectedFilename === filename) {
    await openNote(renamed.filename);
  }
}

async function deleteByFilename(filename: string) {
  const confirmed = window.confirm("Delete this note?");
  closeContextMenu();
  if (!confirmed) {
    return;
  }
  await api(`/api/notes/${encodeURIComponent(filename)}`, { method: "DELETE" });
  if (state.selectedFilename === filename) {
    resetEditorState();
  }
  await Promise.all([loadNotes(), loadUserShares()]);
}

function downloadByFilename(filename: string) {
  closeContextMenu();
  window.open(`/api/notes/${encodeURIComponent(filename)}/download`, "_blank", "noopener");
}

async function copyShareLink(filename: string) {
  closeContextMenu();
  const share = state.userShares.find((item) => item.filename === filename);
  if (!share?.readUrlPath) {
    return;
  }

  const value = `${publicOrigin}${share.readUrlPath}`;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
  state.feedback = "Public link copied";
}

async function verifyPublicEdit() {
  if (!state.publicEditSlug) {
    return;
  }

  state.publicEditLoading = true;
  state.publicEditError = "";
  state.publicEditSuccess = "";
  try {
    const payload = await api<{ success: boolean; grantToken: string }>(`/api/public/edit/${encodeURIComponent(state.publicEditSlug)}/verify`, {
      method: "POST",
      body: JSON.stringify({
        password: state.publicEditPassword
      })
    });
    state.publicEditGrant = payload.grantToken;
    state.publicEditPassword = "";
    await loadPublicEdit();
  } catch (error) {
    state.publicEditError = error instanceof Error ? error.message : "Could not verify edit access";
    state.publicEditGrant = "";
  } finally {
    state.publicEditLoading = false;
  }
}

async function savePublicEditContent() {
  if (!state.publicEditSlug) {
    return;
  }

  state.publicEditSaving = true;
  state.publicEditError = "";
  state.publicEditSuccess = "";
  try {
    const headers = state.publicEditGrant ? { "X-Public-Edit-Grant": state.publicEditGrant } : undefined;
    const payload = await api<{ success: boolean; filename: string; editCount: number; version: number; updatedAt: string }>(
      `/api/public/edit/${encodeURIComponent(state.publicEditSlug)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          content: state.publicEditContent,
          baseVersion: state.publicEditVersion
        })
      }
    );
    state.publicEditFilename = payload.filename;
    state.publicEditVersion = payload.version;
    state.publicEditDirty = false;
    state.publicEditRemoteUpdatePending = false;
    state.publicEditConflict = false;
    state.publicEditConflictServerVersion = 0;
    state.publicEditConflictServerContent = "";
    state.publicEditConflictUpdatedAt = "";
    state.publicEditSuccess = "Changes were saved";
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const payload = error.data as {
        error?: string;
        serverVersion?: number;
        serverContent?: string;
        updatedAt?: string;
        message?: string;
      };
      if (payload.error === "VERSION_CONFLICT") {
        state.publicEditConflict = true;
        state.publicEditConflictServerVersion = payload.serverVersion ?? 0;
        state.publicEditConflictServerContent = payload.serverContent ?? "";
        state.publicEditConflictUpdatedAt = payload.updatedAt ?? "";
        state.publicEditRemoteUpdatePending = true;
        state.publicEditError = payload.message ?? "This note was updated elsewhere.";
        return;
      }
    }
    state.publicEditError = error instanceof Error ? error.message : "Could not save note";
  } finally {
    state.publicEditSaving = false;
  }
}

function scheduleAutosave() {
  if (!state.isDirty || state.saving || state.isCreatingNew || !state.selectedFilename) {
    return;
  }

  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
  }

  autosaveTimer = window.setTimeout(async () => {
    if (!state.isDirty || state.saving || state.isCreatingNew || !state.selectedFilename) {
      return;
    }

    state.saving = true;
    state.feedback = "Autosaving...";
    try {
      const updateResult = await api<{ success: true; version: number; updatedAt: string }>(`/api/notes/${encodeURIComponent(state.selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({
          content: state.editorContent,
          baseVersion: state.editorVersion
        })
      });
      state.editorVersion = updateResult.version;
      state.noteRemoteUpdatePending = false;
      state.noteConflict = false;
      const existing = selectedNote.value;
      if (existing) {
        upsertLocalNote({
          ...existing,
          updatedAt: updateResult.updatedAt,
          version: updateResult.version
        });
      }
      state.isDirty = false;
      state.feedback = "Saved automatically";
      if (state.historyPanelOpen) {
        await loadNoteHistory({ preservePreview: true });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const payload = error.data as {
          error?: string;
          serverVersion?: number;
          serverContent?: string;
          updatedAt?: string;
          message?: string;
        };
        if (payload.error === "VERSION_CONFLICT") {
          state.noteConflict = true;
          state.noteConflictServerVersion = payload.serverVersion ?? 0;
          state.noteConflictServerContent = payload.serverContent ?? "";
          state.noteConflictUpdatedAt = payload.updatedAt ?? "";
          state.noteRemoteUpdatePending = true;
          state.isDirty = true;
          state.feedback = payload.message ?? "This note was updated elsewhere.";
          return;
        }
      }
      throw error;
    } finally {
      state.saving = false;
    }
  }, 1200);
}

async function reloadRemoteVersion() {
  if (!state.selectedFilename) {
    return;
  }
  await openNote(state.selectedFilename);
  state.feedback = "Reloaded remote version";
}

function keepLocalChanges() {
  state.noteRemoteUpdatePending = false;
  state.feedback = "Keeping local changes";
}

async function reloadRemotePublicEditVersion() {
  await loadPublicEdit();
  state.publicEditSuccess = "";
  state.publicEditError = "";
  state.publicEditRemoteUpdatePending = false;
  state.publicEditConflict = false;
  state.publicEditConflictServerVersion = 0;
  state.publicEditConflictServerContent = "";
  state.publicEditConflictUpdatedAt = "";
  state.publicEditSuccess = "Reloaded remote version";
}

function keepLocalPublicEditChanges() {
  state.publicEditRemoteUpdatePending = false;
  state.publicEditSuccess = "";
  state.publicEditError = "Keeping local changes";
}

function connectNoteEvents(filename: string) {
  disconnectNoteEvents();
  noteEvents = new EventSource(`/api/notes/${encodeURIComponent(filename)}/events`, { withCredentials: true });
  noteEvents.onmessage = (event) => {
    const payload = JSON.parse(event.data) as { type: string; filename: string; version: number; updatedAt: string };
    if (payload.type !== "note-updated" || payload.filename !== state.selectedFilename || payload.version <= state.editorVersion) {
      return;
    }
    state.noteRemoteVersion = payload.version;
    state.noteRemoteUpdatedAt = payload.updatedAt;
    if (state.isDirty) {
      state.noteRemoteUpdatePending = true;
      return;
    }
    void reloadRemoteVersion();
  };
  noteEvents.onerror = () => {
    noteEvents?.close();
    noteEvents = undefined;
    if (noteEventsReconnectTimer) {
      window.clearTimeout(noteEventsReconnectTimer);
    }
    noteEventsReconnectTimer = window.setTimeout(() => {
      if (state.selectedFilename === filename && state.authenticated && state.currentView === "editor") {
        connectNoteEvents(filename);
      }
    }, 3000);
  };
}

function connectPublicEditEvents() {
  disconnectPublicEditEvents();
  if (!state.publicEditSlug || (state.publicEditRequiresPassword && !state.publicEditGrant)) {
    return;
  }
  const url = new URL(`/api/public/edit/${encodeURIComponent(state.publicEditSlug)}/events`, window.location.origin);
  if (state.publicEditGrant) {
    url.searchParams.set("grantToken", state.publicEditGrant);
  }
  publicEditEvents = new EventSource(url.toString(), { withCredentials: true });
  publicEditEvents.onmessage = (event) => {
    const payload = JSON.parse(event.data) as { type: string; version: number; updatedAt: string };
    if (payload.type !== "note-updated" || payload.version <= state.publicEditVersion) {
      return;
    }
    state.publicEditRemoteVersion = payload.version;
    state.publicEditRemoteUpdatedAt = payload.updatedAt;
    if (state.publicEditDirty) {
      state.publicEditRemoteUpdatePending = true;
      return;
    }
    void reloadRemotePublicEditVersion();
  };
  publicEditEvents.onerror = () => {
    publicEditEvents?.close();
    publicEditEvents = undefined;
    if (publicEditEventsReconnectTimer) {
      window.clearTimeout(publicEditEventsReconnectTimer);
    }
    publicEditEventsReconnectTimer = window.setTimeout(() => {
      if (state.publicEditSlug && (!state.publicEditRequiresPassword || Boolean(state.publicEditGrant))) {
        connectPublicEditEvents();
      }
    }, 3000);
  };
}

async function toggleDotMenu(event: MouseEvent, filename: string) {
  event.stopPropagation();
  const button = event.currentTarget as HTMLElement | null;
  if (!button) {
    return;
  }

  if (state.contextMenuOpen && state.contextMenuFilename === filename) {
    closeContextMenu();
    return;
  }

  state.contextMenuOpen = true;
  state.contextMenuFilename = filename;
  const noteCard = button.closest("[data-note-item]") as HTMLElement | null;
  if (!noteCard) {
    return;
  }

  const scrollContainer =
    (button.closest(".overflow-y-auto") as HTMLElement | null) ??
    (noteCard.parentElement as HTMLElement | null);
  if (!scrollContainer) {
    return;
  }

  const cardRect = noteCard.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const alignRight = `${Math.max(8, cardRect.right - buttonRect.right)}px`;
  state.contextMenuStyle = {
    top: `${Math.max(8, buttonRect.bottom - cardRect.top + 6)}px`,
    right: alignRight
  };

  await nextTick();
  const menuElement = noteCard.querySelector(".menu-pop") as HTMLElement | null;
  const menuHeight = menuElement?.offsetHeight ?? 116;
  const spaceBelow = containerRect.bottom - buttonRect.bottom;
  const spaceAbove = buttonRect.top - containerRect.top;

  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    state.contextMenuStyle = {
      bottom: `${Math.max(8, cardRect.bottom - buttonRect.top + 6)}px`,
      right: alignRight
    };
  }
}

function closeContextMenu() {
  state.contextMenuOpen = false;
  state.contextMenuFilename = "";
}

function applyTheme(theme: ThemeMode) {
  state.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem("textbin-theme", theme);
}

function toggleTheme() {
  applyTheme("light");
}

function onBackgroundClick() {
  closeContextMenu();
}

async function loadAdminUsers() {
  const payload = await api<{ users: AdminUserSummary[] }>("/api/admin/users");
  state.adminUsers = payload.users;
  if (!state.adminSharesUsername) {
    state.adminSharesUsername = "all";
  }
  if (!state.adminNotesUsername) {
    state.adminNotesUsername = "all";
  }
}

async function loadAdminShares() {
  const payload = await api<{ shares: AdminShareSummary[] }>("/api/admin/shares");
  state.adminShares = payload.shares;
}

async function loadAdminNotes(username = state.adminNotesUsername || state.username) {
  state.adminNotesUsername = username;
  if (username === "all") {
    const results = await Promise.all(
      state.adminUsers.map(async (user) => {
        const payload = await api<{ notes: NoteMeta[] }>(
          `/api/admin/notes?username=${encodeURIComponent(user.username)}&sort=created_desc`
        );
        return payload.notes.map((note) => ({
          ...note,
          ownerUsername: user.username
        }));
      })
    );

    state.adminNotes = results
      .flat()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    return;
  }

  const payload = await api<{ notes: NoteMeta[] }>(
    `/api/admin/notes?username=${encodeURIComponent(username)}&sort=created_desc`
  );
  state.adminNotes = payload.notes.map((note) => ({
    ...note,
    ownerUsername: username
  }));
}

async function loadAdminSettings() {
  const payload = await api<{ settings: InstanceSettings }>("/api/admin/settings");
  state.settings = payload.settings;
}

async function loadAdminUserSessions(userId: number, username: string) {
  state.adminUserSessionsLoading = true;
  state.adminUserSessionsTarget = username;
  try {
    const payload = await api<{ user: { username: string }; sessions: SessionSummary[] }>(`/api/admin/users/${userId}/sessions`);
    state.adminUserSessions = payload.sessions;
  } finally {
    state.adminUserSessionsLoading = false;
  }
}

async function loadAdminSessions(username: string = state.adminSessionsUsername || "all") {
  state.adminSessionsLoading = true;
  state.adminSessionsUsername = username;
  try {
    if (username === "all") {
      const results = await Promise.all(
        state.adminUsers.map(async (user) => {
          const payload = await api<{ user: { username: string }; sessions: SessionSummary[] }>(`/api/admin/users/${user.id}/sessions`);
          return payload.sessions.map((session) => ({
            ...session,
            username: user.username,
            userId: user.id
          }));
        })
      );
      state.adminSessions = results.flat().sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
      return;
    }

    const targetUser = state.adminUsers.find((user) => user.username === username);
    if (!targetUser) {
      state.adminSessions = [];
      return;
    }

    const payload = await api<{ user: { username: string }; sessions: SessionSummary[] }>(`/api/admin/users/${targetUser.id}/sessions`);
    state.adminSessions = payload.sessions.map((session) => ({
      ...session,
      username: targetUser.username,
      userId: targetUser.id
    }));
  } finally {
    state.adminSessionsLoading = false;
  }
}

async function openAccountSettings(tab: AccountTab = state.accountTab) {
  state.currentView = "account";
  state.accountTab = tab;
  updateDocumentTitle();
  await Promise.all([loadUserShares(), loadMySessions()]);
}

async function openAdminPanel(tab: AdminTab = state.adminTab) {
  if (!isAdmin.value) {
    return;
  }

  state.currentView = "admin";
  state.adminTab = tab;
  updateDocumentTitle();
  state.adminLoading = true;
  try {
    await Promise.all([loadAdminUsers(), loadAdminShares(), loadAdminSettings()]);
    if (tab === "sessions" && !state.adminSessionsUsername) {
      state.adminSessionsUsername = "all";
    }
    if (tab === "shares" && !state.adminSharesUsername) {
      state.adminSharesUsername = "all";
    }
    if (tab === "notes" && !state.adminNotesUsername) {
      state.adminNotesUsername = "all";
    }
    if (tab === "notes") {
      await loadAdminNotes(state.adminNotesUsername || "all");
    }
    if (tab === "sessions") {
      await loadAdminSessions(state.adminSessionsUsername || "all");
    }
  } finally {
    state.adminLoading = false;
  }
}

async function createAdminUser() {
  const username = state.adminCreateUsername.trim().toLowerCase();
  const password = state.adminCreatePassword;
  if (!username || password.length < 8) {
    state.feedback = "Username and 8+ character password are required";
    return;
  }

  await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      role: state.adminCreateRole
    })
  });

  state.adminCreateUsername = "";
  state.adminCreatePassword = "";
  state.adminCreateRole = "user";
  state.feedback = "User created";
  await loadAdminUsers();
  await loadAdminNotes(state.adminNotesUsername || state.username);
}

async function resetUserPassword(user: AdminUserSummary) {
  const password = window.prompt(`New password for ${user.username}`);
  if (!password) {
    return;
  }

  await api(`/api/admin/users/${user.id}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password })
  });
  state.feedback = `Password updated for ${user.username}`;
}

async function toggleUserRole(user: AdminUserSummary) {
  const role: UserRole = user.role === "admin" ? "user" : "admin";
  await api(`/api/admin/users/${user.id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role })
  });
  await loadAdminUsers();
  state.feedback = `${user.username} is now ${role}`;
}

async function toggleUserBlocked(user: AdminUserSummary) {
  await api(`/api/admin/users/${user.id}/block`, {
    method: "PATCH",
    body: JSON.stringify({ blocked: !user.blocked })
  });
  await loadAdminUsers();
  state.feedback = user.blocked ? `${user.username} unblocked` : `${user.username} blocked`;
}

async function deleteUser(user: AdminUserSummary) {
  if (!window.confirm(`Delete user ${user.username} and all of their notes?`)) {
    return;
  }

  await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
  if (state.adminNotesUsername === user.username) {
    state.adminNotesUsername = state.username;
  }
  await loadAdminUsers();
  await Promise.all([loadAdminNotes(state.adminNotesUsername || state.username), loadAdminShares()]);
  state.feedback = `${user.username} deleted`;
}

async function revokeMySession(session: SessionSummary) {
  if (session.current && !window.confirm("Revoke your current session and log out?")) {
    return;
  }

  const payload = await api<{ success: boolean; revokedCurrent: boolean }>(`/api/me/sessions/${session.id}`, {
    method: "DELETE"
  });

  if (payload.revokedCurrent) {
    clearAuthState();
    history.replaceState({}, "", "/login");
    return;
  }

  await loadMySessions();
  state.feedback = "Session revoked";
}

async function revokeOtherSessions() {
  await api("/api/me/sessions/revoke-others", { method: "POST" });
  await loadMySessions();
  state.feedback = "Other sessions revoked";
}

async function changeOwnPassword() {
  if (!state.accountPasswordCurrent || state.accountPasswordNext.length < 8) {
    state.feedback = "Current password and 8+ character new password are required";
    return;
  }

  if (state.accountPasswordNext !== state.accountPasswordConfirm) {
    state.feedback = "New passwords do not match";
    return;
  }

  state.accountPasswordSaving = true;
  try {
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: state.accountPasswordCurrent,
        newPassword: state.accountPasswordNext
      })
    });
    state.accountPasswordCurrent = "";
    state.accountPasswordNext = "";
    state.accountPasswordConfirm = "";
    await loadMySessions();
    state.feedback = "Password updated";
  } finally {
    state.accountPasswordSaving = false;
  }
}

async function adminRevokeSession(session: SessionSummary) {
  await api(`/api/admin/sessions/${session.id}`, {
    method: "DELETE"
  });
  await loadAdminSessions(state.adminSessionsUsername || "all");
  state.feedback = "Admin session revoked";
}

async function adminChangeShareSlug(share: AdminShareSummary, kind: "read" | "edit") {
  const currentSlug = kind === "edit" ? share.editSlug : share.readSlug;
  const customSlug = window.prompt(`New ${kind} share slug`, currentSlug ?? "");
  if (!customSlug) {
    return;
  }

  await api(`/api/admin/shares/${share.id}`, {
    method: "PATCH",
    body: JSON.stringify({ kind, customSlug })
  });
  await loadAdminShares();
  state.feedback = `${kind} share slug updated`;
}

async function adminSetSharePassword(share: AdminShareSummary) {
  const password = window.prompt(`Password for ${share.filename}`);
  if (!password) {
    return;
  }

  await api(`/api/admin/shares/${share.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      passwordEnabled: true,
      password
    })
  });
  await loadAdminShares();
  state.feedback = "Share password updated";
}

async function adminRemoveSharePassword(share: AdminShareSummary) {
  await api(`/api/admin/shares/${share.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      passwordEnabled: false
    })
  });
  await loadAdminShares();
  state.feedback = "Share password removed";
}

async function adminDeleteShare(share: AdminShareSummary) {
  if (!window.confirm(`Delete public link for ${share.filename}?`)) {
    return;
  }

  await api(`/api/admin/shares/${share.id}`, { method: "DELETE" });
  await loadAdminShares();
  state.feedback = "Share deleted";
}

async function adminRenameNote(note: NoteMeta) {
  const title = window.prompt("Rename note", note.displayName);
  if (!title) {
    return;
  }

  const ownerUsername = note.ownerUsername ?? state.adminNotesUsername;

  await api(`/api/admin/notes/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(note.filename)}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
  await Promise.all([loadAdminNotes(state.adminNotesUsername), loadAdminShares()]);
  state.feedback = "Note renamed";
}

function adminDownloadNote(note: NoteMeta) {
  const ownerUsername = note.ownerUsername ?? state.adminNotesUsername;
  window.open(
    `/api/admin/notes/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(note.filename)}/download`,
    "_blank",
    "noopener"
  );
}

async function adminDeleteNote(note: NoteMeta) {
  if (!window.confirm(`Delete ${note.displayName}?`)) {
    return;
  }

  const ownerUsername = note.ownerUsername ?? state.adminNotesUsername;

  await api(`/api/admin/notes/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(note.filename)}`, {
    method: "DELETE"
  });
  await Promise.all([loadAdminNotes(state.adminNotesUsername), loadAdminShares(), loadAdminUsers()]);
  state.feedback = "Note deleted";
}

async function saveAdminSettings() {
  state.adminSettingsSaving = true;
  state.adminSettingsSuccess = "";
  try {
    const payload = await api<{ settings: InstanceSettings }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(state.settings)
    });
    state.settings = payload.settings;
    state.feedback = "Settings saved";
    state.adminSettingsSuccess = "Settings saved";
    window.setTimeout(() => {
      if (state.adminSettingsSuccess === "Settings saved") {
        state.adminSettingsSuccess = "";
      }
    }, 2200);
  } finally {
    state.adminSettingsSaving = false;
  }
}

onMounted(() => {
  applyTheme("light");

  const shareMatch = window.location.pathname.match(/^\/s\/([^/]+)$/);
  if (shareMatch) {
    state.publicShareSlug = shareMatch[1];
    void loadPublicShare();
    window.addEventListener("click", onBackgroundClick);
    return;
  }

  const editMatch = window.location.pathname.match(/^\/e\/([^/]+)$/);
  if (editMatch) {
    state.publicEditSlug = editMatch[1];
    state.publicEditGrant = "";
    void loadPublicEdit();
    window.addEventListener("click", onBackgroundClick);
    return;
  }

  if (window.location.pathname === "/login") {
    state.ready = true;
    window.addEventListener("click", onBackgroundClick);
    return;
  }

  void loadSession();
  window.addEventListener("click", onBackgroundClick);
  window.addEventListener("wheel", handleGlobalEditorWheel as EventListener, { passive: false, capture: true });
  window.addEventListener("wheel", handleAltEditorWheel as EventListener, { passive: false, capture: true });
  document.addEventListener("wheel", handleGlobalEditorWheel as EventListener, { passive: false, capture: true });
  document.addEventListener("wheel", handleAltEditorWheel as EventListener, { passive: false, capture: true });
  window.addEventListener("mousewheel", handleLegacyEditorWheel as EventListener, { passive: false, capture: true });
  document.addEventListener("mousewheel", handleLegacyEditorWheel as EventListener, { passive: false, capture: true });
  window.addEventListener("keydown", handleEditorKeyZoom as EventListener, true);
  document.addEventListener("keydown", handleEditorKeyZoom as EventListener, true);
  window.addEventListener("keydown", handleGlobalEscape as EventListener, true);
  document.addEventListener("keydown", handleGlobalEscape as EventListener, true);
});

watch(
  () => [state.currentView, state.selectedFilename, state.isCreatingNew] as const,
  async () => {
    await nextTick();
    state.settings.defaultTheme = "light";
    updateDocumentTitle();
  }
);

onBeforeUnmount(() => {
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
  }
  window.removeEventListener("wheel", handleGlobalEditorWheel as EventListener, true);
  window.removeEventListener("wheel", handleAltEditorWheel as EventListener, true);
  document.removeEventListener("wheel", handleGlobalEditorWheel as EventListener, true);
  document.removeEventListener("wheel", handleAltEditorWheel as EventListener, true);
  window.removeEventListener("mousewheel", handleLegacyEditorWheel as EventListener, true);
  document.removeEventListener("mousewheel", handleLegacyEditorWheel as EventListener, true);
  window.removeEventListener("keydown", handleEditorKeyZoom as EventListener, true);
  document.removeEventListener("keydown", handleEditorKeyZoom as EventListener, true);
  window.removeEventListener("keydown", handleGlobalEscape as EventListener, true);
  document.removeEventListener("keydown", handleGlobalEscape as EventListener, true);
  window.removeEventListener("click", onBackgroundClick);
});
</script>

<template>
  <div class="retro-app min-h-screen w-full overflow-x-hidden px-2 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5" :style="{ color: 'var(--vp-c-text-1)' }">
    <div
      v-if="!state.ready"
      class="flex min-h-[calc(100vh-3rem)] items-center justify-center text-sm"
      :style="{ color: 'var(--vp-c-text-2)' }"
    >
      Loading TextBin...
    </div>

    <div v-else-if="isPublicShareView" class="retro-login-shell mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
      <div class="glass-panel retro-window retro-public-window w-full rounded-3xl p-6 sm:p-8" data-window-title="PUBLIC READ LINK">
        <div class="mb-6">
          <p class="retro-hero-label text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Shared note</p>
          <h1 class="mt-3 text-3xl font-semibold tracking-tight">
            {{ state.publicShareFilename || "Public text" }}
          </h1>
          <p class="mt-3 text-sm leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
            Read-only public view from TextBin.
          </p>
        </div>

        <div v-if="state.publicShareLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
          Loading shared note...
        </div>

        <div v-else-if="state.publicShareRequiresPassword" class="space-y-4">
          <p class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">This public link is password protected.</p>
          <input
            v-model="state.publicSharePassword"
            type="password"
            placeholder="Enter password"
            class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
          />
          <p v-if="state.publicShareError" class="text-sm" :style="{ color: 'var(--danger)' }">{{ state.publicShareError }}</p>
          <button
            class="rounded-2xl px-4 py-3 text-sm font-medium transition"
            :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
            @click="loadPublicShare"
          >
            Open note
          </button>
        </div>

        <div v-else>
          <p v-if="state.publicShareError" class="mb-4 text-sm" :style="{ color: 'var(--danger)' }">{{ state.publicShareError }}</p>
          <textarea
            :value="state.publicShareContent"
            readonly
            class="surface-soft retro-editor-area min-h-[60vh] w-full resize-none rounded-3xl border p-5 text-sm leading-7 outline-none"
            :style="{ color: 'var(--vp-c-text-1)' }"
            spellcheck="false"
          />
        </div>
      </div>
    </div>

    <div v-else-if="isPublicEditView" class="retro-login-shell mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
      <div class="glass-panel retro-window retro-public-window w-full rounded-3xl p-6 sm:p-8" data-window-title="PUBLIC EDIT LINK">
        <div class="mb-6">
          <p class="retro-hero-label text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Editable note</p>
          <h1 class="mt-3 text-3xl font-semibold tracking-tight">
            {{ state.publicEditFilename || "Editable text" }}
          </h1>
          <p class="mt-3 text-sm leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
            Anyone with this link can edit this note.
          </p>
        </div>

        <div v-if="state.publicEditLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
          Loading editable note...
        </div>

        <div v-else-if="state.publicEditRequiresPassword" class="space-y-4">
          <p class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">This editable link is password protected.</p>
          <input
            v-model="state.publicEditPassword"
            type="password"
            placeholder="Enter password"
            class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
          />
          <p v-if="state.publicEditError" class="text-sm" :style="{ color: 'var(--danger)' }">{{ state.publicEditError }}</p>
          <button
            class="rounded-2xl px-4 py-3 text-sm font-medium transition"
            :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
            @click="verifyPublicEdit"
          >
            Open editor
          </button>
        </div>

        <div v-else>
          <p v-if="state.publicEditError" class="mb-4 text-sm" :style="{ color: 'var(--danger)' }">{{ state.publicEditError }}</p>
          <div
            v-if="state.publicEditRemoteUpdatePending"
            class="mb-4 rounded-2xl border px-4 py-3 text-sm"
            :style="{ borderColor: 'var(--danger)', background: 'var(--panel-muted)' }"
          >
            <p :style="{ color: 'var(--danger)' }">
              {{ state.publicEditConflict ? "Your changes were not saved because this note was updated elsewhere." : "This note was updated on another device." }}
            </p>
            <p v-if="state.publicEditRemoteUpdatedAt || state.publicEditConflictUpdatedAt" class="mt-2 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
              Remote version:
              {{ state.publicEditConflict ? state.publicEditConflictServerVersion : state.publicEditRemoteVersion }}
              • Updated:
              {{ formatDate(state.publicEditConflict ? state.publicEditConflictUpdatedAt : state.publicEditRemoteUpdatedAt) }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition" @click="reloadRemotePublicEditVersion">
                Reload remote version
              </button>
              <button class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition" @click="keepLocalPublicEditChanges">
                Keep local changes
              </button>
            </div>
          </div>
          <textarea
            v-model="state.publicEditContent"
            class="surface-soft retro-editor-area min-h-[60vh] w-full resize-none rounded-3xl border p-5 text-sm leading-7 outline-none"
            :style="{ color: 'var(--vp-c-text-1)' }"
            spellcheck="false"
            @input="
              state.publicEditDirty = true;
              state.publicEditSuccess = '';
            "
          />
          <div class="mt-4 flex items-center justify-between gap-4">
            <p v-if="state.publicEditSuccess" class="retro-success-text text-sm" :style="{ color: 'var(--vp-c-green-2)' }">{{ state.publicEditSuccess }}</p>
            <div class="ml-auto">
            <button
              class="rounded-2xl px-4 py-3 text-sm font-medium transition disabled:opacity-70"
              :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
              :disabled="state.publicEditSaving || !state.publicEditDirty"
              @click="savePublicEditContent"
            >
              {{ state.publicEditSaving ? "Saving..." : "Save changes" }}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="!state.authenticated"
      class="retro-login-shell mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center"
    >
      <div class="glass-panel retro-window retro-login-window w-full max-w-md rounded-3xl p-8" data-window-title="TEXTBIN LOGIN">
        <div class="mb-8">
          <p class="retro-hero-label text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Private Text Vault</p>
          <h1 class="mt-3 text-4xl font-semibold tracking-tight">TextBin</h1>
          <p class="mt-3 text-sm leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
            Sign in to access your plain text workspace. Plain text only, private by default.
          </p>
        </div>

        <form class="space-y-4" @submit.prevent="login">
          <label class="block">
            <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Username</span>
            <input
              v-model="state.loginUsername"
              type="text"
              autocomplete="username"
              class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
              :style="{ color: 'var(--vp-c-text-1)' }"
            />
          </label>

          <label class="block">
            <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Password</span>
            <input
              v-model="state.loginPassword"
              type="password"
              autocomplete="current-password"
              class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
              :style="{ color: 'var(--vp-c-text-1)' }"
            />
          </label>

          <p v-if="state.loginError" class="text-sm" :style="{ color: 'var(--danger)' }">{{ state.loginError }}</p>

          <button
            type="submit"
            class="w-full rounded-2xl px-4 py-3 text-sm font-medium transition"
            :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
          >
            Log In
          </button>
        </form>
      </div>
    </div>

    <div v-else class="retro-shell mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl min-w-0 flex-col gap-3 lg:h-[calc(100vh-3rem)] lg:min-h-0 lg:max-w-[1680px] lg:flex-row">
      <div class="glass-panel retro-window retro-mobile-panel flex w-full min-w-0 flex-col gap-3 rounded-3xl p-4 lg:hidden" data-window-title="TEXTBIN SESSION">
        <div>
          <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Signed in</p>
          <p class="mt-1 text-sm font-semibold">{{ state.username }}</p>
        </div>
        <button
          v-if="isAdmin"
          class="action-button rounded-xl border px-3 py-2 text-sm transition"
          :class="state.currentView === 'admin' ? 'surface-note-active' : 'surface-soft'"
          :style="{ color: 'var(--vp-c-text-1)' }"
          @click="openAdminPanel('users')"
        >
          Admin Panel
        </button>
        <div class="flex w-full min-w-0 gap-2">
          <button
            class="action-button inline-flex min-w-0 flex-1 items-center justify-center rounded-xl border px-3 py-2 text-sm transition"
            :class="state.currentView === 'account' ? 'surface-note-active' : 'surface-soft'"
            :style="{ color: 'var(--vp-c-text-1)' }"
            aria-label="Account settings"
            title="Account settings"
            @click="openAccountSettings('sessions')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path fill="currentColor" d="M9 3h4v1h1v1h1v4h-1v1h-1v1H9v-1H8V9H7V5h1V4h1zm1 5v1h2V8h1V6h-1V5h-2v1H9v2zm-3 4h8v1h2v1h1v1h1v4H3v-4h1v-1h1v-1h2zm-1 4H5v1h12v-1h-1v-1h-2v-1H8v1H6z"/>
            </svg>
          </button>
          <button
            class="surface-soft action-button danger-button inline-flex min-w-0 flex-1 items-center justify-center rounded-xl border px-3 py-2 text-sm transition"
            :style="{ color: 'var(--vp-c-text-1)' }"
            aria-label="Log out"
            title="Log out"
            @click="logout"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path fill="currentColor" d="M3 21V3h9v2H5v14h7v2zm13-4l-1.375-1.45l2.55-2.55H9v-2h8.175l-2.55-2.55L16 7l5 5z"/>
            </svg>
          </button>
        </div>
      </div>

      <aside class="glass-panel retro-window retro-sidebar hidden w-full max-w-[320px] flex-col overflow-hidden rounded-3xl p-4 lg:flex lg:h-full lg:max-w-[360px]" data-window-title="NAVIGATOR">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Signed in</p>
            <p class="mt-1 text-sm font-semibold">{{ state.username }}</p>
            <p class="mt-1 text-xs uppercase tracking-[0.2em]" :style="{ color: 'var(--vp-c-text-3)' }">{{ state.role }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="action-button rounded-xl border px-3 py-2 text-sm transition"
              :class="state.currentView === 'account' ? 'surface-note-active' : 'surface-soft'"
              :style="{ color: 'var(--vp-c-text-1)' }"
              aria-label="Account settings"
              title="Account settings"
              @click="openAccountSettings('sessions')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 4a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4m0 2a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2m0 7c2.67 0 8 1.33 8 4v3H4v-3c0-2.67 5.33-4 8-4m0 1.9c-2.97 0-6.1 1.46-6.1 2.1v1.1h12.2V17c0-.64-3.13-2.1-6.1-2.1"/></svg>
            </button>
            <button
              class="surface-soft action-button danger-button inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm transition"
              :style="{ color: 'var(--vp-c-text-1)' }"
              aria-label="Log out"
              title="Log out"
              @click="logout"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path fill="currentColor" d="M3 21V3h9v2H5v14h7v2zm13-4l-1.375-1.45l2.55-2.55H9v-2h8.175l-2.55-2.55L16 7l5 5z"/>
              </svg>
            </button>
          </div>
        </div>

        <button
          v-if="isAdmin"
          class="action-button mb-3 rounded-2xl border px-4 py-3 text-sm transition"
          :class="state.currentView === 'admin' ? 'surface-note-active' : 'surface-soft'"
          :style="{ color: 'var(--vp-c-text-1)' }"
          @click="openAdminPanel('users')"
        >
          Admin Panel
        </button>
        <button
          class="mb-4 rounded-2xl px-4 py-3 text-sm font-medium transition"
          :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
          @click="createNewNote"
        >
          Create Note
        </button>

        <label class="mb-4 relative block">
          <span
            class="pointer-events-none absolute left-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center"
            :style="{ color: 'var(--vp-c-text-1)' }"
            aria-hidden="true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path fill="currentColor" d="M20 8v2h-1v1H5v-1H4V8h1V7h1V6h1V5h1V4h1V3h1V2h1V1h2v1h1v1h1v1h1v1h1v1h1v1h1v1zm0 6v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1H9v-1H8v-1H7v-1H6v-1H5v-1H4v-2h1v-1h14v1z"/>
            </svg>
          </span>
          <select
            v-model="state.sort"
            class="surface-soft block w-full min-w-0 rounded-2xl border py-3 pl-12 pr-3 text-sm outline-none transition"
            :style="{ color: 'var(--vp-c-text-1)' }"
            @change="changeSort"
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
          </select>
        </label>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <div v-if="state.loadingNotes" class="px-2 py-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Loading notes...</div>
          <div v-else-if="state.notes.length === 0" class="px-2 py-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">No notes yet.</div>

          <div
            v-for="note in state.notes"
            :key="note.filename"
            data-note-item
            class="retro-note-row relative mb-2 flex w-full items-stretch gap-2"
          >
            <button
              class="retro-note-button surface-soft action-button min-w-0 flex-1 rounded-2xl border text-left transition"
              :class="[
                state.selectedFilename === note.filename && state.currentView === 'editor' ? 'surface-note-active' : '',
                userShareFilenameSet.has(note.filename) ? 'retro-note-shared' : ''
              ]"
              @click="openNote(note.filename)"
            >
              <p class="retro-note-label truncate text-sm font-semibold">{{ note.displayName }}</p>
              <p class="retro-note-meta mt-1 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
                {{ formatDate(note.updatedAt) }}
              </p>
            </button>
            <button
              class="retro-note-menu-button surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
              :style="{ color: 'var(--vp-c-text-2)' }"
              aria-label="Note actions"
              @click="toggleDotMenu($event, note.filename)"
            >
              ...
            </button>

            <div
              v-if="state.contextMenuOpen && state.contextMenuFilename === note.filename"
              class="menu-pop absolute z-20 w-44 rounded-2xl p-2"
              :style="state.contextMenuStyle"
            >
              <button class="surface-soft action-button block w-full rounded-xl border px-3 py-2 text-left text-sm transition" @click="renameFromMenu(note.filename)">
                Rename
              </button>
              <button class="surface-soft action-button block w-full rounded-xl border px-3 py-2 text-left text-sm transition" @click="downloadByFilename(note.filename)">
                Download
              </button>
              <button
                v-if="userShareFilenameSet.has(note.filename)"
                class="surface-soft action-button block w-full rounded-xl border px-3 py-2 text-left text-sm transition"
                @click="copyShareLink(note.filename)"
              >
                Copy link
              </button>
              <button
                class="danger-soft danger-button block w-full rounded-xl border px-3 py-2 text-left text-sm transition"
                :style="{ color: 'var(--danger)' }"
                @click="deleteByFilename(note.filename)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main
        class="retro-window retro-workspace flex min-h-[70vh] min-w-0 flex-1 flex-col gap-4 rounded-3xl p-4 lg:min-h-0 lg:h-full"
        :data-window-title="state.currentView === 'admin' ? 'ADMIN PANEL' : state.currentView === 'account' ? 'ACCOUNT SETTINGS' : state.selectedFilename || (state.isCreatingNew ? 'NEW NOTE' : 'TEXTBIN WORKSPACE')"
      >
        <div class="glass-panel retro-window rounded-3xl p-4 lg:hidden" data-window-title="MOBILE ACTIONS">
          <div class="mb-3 flex gap-2">
            <button
              class="flex-1 rounded-2xl px-4 py-3 text-sm font-medium transition"
              :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
              @click="createNewNote"
            >
              Create Note
            </button>
          </div>

          <label class="relative block w-full min-w-0">
            <span
              class="pointer-events-none absolute left-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center"
              :style="{ color: 'var(--vp-c-text-1)' }"
              aria-hidden="true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <path d="M0 0h48v48H0z" fill="none" />
                <g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4">
                  <path d="M8 6a2 2 0 0 1 2-2h20l10 10v28a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" />
                  <path stroke-linecap="round" d="M16 20h16m-16 8h16" />
                </g>
              </svg>
            </span>
            <select
              :value="state.selectedFilename"
              class="surface-soft block w-full min-w-0 rounded-2xl border py-3 pl-12 pr-3 text-sm outline-none transition"
              :style="{ color: 'var(--vp-c-text-1)' }"
              @change="
                ($event) => {
                  const value = ($event.target as HTMLSelectElement).value;
                  void openNote(value);
                }
              "
            >
              <option value="">Select note</option>
              <option v-for="note in state.notes" :key="`mobile-${note.filename}`" :value="note.filename">
                {{ note.displayName }}
              </option>
            </select>
          </label>
        </div>

        <div class="glass-panel retro-main-panel relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-3xl p-4 sm:p-6 lg:min-h-0 lg:p-7">
          <div v-if="state.currentView === 'admin'" class="flex h-full min-h-0 flex-col gap-4">
            <div class="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between" :style="{ borderColor: 'var(--vp-c-divider)' }">
              <div>
                <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Admin panel</p>
                <h2 class="mt-1 text-2xl font-semibold">Control center</h2>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="tab in adminTabs"
                  :key="tab"
                  class="rounded-2xl border px-4 py-2 text-sm transition"
                  :class="state.adminTab === tab ? 'surface-note-active' : 'surface-soft'"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  @click="
                    () => {
                      state.adminTab = tab;
                      void openAdminPanel(tab);
                    }
                  "
                >
                  {{ tab }}
                </button>
                <button class="surface-soft action-button rounded-2xl border px-4 py-2 text-sm transition" @click="state.currentView = 'editor'">
                  Back to notes
                </button>
              </div>
            </div>

            <div v-if="state.adminLoading" class="flex flex-1 items-center justify-center text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
              Loading admin data...
            </div>

            <template v-else>
              <div v-if="state.adminTab === 'users'" class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <div class="glass-panel rounded-3xl p-4">
                  <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Create user</p>
                  <h3 class="mt-1 text-lg font-semibold">New account</h3>
                  <div class="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]">
                    <input
                      v-model="state.adminCreateUsername"
                      type="text"
                      placeholder="username"
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    />
                    <input
                      v-model="state.adminCreatePassword"
                      type="password"
                      placeholder="password"
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    />
                    <select
                      v-model="state.adminCreateRole"
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      class="w-full rounded-2xl px-4 py-3 text-sm font-medium transition xl:min-w-[160px]"
                      :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                      @click="createAdminUser"
                    >
                      Create user
                    </button>
                  </div>
                  <p class="mt-3 text-xs leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
                    Current passwords are never retrievable from the server. Use reset password when needed.
                  </p>
                </div>

                <div class="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl p-4">
                  <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Active users</p>
                      <h3 class="mt-1 text-lg font-semibold">{{ filteredAdminUsers.length }} users</h3>
                    </div>
                    <select
                      v-model="state.adminUsersFilter"
                      class="surface-soft rounded-2xl border px-3 py-2 text-sm outline-none"
                    >
                      <option value="all">All roles</option>
                      <option value="user">Users only</option>
                      <option value="admin">Admins only</option>
                    </select>
                  </div>

                  <div class="h-full min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    <div v-for="user in filteredAdminUsers" :key="user.id" class="surface-soft rounded-2xl border p-4">
                      <div class="flex flex-col gap-4">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <p class="text-sm font-semibold">{{ user.username }}</p>
                            <span
                              class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
                              :style="getRoleBadgeStyle(user.role)"
                            >
                              {{ user.role }}
                            </span>
                            <span
                              v-if="user.blocked"
                              class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
                              :style="getBlockedBadgeStyle()"
                            >
                              blocked
                            </span>
                          </div>
                          <p class="mt-2 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">Password: ********</p>
                          <div class="mt-3 grid gap-3 text-xs xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                              <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Created</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(user.createdAt) }}</p>
                            </div>
                              <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Updated</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(user.updatedAt) }}</p>
                            </div>
                              <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Notes</p>
                              <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ user.noteCount }}</p>
                            </div>
                          </div>
                        </div>

                        <div class="flex flex-wrap gap-2">
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="resetUserPassword(user)">Reset password</button>
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="toggleUserRole(user)">
                            Make {{ user.role === "admin" ? "user" : "admin" }}
                          </button>
                          <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="toggleUserBlocked(user)">
                            {{ user.blocked ? "Unblock" : "Block" }}
                          </button>
                          <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="deleteUser(user)">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <div v-else-if="state.adminTab === 'sessions'" class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div class="glass-panel min-h-0 overflow-hidden rounded-3xl p-4">
                  <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">User sessions</p>
                      <h3 class="mt-1 text-lg font-semibold">Session overview</h3>
                    </div>
                    <label class="block min-w-[220px]">
                      <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Selected user</span>
                      <select
                        v-model="state.adminSessionsUsername"
                        class="surface-soft w-full rounded-2xl border px-3 py-2 text-sm outline-none"
                        @change="loadAdminSessions(state.adminSessionsUsername)"
                      >
                        <option value="all">All users</option>
                        <option v-for="user in state.adminUsers" :key="`admin-sessions-${user.id}`" :value="user.username">
                          {{ user.username }}
                        </option>
                      </select>
                    </label>
                  </div>

                  <div v-if="state.adminSessionsLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    Loading sessions...
                  </div>

                  <div v-else-if="state.adminSessions.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    No active sessions.
                  </div>

                  <div v-else class="min-h-0 space-y-3 overflow-y-auto pr-1">
                    <div v-for="session in state.adminSessions" :key="`admin-session-${session.id}`" class="surface-soft rounded-2xl border p-4">
                      <div class="flex flex-col gap-4">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <p class="text-sm font-semibold">{{ session.username }}</p>
                          </div>
                          <div class="mt-3 grid gap-3 text-xs md:grid-cols-2 2xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                            <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Created</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.createdAt) }}</p>
                            </div>
                            <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Expires</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.expiresAt) }}</p>
                            </div>
                            <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Last used</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.lastUsedAt) }}</p>
                            </div>
                            <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">IP</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.ip }}</p>
                            </div>
                            <div class="stat-card min-w-0 rounded-2xl px-3 py-2 md:col-span-2 2xl:col-span-2">
                              <p class="uppercase tracking-[0.2em]">User agent</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatUserAgentLabel(session.userAgent) }}</p>
                            </div>
                          </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="adminRevokeSession(session)">
                            Revoke
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="state.adminTab === 'shares'" class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div class="glass-panel min-h-0 overflow-hidden rounded-3xl p-4">
                  <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Active links</p>
                      <h3 class="mt-1 text-lg font-semibold">{{ filteredAdminShares.length }} public links</h3>
                    </div>
                    <label class="block min-w-[220px]">
                      <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Selected user</span>
                      <select
                        v-model="state.adminSharesUsername"
                        class="surface-soft w-full rounded-2xl border px-3 py-2 text-sm outline-none"
                      >
                        <option value="all">All users</option>
                        <option v-for="user in state.adminUsers" :key="`shares-filter-${user.id}`" :value="user.username">
                          {{ user.username }}
                        </option>
                      </select>
                    </label>
                  </div>

                  <div v-if="filteredAdminShares.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    No active public links.
                  </div>

                  <div v-for="share in filteredAdminShares" :key="share.id" class="surface-soft mb-3 rounded-2xl border p-4">
                    <div class="flex flex-col gap-4">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-sm font-semibold">{{ share.filename }}</p>
                          <span
                            class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
                            :style="getRoleBadgeStyle(state.adminUsers.find((user) => user.username === share.username)?.role)"
                          >
                            {{ share.username }}
                          </span>
                        </div>
                        <div class="mt-3 space-y-2 text-sm">
                          <a
                            v-if="share.readUrlPath"
                            class="block truncate underline"
                            :style="{ color: 'var(--accent-strong)' }"
                            :href="`${publicOrigin}${share.readUrlPath}`"
                            target="_blank"
                            rel="noopener"
                          >
                            Read: {{ publicOrigin }}{{ share.readUrlPath }}
                          </a>
                          <a
                            v-if="share.editUrlPath"
                            class="block truncate underline"
                            :style="{ color: 'var(--accent-strong)' }"
                            :href="`${publicOrigin}${share.editUrlPath}`"
                            target="_blank"
                            rel="noopener"
                          >
                            Edit: {{ publicOrigin }}{{ share.editUrlPath }}
                          </a>
                        </div>
                        <div class="mt-3 grid gap-3 text-xs md:grid-cols-2 2xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                          <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">State</p>
                            <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.state }}</p>
                          </div>
                          <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Views</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.viewCount }}</p>
                          </div>
                          <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Edits</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.editCount }}</p>
                          </div>
                          <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Password</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.hasPassword ? "Protected" : "Open" }}</p>
                          </div>
                          <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Updated</p>
                            <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(share.updatedAt) }}</p>
                          </div>
                        </div>
                      </div>

                      <div class="flex flex-wrap gap-2">
                        <button
                          class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                          @click="copyOwnShareLink(share)"
                        >
                          Copy link
                        </button>
                        <button
                          v-if="share.readEnabled"
                          class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                          @click="adminChangeShareSlug(share, 'read')"
                        >
                          Change read link
                        </button>
                        <button
                          v-if="share.editEnabled"
                          class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                          @click="adminChangeShareSlug(share, 'edit')"
                        >
                          Change edit link
                        </button>
                        <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="adminSetSharePassword(share)">
                          {{ share.hasPassword ? "Change password" : "Add password" }}
                        </button>
                        <button
                          v-if="share.hasPassword"
                          class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                          @click="adminRemoveSharePassword(share)"
                        >
                          Remove password
                        </button>
                        <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="adminDeleteShare(share)">
                          Delete link
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="state.adminTab === 'notes'" class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div class="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl p-4">
                  <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Recent notes</p>
                      <h3 class="mt-1 text-lg font-semibold">User notes overview</h3>
                    </div>
                    <label class="block min-w-[220px]">
                      <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Selected user</span>
                      <select
                        v-model="state.adminNotesUsername"
                        class="surface-soft w-full rounded-2xl border px-3 py-2 text-sm outline-none"
                        @change="loadAdminNotes(state.adminNotesUsername)"
                      >
                        <option value="all">All users</option>
                        <option v-for="user in state.adminUsers" :key="`admin-notes-${user.id}`" :value="user.username">
                          {{ user.username }}
                        </option>
                      </select>
                    </label>
                  </div>

                  <div v-if="state.adminNotes.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    No notes for this user.
                  </div>

                  <div v-for="note in state.adminNotes" :key="`admin-note-${note.filename}`" class="surface-soft mb-3 rounded-2xl border p-4">
                    <div class="flex flex-col gap-4">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold">{{ note.displayName }}</p>
                        <p v-if="note.ownerUsername" class="mt-2 text-xs uppercase tracking-[0.2em]" :style="{ color: 'var(--vp-c-text-3)' }">
                          {{ note.ownerUsername }}
                        </p>
                        <div class="mt-3 grid gap-3 text-xs xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Created</p>
                            <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(note.createdAt) }}</p>
                          </div>
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Updated</p>
                            <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(note.updatedAt) }}</p>
                          </div>
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Size</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ note.sizeBytes }} bytes</p>
                          </div>
                        </div>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="adminRenameNote(note)">Rename</button>
                        <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="adminDownloadNote(note)">Download</button>
                        <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="adminDeleteNote(note)">Delete</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div class="glass-panel rounded-3xl p-4">
                  <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Instance settings</p>
                  <h3 class="mt-1 text-lg font-semibold">Default behavior</h3>

                  <div class="mt-4 space-y-4">
                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Default read slug length</span>
                      <input
                        v-model.number="state.settings.defaultReadSlugLength"
                        type="number"
                        min="8"
                        max="64"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                      />
                    </label>

                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Default edit slug length</span>
                      <input
                        v-model.number="state.settings.defaultEditSlugLength"
                        type="number"
                        min="16"
                        max="64"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                      />
                    </label>

                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Share charset</span>
                      <textarea
                        v-model="state.settings.shareCharset"
                        class="surface-soft min-h-[120px] w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                        spellcheck="false"
                      />
                    </label>

                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Max saved revisions per note</span>
                      <input
                        v-model.number="state.settings.maxNoteRevisions"
                        type="number"
                        min="0"
                        max="500"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                      />
                      <span class="mt-2 block text-xs leading-5" :style="{ color: 'var(--vp-c-text-2)' }">
                        Set how many previous copies are kept for each note. Use 0 to disable version history.
                      </span>
                    </label>

                    <button
                      class="rounded-2xl px-4 py-3 text-sm font-medium transition"
                      :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                      :disabled="state.adminSettingsSaving"
                      @click="saveAdminSettings"
                    >
                      Save settings
                    </button>
                    <Transition name="retro-fade">
                      <p v-if="state.adminSettingsSuccess" class="text-sm retro-success-text" :style="{ color: 'var(--vp-c-green-2)' }">
                        {{ state.adminSettingsSuccess }}
                      </p>
                    </Transition>
                  </div>
                </div>

                <div class="glass-panel rounded-3xl p-4">
                  <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Security note</p>
                  <h3 class="mt-1 text-lg font-semibold">What the UI will not reveal</h3>
                  <div class="mt-4 space-y-3 text-sm leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
                    <p>Read-link slug length must stay between 8 and 64 characters.</p>
                    <p>Edit-link slug length must stay between 16 and 64 characters.</p>
                    <p>User passwords are stored as hashes and cannot be shown back in the admin panel.</p>
                    <p>Public-link passwords are also stored as hashes. The UI only allows set, change, or remove actions.</p>
                    <p>Edit links are powerful. Anyone with an enabled edit link can change note content.</p>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-else-if="state.currentView === 'account'" class="flex h-full min-h-0 flex-col gap-4">
            <div class="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between" :style="{ borderColor: 'var(--vp-c-divider)' }">
              <div>
                <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Account settings</p>
                <h2 class="mt-1 text-2xl font-semibold">{{ state.username }}</h2>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="tab in accountTabs"
                  :key="tab"
                  class="rounded-2xl border px-4 py-2 text-sm transition"
                  :class="state.accountTab === tab ? 'surface-note-active' : 'surface-soft'"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  @click="
                    () => {
                      state.accountTab = tab;
                      void openAccountSettings(tab);
                    }
                  "
                >
                  {{ tab }}
                </button>
                <button class="surface-soft action-button rounded-2xl border px-4 py-2 text-sm transition" @click="state.currentView = 'editor'">
                  Back to notes
                </button>
              </div>
            </div>

            <div v-if="state.accountTab === 'sessions'" class="min-h-0 flex-1 overflow-y-auto pr-1">
              <div class="mb-4 grid gap-3 md:grid-cols-2">
                <div class="stat-card rounded-2xl px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em]" :style="{ color: 'var(--vp-c-text-2)' }">Current session</p>
                  <p class="mt-1 text-xl font-semibold">{{ currentSessionCount }}</p>
                </div>
                <div class="stat-card rounded-2xl px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em]" :style="{ color: 'var(--vp-c-text-2)' }">Other active sessions</p>
                  <p class="mt-1 text-xl font-semibold">{{ otherSessionCount }}</p>
                </div>
              </div>

              <div class="mb-4 flex justify-end">
                <button
                  class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
                  :disabled="otherSessionCount === 0"
                  @click="revokeOtherSessions"
                >
                  Revoke all other sessions
                </button>
              </div>

              <div v-if="state.meSessionsLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                Loading sessions...
              </div>

              <div v-else-if="state.meSessions.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                No active sessions.
              </div>

              <div v-for="session in state.meSessions" :key="`my-session-${session.id}`" class="surface-soft mb-3 rounded-2xl border p-4">
                <div class="flex flex-col gap-4">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold">{{ session.current ? "Current session" : "Other session" }}</p>
                      <span v-if="session.current" class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]" :style="{ background: 'var(--vp-c-brand-soft)', color: 'var(--accent-strong)' }">
                        current
                      </span>
                    </div>
                    <div class="mt-3 grid gap-3 text-xs md:grid-cols-2 2xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Created</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.createdAt) }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Expires</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.expiresAt) }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Last used</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.lastUsedAt) }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">IP</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.ip }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">User agent</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatUserAgentLabel(session.userAgent) }}</p>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="revokeMySession(session)">
                      Revoke
                    </button>
                  </div>
                </div>
              </div>
            </div>

              <div v-else-if="state.accountTab === 'shares'" class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div v-if="state.userShares.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                  No active links for your account.
              </div>
              <div v-for="share in state.userShares" :key="`account-share-${share.filename}`" class="surface-soft mb-3 rounded-2xl border p-4">
                <div class="flex flex-col gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold">{{ share.filename }}</p>
                    <div class="mt-3 grid gap-3 text-xs md:grid-cols-2 2xl:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">State</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.state }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Views</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.viewCount }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Edits</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.editCount }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Password</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.hasPassword ? "Protected" : "Open" }}</p>
                      </div>
                      <div class="stat-card min-w-0 rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Updated</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(share.updatedAt) }}</p>
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="copyOwnShareLink(share)"
                    >
                      Copy link
                    </button>
                    <button
                      class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="changeOwnShareSlug(share)"
                    >
                      Change {{ share.state }} link
                    </button>
                    <button
                      class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="setOwnSharePassword(share)"
                    >
                      {{ share.hasPassword ? "Change password" : "Add password" }}
                    </button>
                    <button
                      v-if="share.hasPassword"
                      class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="removeOwnSharePassword(share)"
                    >
                      Remove password
                    </button>
                    <button
                      class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition"
                      :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }"
                      @click="deleteOwnShare(share)"
                    >
                      Delete link
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div class="glass-panel rounded-3xl p-4">
                <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Password</p>
                <h3 class="mt-1 text-lg font-semibold">Change your password</h3>
                <div class="mt-4 space-y-4">
                  <input v-model="state.accountPasswordCurrent" type="password" placeholder="Current password" class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                  <input v-model="state.accountPasswordNext" type="password" placeholder="New password" class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                  <input v-model="state.accountPasswordConfirm" type="password" placeholder="Confirm new password" class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                  <button
                    class="rounded-2xl px-4 py-3 text-sm font-medium transition disabled:opacity-70"
                    :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                    :disabled="state.accountPasswordSaving"
                    @click="changeOwnPassword"
                  >
                    Change password
                  </button>
                </div>
              </div>

              <div class="glass-panel rounded-3xl p-4">
                <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Session safety</p>
                <h3 class="mt-1 text-lg font-semibold">What happens after password change</h3>
                <div class="mt-4 space-y-3 text-sm leading-6" :style="{ color: 'var(--vp-c-text-2)' }">
                  <p>Changing your password rotates your current session and removes older sessions.</p>
                  <p>Blocked users lose all active sessions.</p>
                  <p>Logging out removes the current session server-side.</p>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="!hasSelection" class="flex h-full items-center justify-center">
            <div class="flex items-center justify-center" :style="{ color: 'var(--vp-c-text-3)' }" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none">
                <path d="M0 0h24v24H0z" fill="none" />
                <path fill="currentColor" d="M3 21V3h18v8.7q-.475-.225-.975-.387T19 11.075V5H5v14h6.05q.075.55.238 1.05t.387.95zm2-3v1V5v6.075V11zm2-1h4.075q.075-.525.238-1.025t.362-.975H7zm0-4h6.1q.8-.75 1.788-1.25T17 11.075V11H7zm0-4h10V7H7zm11 14q-2.075 0-3.537-1.463T13 18t1.463-3.537T18 13t3.538 1.463T23 18t-1.463 3.538T18 23m-.5-2h1v-2.5H21v-1h-2.5V15h-1v2.5H15v1h2.5z" />
              </svg>
            </div>
          </div>

          <div v-else class="flex h-full flex-col">
            <div class="mb-4 flex min-w-0 flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center" :style="{ borderColor: 'var(--vp-c-divider)' }">
              <input
                v-model="state.editorTitle"
                type="text"
                placeholder="Filename"
                class="surface-soft min-w-0 flex-1 rounded-2xl border px-4 py-3 text-lg outline-none transition"
                :style="{ color: 'var(--vp-c-text-1)' }"
                @input="state.isDirty = true"
              />

              <div class="grid min-w-0 grid-cols-3 gap-2 sm:ml-auto sm:flex sm:flex-row sm:flex-wrap">
                <button
                  class="rounded-2xl px-3 py-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-70 sm:px-4 sm:py-3 sm:text-sm"
                  :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                  :disabled="state.saving || !state.editorTitle.trim()"
                  @click="saveNote"
                >
                  Save
                </button>
                <button
                  class="surface-soft action-button rounded-2xl border px-3 py-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-70 sm:px-4 sm:py-3 sm:text-sm"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  :disabled="!canOperateOnSavedNote"
                  @click="downloadByFilename(state.selectedFilename)"
                >
                  Download
                </button>
                <button
                  class="danger-button rounded-2xl border px-3 py-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-70 sm:px-4 sm:py-3 sm:text-sm"
                  :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }"
                  :disabled="!canOperateOnSavedNote"
                  @click="deleteByFilename(state.selectedFilename)"
                >
                  Delete
                </button>
                <button
                  class="surface-soft action-button hidden rounded-2xl border px-4 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-70 lg:inline-flex"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  :disabled="!canOperateOnSavedNote"
                  @click="toggleHistoryPanel"
                >
                  History
                </button>
                <button
                  class="surface-soft action-button hidden rounded-2xl border px-4 py-3 text-sm transition lg:inline-flex"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  @click="closeCurrentNote"
                >
                  Close note
                </button>
              </div>
            </div>

            <div class="retro-share-panel mb-4 rounded-3xl border p-4" :style="{ borderColor: 'var(--vp-c-divider)', background: 'var(--panel-muted)' }">
              <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Public link</p>
                  <p class="mt-1 hidden text-sm sm:block" :style="{ color: 'var(--vp-c-text-2)' }">
                    {{ canOperateOnSavedNote ? "Configure read-only and editable public links for this note." : "Save the note first to enable public sharing controls." }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    class="action-button rounded-xl border px-3 py-2 text-xs transition"
                    :class="state.sharePanelOpen ? 'surface-note-active' : 'surface-soft'"
                    @click="toggleSharePanel"
                  >
                    Settings
                  </button>
                </div>
              </div>
            </div>

            <div class="retro-statusbar mb-3 flex min-w-0 flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between" :style="{ color: 'var(--vp-c-text-2)' }">
              <div class="flex min-w-0 items-center gap-3">
                <span>{{ byteCount }} bytes</span>
                <span>|</span>
                <span>{{ publicStatusText }}</span>
              </div>
              <span class="min-w-0 whitespace-normal break-words text-left leading-5 sm:flex-1 sm:text-right">{{ state.feedback || (state.isDirty ? "Unsaved changes" : "All changes saved") }}</span>
            </div>

            <div
              v-if="state.noteRemoteUpdatePending"
              class="mb-3 rounded-2xl border px-4 py-3 text-sm"
              :style="{ borderColor: 'var(--danger)', background: 'var(--panel-muted)' }"
            >
              <p :style="{ color: 'var(--danger)' }">
                {{ state.noteConflict ? "Your changes were not saved because this note was updated elsewhere." : "This note was updated on another device." }}
              </p>
              <p v-if="state.noteRemoteUpdatedAt || state.noteConflictUpdatedAt" class="mt-2 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
                Remote version:
                {{ state.noteConflict ? state.noteConflictServerVersion : state.noteRemoteVersion }}
                • Updated:
                {{ formatDate(state.noteConflict ? state.noteConflictUpdatedAt : state.noteRemoteUpdatedAt) }}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition" @click="reloadRemoteVersion">
                  Reload remote version
                </button>
                <button class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition" @click="keepLocalChanges">
                  Keep local changes
                </button>
              </div>
            </div>

            <textarea
              ref="editorTextarea"
              v-model="state.editorContent"
              class="surface-soft retro-editor-area min-h-[50vh] w-full min-w-0 flex-1 resize-none rounded-3xl border p-5 text-sm leading-7 outline-none transition"
              :style="{ color: 'var(--vp-c-text-1)', fontSize: `${state.editorFontSize}px` }"
              spellcheck="false"
              @input="
                state.isDirty = true;
                scheduleAutosave();
              "
            />
          </div>

          <Transition name="retro-modal">
            <div
              v-if="state.historyPanelOpen && canOperateOnSavedNote"
              class="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5"
              :style="{ background: 'rgba(0, 0, 0, 0.46)' }"
              @click.self="state.historyPanelOpen = false"
            >
              <div
                class="glass-panel retro-window retro-history-modal flex max-h-[90vh] w-full min-w-0 flex-col overflow-hidden rounded-3xl p-4 sm:p-5"
                data-window-title="VERSION HISTORY"
              >
                <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Version history</p>
                    <p class="mt-1 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                      Previous saved copies for this note.
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="loadNoteHistory({ preservePreview: true })"
                    >
                      Refresh
                    </button>
                    <button
                      class="danger-button rounded-xl border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-70"
                      :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }"
                      :disabled="state.historyItems.length === 0 || state.historyClearing"
                      @click="clearNoteHistory"
                    >
                      {{ state.historyClearing ? "Clearing..." : "Clear history" }}
                    </button>
                    <button
                      class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="state.historyPanelOpen = false"
                    >
                      Close history
                    </button>
                  </div>
                </div>

                <Transition name="retro-fade">
                  <p v-if="state.historyError" class="mb-3 text-sm" :style="{ color: 'var(--danger)' }">{{ state.historyError }}</p>
                </Transition>
                <Transition name="retro-fade">
                  <p v-if="state.historySuccess" class="mb-3 text-sm retro-success-text" :style="{ color: 'var(--vp-c-green-2)' }">{{ state.historySuccess }}</p>
                </Transition>

                <div class="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                  <div class="min-h-0 space-y-3 overflow-y-auto pr-1">
                    <div v-if="state.historyLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                      Loading history...
                    </div>
                    <div
                      v-else-if="state.historyItems.length === 0"
                      class="surface-soft rounded-2xl border p-4 text-sm"
                      :style="{ color: 'var(--vp-c-text-2)' }"
                    >
                      No saved revisions for this note.
                    </div>
                    <div
                      v-for="revision in state.historyItems"
                      :key="`revision-${revision.id}`"
                      class="surface-soft rounded-2xl border p-4 transition retro-history-card"
                      :class="state.historySelectedRevision?.id === revision.id ? 'surface-note-active' : ''"
                    >
                      <div class="flex flex-col gap-4">
                        <div class="grid gap-3 text-xs md:grid-cols-3 xl:grid-cols-1" :style="{ color: 'var(--vp-c-text-2)' }">
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Version</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ revision.version }}</p>
                          </div>
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Saved</p>
                            <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(revision.createdAt) }}</p>
                          </div>
                          <div class="stat-card rounded-2xl px-3 py-2">
                            <p class="uppercase tracking-[0.2em]">Size</p>
                            <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ revision.sizeBytes }} bytes</p>
                          </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          <button
                            class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
                            :class="state.historySelectedRevision?.id === revision.id || state.historyPreviewRevisionId === revision.id ? 'surface-note-active' : ''"
                            @click="previewRevision(revision.id)"
                          >
                            Preview
                          </button>
                          <button
                            class="rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-70"
                            :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                            :disabled="state.historyRestoring"
                            @click="restoreRevision(revision)"
                          >
                            {{ state.historyRestoring && state.historySelectedRevision?.id === revision.id ? "Restoring..." : "Restore" }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="min-h-0 overflow-y-auto pr-1">
                    <div class="retro-history-preview relative min-h-[420px] space-y-3">
                      <Transition name="retro-fade">
                        <div
                          v-if="state.historyPreviewLoading"
                          class="retro-history-overlay absolute inset-0 z-10 flex items-center justify-center text-sm"
                          :style="{ color: 'var(--vp-c-text-2)' }"
                        >
                          Loading revision preview...
                        </div>
                      </Transition>
                      <div
                        v-if="!state.historySelectedRevision"
                        class="surface-soft flex min-h-[420px] items-center justify-center rounded-2xl border p-4 text-sm transition"
                        :style="{ color: 'var(--vp-c-text-2)' }"
                      >
                        Select a revision to preview it.
                      </div>
                      <div v-else class="space-y-3 transition">
                      <div class="grid gap-3 text-xs md:grid-cols-3" :style="{ color: 'var(--vp-c-text-2)' }">
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Version</p>
                          <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.historySelectedRevision.version }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Saved</p>
                          <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(state.historySelectedRevision.createdAt) }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Size</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.historySelectedRevision.sizeBytes }} bytes</p>
                        </div>
                      </div>
                      <textarea
                        :value="state.historySelectedRevision.content"
                        readonly
                        class="surface-soft retro-editor-area min-h-[340px] w-full resize-none rounded-3xl border p-5 text-sm leading-7 outline-none transition"
                        :style="{ color: 'var(--vp-c-text-1)' }"
                        spellcheck="false"
                      />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>

          <Transition name="retro-modal">
            <div
              v-if="state.sharePanelOpen && canOperateOnSavedNote"
              class="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5"
              :style="{ background: 'rgba(0, 0, 0, 0.42)' }"
              @click.self="closeSharePanel"
            >
              <div
                class="glass-panel retro-window retro-share-modal flex max-h-[90vh] w-full min-w-0 flex-col overflow-hidden rounded-3xl p-4 sm:p-5"
                data-window-title="PUBLIC LINK SETTINGS"
              >
                <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Public link</p>
                    <p class="mt-1 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                      Configure read-only and editable public links for this note.
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition"
                      @click="closeSharePanel"
                    >
                      Close settings
                    </button>
                  </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto pr-1 pb-[3px]">
                  <div class="space-y-4">
                    <div class="grid gap-4 lg:grid-cols-2">
                      <label class="block">
                        <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Share state</span>
                        <select
                          v-model="state.shareMode"
                          class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                          :disabled="!canOperateOnSavedNote"
                          @change="handleShareModeChange"
                        >
                          <option value="read">read only</option>
                          <option value="edit">edit only</option>
                        </select>
                      </label>

                      <label class="block">
                        <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Generated URL</span>
                        <input
                          :value="activeShareUrl"
                          type="text"
                          readonly
                          placeholder="Will appear after save"
                          class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                          :disabled="!canOperateOnSavedNote"
                        />
                      </label>
                    </div>

                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Custom URL slug</span>
                      <input
                        v-model="state.shareSlugInput"
                        type="text"
                        :placeholder="isEditMode ? 'custom edit slug (optional)' : 'custom read slug (optional)'"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                        :disabled="!canOperateOnSavedNote"
                      />
                    </label>

                    <Transition name="retro-fade">
                      <p v-if="isEditMode" class="text-sm" :style="{ color: 'var(--danger)' }">
                        Anyone with this link can edit this note.
                      </p>
                    </Transition>

                    <div class="grid gap-4 lg:grid-cols-2">
                      <div>
                        <label class="mb-3 flex items-center gap-2 text-sm transition">
                          <input
                            v-model="state.sharePasswordEnabled"
                            class="toggle-input"
                            type="checkbox"
                            :class="{ 'cursor-not-allowed': !canOperateOnSavedNote }"
                            :disabled="!canOperateOnSavedNote"
                          />
                          <span>Enable password protection</span>
                        </label>
                        <input
                          v-model="state.sharePassword"
                          type="password"
                          placeholder="share password"
                          class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                          :disabled="!state.sharePasswordEnabled || !canOperateOnSavedNote"
                        />
                        <Transition name="retro-fade">
                          <p v-if="state.shareHasExistingPassword" class="mt-2 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
                            A password is already set. Leave the field empty to keep it unchanged.
                          </p>
                        </Transition>
                      </div>

                      <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
                        <label class="block">
                          <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Expiration</span>
                          <input
                            v-model="state.shareExpirationAmount"
                            type="number"
                            min="1"
                            placeholder="leave empty for none"
                            class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                            :disabled="!canOperateOnSavedNote"
                          />
                        </label>
                        <label class="block">
                          <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Unit</span>
                          <select
                            v-model="state.shareExpirationUnit"
                            class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none transition"
                            :disabled="!canOperateOnSavedNote"
                          >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    <div class="grid gap-3 text-xs sm:grid-cols-2" :style="{ color: 'var(--vp-c-text-2)' }">
                      <div class="stat-card rounded-2xl px-3 py-2 transition">
                        <p class="uppercase tracking-[0.2em]">View count</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.shareViewCount }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2 transition">
                        <p class="uppercase tracking-[0.2em]">Edit count</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.shareEditCount }}</p>
                      </div>
                    </div>

                    <div class="grid gap-2 pb-[2px] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                      <div class="flex min-h-[2.85rem] flex-wrap items-start gap-2">
                        <button
                          class="rounded-2xl px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70"
                          :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                          :disabled="!canOperateOnSavedNote || state.shareSaving || state.shareLoading"
                          @click="saveShareForCurrentNote"
                        >
                          Save share
                        </button>
                        <button
                          class="danger-button rounded-2xl border px-4 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-70"
                          :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }"
                          :disabled="!canOperateOnSavedNote || !hasAnyActiveShare"
                          @click="disableShareForCurrentNote"
                        >
                          Disable share
                        </button>
                      </div>
                      <div class="relative flex min-h-[2.85rem] items-center sm:min-w-[280px]">
                        <Transition name="retro-fade">
                          <p
                            v-if="shareStatusText"
                            class="absolute inset-y-0 left-0 right-0 flex items-center text-sm"
                            :class="shareStatusIsSuccess ? 'retro-success-text' : 'retro-error-text'"
                          >
                            {{ shareStatusText }}
                          </p>
                        </Transition>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </main>
    </div>
  </div>
</template>

<style src="./retro-theme.css"></style>
<style>
.retro-fade-enter-active,
.retro-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.retro-fade-enter-from,
.retro-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.retro-modal-enter-active,
.retro-modal-leave-active {
  transition: opacity 0.26s ease;
}

.retro-modal-enter-active .retro-history-modal,
.retro-modal-leave-active .retro-history-modal,
.retro-modal-enter-active .retro-share-modal,
.retro-modal-leave-active .retro-share-modal {
  transition: opacity 0.26s ease, transform 0.26s ease;
}

.retro-modal-enter-from,
.retro-modal-leave-to {
  opacity: 0;
}

.retro-modal-enter-from .retro-history-modal,
.retro-modal-leave-to .retro-history-modal,
.retro-modal-enter-from .retro-share-modal,
.retro-modal-leave-to .retro-share-modal {
  opacity: 0;
  transform: translateY(-12px) scale(0.982);
}

.retro-history-preview {
  transition: min-height 0.2s ease;
}

.retro-history-overlay {
  background: rgba(195, 195, 195, 0.72);
  border: 1px solid rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(1px);
}

.retro-error-text {
  color: var(--danger) !important;
  font-weight: 700;
  text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.45);
}

.retro-history-card,
.retro-history-preview > div,
.retro-share-modal .stat-card,
.retro-share-modal .surface-soft,
.retro-share-modal label,
.retro-history-modal .stat-card,
.retro-history-modal .surface-soft {
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease,
    transform 0.16s ease;
}
</style>
