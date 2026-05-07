<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";

type SortMode = "created_desc" | "created_asc" | "name_asc" | "name_desc";
type ThemeMode = "light" | "dark";
type ThemeSetting = ThemeMode | "system";
type UserRole = "admin" | "user";
type MainView = "editor" | "admin" | "account";
type AdminTab = "users" | "shares" | "notes" | "settings";
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
  ownerUsername?: string;
}

interface InstanceSettings {
  defaultTheme: ThemeSetting;
  defaultReadSlugLength: number;
  defaultEditSlugLength: number;
  shareCharset: string;
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
  editorFontSize: 14,
  isDirty: false,
  feedback: "",
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
    shareCharset: "abcdefghijklmnopqrstuvwxyz0123456789"
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
  sharePanelOpen: false,
  adminLoading: false,
  adminUsers: [] as AdminUserSummary[],
  adminUsersFilter: "all" as UserFilter,
  adminShares: [] as AdminShareSummary[],
  adminSharesUsername: "",
  adminNotes: [] as NoteMeta[],
  adminNotesUsername: "",
  adminSettingsSaving: false,
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
  publicEditPassword: "",
  publicEditRequiresPassword: false,
  publicEditLoading: false,
  publicEditSaving: false,
  publicEditError: ""
});

let autosaveTimer: number | undefined;

const selectedNote = computed(() =>
  state.notes.find((note) => note.filename === state.selectedFilename)
);

const hasSelection = computed(() => Boolean(state.selectedFilename) || state.isCreatingNew);
const canOperateOnSavedNote = computed(() => Boolean(state.selectedFilename) && !state.isCreatingNew);
const byteCount = computed(() => new TextEncoder().encode(state.editorContent).length);
const isAdmin = computed(() => state.role === "admin");
const adminTabs: AdminTab[] = ["users", "shares", "notes", "settings"];
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
const publicStatusText = computed(() => {
  if (state.shareMode === "edit" && state.shareEditUrlPath) {
    return shareRemainingText.value ? `Edit link active • ${shareRemainingText.value}` : "Edit link active";
  }
  if (state.shareMode === "read" && state.shareReadUrlPath) {
    return shareRemainingText.value ? `Read link active • ${shareRemainingText.value}` : "Read link active";
  }
  return "Private note";
});

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
    throw new Error(payload.message || "Request failed");
  }

  if (response.headers.get("Content-Type")?.includes("application/json")) {
    return (await response.json()) as T;
  }

  return undefined as T;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function getCookieValue(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function resolveThemeSetting(theme: ThemeSetting): ThemeMode {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function clearShareState() {
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
  state.isCreatingNew = false;
  state.isDirty = false;
  state.feedback = "";
  clearShareState();
}

function closeCurrentNote() {
  resetEditorState();
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
  state.meSessions = [];
  state.accountPasswordCurrent = "";
  state.accountPasswordNext = "";
  state.accountPasswordConfirm = "";
  state.adminUserSessions = [];
  state.adminUserSessionsTarget = "";
  resetEditorState();
}

async function loadInstanceSettings() {
  const payload = await api<{ settings: InstanceSettings }>("/api/settings");
  state.settings = payload.settings;
  const storedTheme = window.localStorage.getItem("textbin-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(storedTheme);
  } else {
    applyTheme(resolveThemeSetting(payload.settings.defaultTheme));
  }
}

async function loadUserShares() {
  const payload = await api<{ shares: ShareSummary[] }>("/api/shares");
  state.userShares = payload.shares;
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
  try {
    const payload = await api<{ filename?: string; content?: string; requiresPassword: boolean }>(
      `/api/public/edit/${encodeURIComponent(state.publicEditSlug)}`
    );

    state.publicEditFilename = payload.filename ?? "";
    state.publicEditRequiresPassword = payload.requiresPassword;
    state.publicEditContent = payload.content ?? "";
    document.title = payload.requiresPassword
      ? "Protected Editable TextBin Note"
      : `${(payload.filename ?? "").replace(/\.txt$/i, "") || "Editable Text"} - TextBin`;
  } catch (error) {
    state.publicEditError = error instanceof Error ? error.message : "Could not load editable note";
    state.publicEditContent = "";
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

async function loadSession() {
  try {
    const payload = await api<UserResponse>("/api/auth/me", { method: "GET" });
    state.authenticated = true;
    state.username = payload.user.username;
    state.role = payload.user.role;
    document.title = "TextBin";
    history.replaceState({}, "", "/dashboard");
    await Promise.all([loadInstanceSettings(), loadNotes(), loadUserShares()]);
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
  } catch (error) {
    state.loginError = error instanceof Error ? error.message : "Invalid username or password";
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  clearAuthState();
  history.replaceState({}, "", "/login");
}

async function loadShareForFilename(filename: string) {
  if (!filename) {
    clearShareState();
    return;
  }

  state.shareLoading = true;
  try {
    const payload = await api<{ share: ShareSummary | null }>(`/api/shares/${encodeURIComponent(filename)}`);
    if (!payload.share) {
      clearShareState();
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
    state.sharePanelOpen = false;
  } finally {
    state.shareLoading = false;
  }
}

async function openNote(filename: string) {
  if (!filename) {
    resetEditorState();
    return;
  }

  const payload = await api<{ filename: string; content: string }>(`/api/notes/${encodeURIComponent(filename)}`);
  state.currentView = "editor";
  state.selectedFilename = payload.filename;
  document.title = `${payload.filename.replace(/\.txt$/i, "")} - TextBin`;
  state.editorTitle = payload.filename.replace(/\.txt$/i, "");
  state.editorContent = payload.content;
  state.isCreatingNew = false;
  state.isDirty = false;
  state.feedback = "";
  closeContextMenu();
  await loadShareForFilename(payload.filename);
}

function createNewNote() {
  closeContextMenu();
  state.currentView = "editor";
  document.title = "New Note - TextBin";
  state.selectedFilename = "";
  state.editorTitle = "";
  state.editorContent = "";
  state.isCreatingNew = true;
  state.isDirty = false;
  state.feedback = "";
  clearShareState();
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
      state.isCreatingNew = false;
    } else {
      await api(`/api/notes/${encodeURIComponent(state.selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({
          content: state.editorContent
        })
      });

      if (trimmedTitle !== selectedNote.value?.displayName) {
        const renamed = await api<NoteMeta>(`/api/notes/${encodeURIComponent(state.selectedFilename)}/rename`, {
          method: "PATCH",
          body: JSON.stringify({
            title: trimmedTitle
          })
        });
        state.selectedFilename = renamed.filename;
      }
    }

    await Promise.all([loadNotes(), loadUserShares()]);
    state.isDirty = false;
    state.feedback = "Saved";
    if (state.selectedFilename) {
      await loadShareForFilename(state.selectedFilename);
    }
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
      state.feedback = "Share settings saved";
    } else {
      clearShareState();
      state.feedback = "Share disabled";
    }
    await loadUserShares();
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
  state.feedback = "Share removed";
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
  try {
    await api(`/api/public/edit/${encodeURIComponent(state.publicEditSlug)}/verify`, {
      method: "POST",
      body: JSON.stringify({
        password: state.publicEditPassword
      })
    });
    state.publicEditPassword = "";
    await loadPublicEdit();
  } catch (error) {
    state.publicEditError = error instanceof Error ? error.message : "Could not verify edit access";
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
  try {
    const payload = await api<{ success: boolean; filename: string; editCount: number }>(
      `/api/public/edit/${encodeURIComponent(state.publicEditSlug)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          content: state.publicEditContent
        })
      }
    );
    state.publicEditFilename = payload.filename;
  } catch (error) {
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
      await api(`/api/notes/${encodeURIComponent(state.selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({
          content: state.editorContent
        })
      });
      await loadNotes();
      state.isDirty = false;
      state.feedback = "Saved automatically";
    } finally {
      state.saving = false;
    }
  }, 1200);
}

function toggleDotMenu(event: MouseEvent, filename: string) {
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

  const cardRect = noteCard.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  state.contextMenuStyle = {
    top: `${Math.max(8, buttonRect.bottom - cardRect.top + 6)}px`,
    right: `${Math.max(8, cardRect.right - buttonRect.right)}px`
  };
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
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

function onBackgroundClick() {
  closeContextMenu();
}

async function loadAdminUsers() {
  const payload = await api<{ users: AdminUserSummary[] }>("/api/admin/users");
  state.adminUsers = payload.users;
  if (!state.adminSharesUsername) {
    state.adminSharesUsername = state.username;
  }
  if (!state.adminNotesUsername) {
    state.adminNotesUsername = state.username;
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

async function openAccountSettings(tab: AccountTab = state.accountTab) {
  state.currentView = "account";
  state.accountTab = tab;
  await Promise.all([loadUserShares(), loadMySessions()]);
}

async function openAdminPanel(tab: AdminTab = state.adminTab) {
  if (!isAdmin.value) {
    return;
  }

  state.currentView = "admin";
  state.adminTab = tab;
  state.adminLoading = true;
  try {
    await Promise.all([loadAdminUsers(), loadAdminShares(), loadAdminSettings()]);
    await loadAdminNotes(state.adminNotesUsername || "all");
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
  const targetUser = state.adminUsers.find((user) => user.username === state.adminUserSessionsTarget);
  if (targetUser) {
    await loadAdminUserSessions(targetUser.id, targetUser.username);
  }
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
  try {
    const payload = await api<{ settings: InstanceSettings }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(state.settings)
    });
    state.settings = payload.settings;
    state.feedback = "Settings saved";
  } finally {
    state.adminSettingsSaving = false;
  }
}

onMounted(() => {
  const storedTheme = window.localStorage.getItem("textbin-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(storedTheme);
  } else {
    applyTheme("dark");
  }

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
});

onBeforeUnmount(() => {
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
  }
  window.removeEventListener("click", onBackgroundClick);
});
</script>

<template>
  <div class="min-h-screen w-full overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8" :style="{ color: 'var(--vp-c-text-1)' }">
    <div
      v-if="!state.ready"
      class="flex min-h-[calc(100vh-3rem)] items-center justify-center text-sm"
      :style="{ color: 'var(--vp-c-text-2)' }"
    >
      Loading TextBin...
    </div>

    <div v-else-if="isPublicShareView" class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
      <div class="glass-panel w-full rounded-3xl p-6 sm:p-8">
        <div class="mb-6">
          <p class="text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Shared note</p>
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
            class="surface-soft min-h-[60vh] w-full resize-none rounded-3xl border p-5 text-sm leading-7 outline-none"
            :style="{ color: 'var(--vp-c-text-1)' }"
            spellcheck="false"
          />
        </div>
      </div>
    </div>

    <div v-else-if="isPublicEditView" class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
      <div class="glass-panel w-full rounded-3xl p-6 sm:p-8">
        <div class="mb-6">
          <p class="text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Editable note</p>
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
          <textarea
            v-model="state.publicEditContent"
            class="surface-soft min-h-[60vh] w-full resize-none rounded-3xl border p-5 text-sm leading-7 outline-none"
            :style="{ color: 'var(--vp-c-text-1)' }"
            spellcheck="false"
          />
          <div class="mt-4 flex justify-end">
            <button
              class="rounded-2xl px-4 py-3 text-sm font-medium transition disabled:opacity-70"
              :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
              :disabled="state.publicEditSaving"
              @click="savePublicEditContent"
            >
              {{ state.publicEditSaving ? "Saving..." : "Save changes" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="!state.authenticated"
      class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center"
    >
      <div class="glass-panel w-full max-w-md rounded-3xl p-8">
        <div class="mb-8">
          <p class="text-xs uppercase tracking-[0.35em]" :style="{ color: 'var(--accent)' }">Private Text Vault</p>
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

    <div v-else class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl min-w-0 flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:min-h-0 lg:max-w-[1680px] lg:flex-row">
      <div class="glass-panel flex w-full min-w-0 flex-col gap-3 rounded-3xl p-4 lg:hidden">
        <div>
          <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Signed in</p>
          <p class="mt-1 text-sm font-medium">{{ state.username }}</p>
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
        <button
          class="action-button rounded-xl border px-3 py-2 text-sm transition"
          :class="state.currentView === 'account' ? 'surface-note-active' : 'surface-soft'"
          :style="{ color: 'var(--vp-c-text-1)' }"
          @click="openAccountSettings('sessions')"
        >
          Account
        </button>
        <div class="flex w-full min-w-0 gap-2">
          <button
            class="action-button min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm transition"
            :class="state.theme === 'dark' ? 'surface-note-active' : 'surface-soft'"
            :style="{ color: 'var(--vp-c-text-1)' }"
            @click="toggleTheme"
          >
            Theme
          </button>
          <button
            class="surface-soft action-button danger-button min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm transition"
            :style="{ color: 'var(--vp-c-text-1)' }"
            @click="logout"
          >
            Log out
          </button>
        </div>
      </div>

      <aside class="glass-panel hidden w-full max-w-[320px] flex-col overflow-hidden rounded-3xl p-4 lg:flex lg:h-full lg:max-w-[360px]">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Signed in</p>
            <p class="mt-1 text-sm font-medium">{{ state.username }}</p>
            <p class="mt-1 text-xs uppercase tracking-[0.2em]" :style="{ color: 'var(--vp-c-text-3)' }">{{ state.role }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="action-button rounded-xl border px-3 py-2 text-sm transition"
              :class="state.theme === 'dark' ? 'surface-note-active' : 'surface-soft'"
              :style="{ color: 'var(--vp-c-text-1)' }"
              @click="toggleTheme"
            >
              Theme
            </button>
            <button
              class="surface-soft action-button danger-button rounded-xl border px-3 py-2 text-sm transition"
              :style="{ color: 'var(--vp-c-text-1)' }"
              @click="logout"
            >
              Log out
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
          class="action-button mb-3 rounded-2xl border px-4 py-3 text-sm transition"
          :class="state.currentView === 'account' ? 'surface-note-active' : 'surface-soft'"
          :style="{ color: 'var(--vp-c-text-1)' }"
          @click="openAccountSettings('sessions')"
        >
          Account
        </button>

        <button
          class="mb-4 rounded-2xl px-4 py-3 text-sm font-medium transition"
          :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
          @click="createNewNote"
        >
          Create Note
        </button>

        <label class="mb-4 block">
          <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Sort</span>
          <select
            v-model="state.sort"
            class="surface-soft w-full rounded-2xl border px-3 py-3 text-sm outline-none transition"
            :style="{ color: 'var(--vp-c-text-1)' }"
            @change="loadNotes"
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
            class="surface-note relative mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition"
            :class="state.selectedFilename === note.filename && state.currentView === 'editor' ? 'surface-note-active' : 'surface-soft'"
            :style="userShareFilenameSet.has(note.filename) ? { boxShadow: 'inset 4px 0 0 var(--accent-strong)' } : {}"
          >
            <button class="min-w-0 flex-1 text-left" @click="openNote(note.filename)">
              <p class="truncate text-sm font-medium">{{ note.displayName }}</p>
              <p class="mt-1 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
                {{ formatDate(note.updatedAt) }}
              </p>
            </button>
            <button
              class="rounded-xl p-2 transition"
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

      <main class="flex min-h-[70vh] min-w-0 flex-1 flex-col gap-4 lg:min-h-0 lg:h-full">
        <div class="glass-panel rounded-3xl p-4 lg:hidden">
          <div class="mb-3 flex gap-2">
            <button
              class="flex-1 rounded-2xl px-4 py-3 text-sm font-medium transition"
              :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
              @click="createNewNote"
            >
              Create Note
            </button>
          </div>

          <label class="block">
            <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Files</span>
            <select
              :value="state.selectedFilename"
              class="surface-soft w-full rounded-2xl border px-3 py-3 text-sm outline-none transition"
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

        <div class="glass-panel relative min-w-0 flex-1 overflow-x-hidden rounded-3xl p-4 sm:p-6 lg:min-h-0 lg:p-7">
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
              <div v-if="state.adminTab === 'users'" class="flex min-h-0 flex-1 flex-col gap-4">
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

                <div class="glass-panel min-h-0 rounded-3xl p-4">
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

                  <div class="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                    <div v-for="user in filteredAdminUsers" :key="user.id" class="surface-soft rounded-2xl border p-4">
                      <div class="flex flex-col gap-4">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <p class="text-sm font-semibold">{{ user.username }}</p>
                            <span class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]" :style="{ background: 'var(--vp-c-brand-soft)', color: 'var(--accent-strong)' }">
                              {{ user.role }}
                            </span>
                            <span
                              v-if="user.blocked"
                              class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
                              :style="{ background: 'var(--danger-soft)', color: 'var(--danger)' }"
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
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="loadAdminUserSessions(user.id, user.username)">Sessions</button>
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="resetUserPassword(user)">Reset password</button>
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="toggleUserRole(user)">
                            Make {{ user.role === "admin" ? "user" : "admin" }}
                          </button>
                          <button class="surface-soft admin-action action-button rounded-xl border px-3 py-2 text-sm transition" @click="toggleUserBlocked(user)">
                            {{ user.blocked ? "Unblock" : "Block" }}
                          </button>
                          <button class="admin-action danger-button rounded-xl border px-3 py-2 text-sm transition" :style="{ color: 'var(--danger)', borderColor: 'var(--danger)' }" @click="deleteUser(user)">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="state.adminUserSessionsTarget" class="glass-panel rounded-3xl p-4">
                    <div class="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">User sessions</p>
                        <h3 class="mt-1 text-lg font-semibold">{{ state.adminUserSessionsTarget }}</h3>
                      </div>
                      <button class="surface-soft action-button rounded-xl border px-3 py-2 text-sm transition" @click="state.adminUserSessionsTarget = ''; state.adminUserSessions = []">
                        Close
                      </button>
                    </div>

                    <div v-if="state.adminUserSessionsLoading" class="text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                      Loading sessions...
                    </div>

                    <div v-else-if="state.adminUserSessions.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                      No active sessions for this user.
                    </div>

                    <div v-for="session in state.adminUserSessions" :key="`admin-session-${session.id}`" class="surface-soft mb-3 rounded-2xl border p-4">
                      <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div class="min-w-0 flex-1">
                          <div class="mt-3 grid gap-3 text-xs xl:grid-cols-5" :style="{ color: 'var(--vp-c-text-2)' }">
                            <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Created</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.createdAt) }}</p>
                            </div>
                            <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Expires</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.expiresAt) }}</p>
                            </div>
                            <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">Last used</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.lastUsedAt) }}</p>
                            </div>
                            <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">IP</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.ip }}</p>
                            </div>
                            <div class="stat-card rounded-2xl px-3 py-2">
                              <p class="uppercase tracking-[0.2em]">User agent</p>
                              <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.userAgent }}</p>
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
                  <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <p class="text-sm font-semibold">{{ share.filename }}</p>
                        <span class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]" :style="{ background: 'var(--vp-c-brand-soft)', color: 'var(--accent-strong)' }">
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
                      <div class="mt-3 grid gap-3 text-xs xl:grid-cols-5" :style="{ color: 'var(--vp-c-text-2)' }">
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">State</p>
                          <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.state }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Views</p>
                          <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.viewCount }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Edits</p>
                          <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.editCount }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Password</p>
                          <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.hasPassword ? "Protected" : "Open" }}</p>
                        </div>
                        <div class="stat-card rounded-2xl px-3 py-2">
                          <p class="uppercase tracking-[0.2em]">Updated</p>
                          <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(share.updatedAt) }}</p>
                        </div>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
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

              <div v-else-if="state.adminTab === 'notes'" class="flex min-h-0 flex-1 flex-col">
                <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Recent notes</p>
                    <h3 class="mt-1 text-lg font-semibold">User notes overview</h3>
                  </div>
                  <label class="block min-w-[220px]">
                    <span class="mb-2 block text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Selected user</span>
                    <select
                      v-model="state.adminNotesUsername"
                      class="surface-soft w-full rounded-2xl border px-3 py-3 text-sm outline-none"
                      @change="loadAdminNotes(state.adminNotesUsername)"
                    >
                      <option value="all">All users</option>
                      <option v-for="user in state.adminUsers" :key="`admin-notes-${user.id}`" :value="user.username">
                        {{ user.username }}
                      </option>
                    </select>
                  </label>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div v-if="state.adminNotes.length === 0" class="surface-soft rounded-2xl border p-4 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    No notes for this user.
                  </div>

                  <div v-for="note in state.adminNotes" :key="`admin-note-${note.filename}`" class="surface-soft mb-3 rounded-2xl border p-4">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div class="min-w-0 flex-1">
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
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Default theme</span>
                      <select v-model="state.settings.defaultTheme" class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none">
                        <option value="system">System default</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                      </select>
                    </label>

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

                    <button
                      class="rounded-2xl px-4 py-3 text-sm font-medium transition"
                      :style="{ background: 'var(--accent)', color: 'var(--vp-c-bg)' }"
                      :disabled="state.adminSettingsSaving"
                      @click="saveAdminSettings"
                    >
                      Save settings
                    </button>
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
                <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold">{{ session.current ? "Current session" : "Other session" }}</p>
                      <span v-if="session.current" class="rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]" :style="{ background: 'var(--vp-c-brand-soft)', color: 'var(--accent-strong)' }">
                        current
                      </span>
                    </div>
                    <div class="mt-3 grid gap-3 text-xs xl:grid-cols-5" :style="{ color: 'var(--vp-c-text-2)' }">
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Created</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.createdAt) }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Expires</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.expiresAt) }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Last used</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ formatDate(session.lastUsedAt) }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">IP</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.ip }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">User agent</p>
                        <p class="mt-1 text-[13px] break-words" :style="{ color: 'var(--vp-c-text-1)' }">{{ session.userAgent }}</p>
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
                <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold">{{ share.filename }}</p>
                    <div class="mt-3 grid gap-3 text-xs xl:grid-cols-5" :style="{ color: 'var(--vp-c-text-2)' }">
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">State</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.state }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Views</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.viewCount }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Edits</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.editCount }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
                        <p class="uppercase tracking-[0.2em]">Password</p>
                        <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ share.hasPassword ? "Protected" : "Open" }}</p>
                      </div>
                      <div class="stat-card rounded-2xl px-3 py-2">
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
            <p class="text-4xl font-light tracking-[0.3em]" :style="{ color: 'var(--vp-c-text-3)' }">Text it!</p>
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
                  class="surface-soft action-button hidden rounded-2xl border px-4 py-3 text-sm transition lg:inline-flex"
                  :style="{ color: 'var(--vp-c-text-1)' }"
                  @click="closeCurrentNote"
                >
                  Close note
                </button>
              </div>
            </div>

            <div class="mb-4 rounded-3xl border p-4" :style="{ borderColor: 'var(--vp-c-divider)', background: 'var(--panel-muted)' }">
              <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em]" :style="{ color: 'var(--vp-c-text-3)' }">Public link</p>
                  <p class="mt-1 text-sm" :style="{ color: 'var(--vp-c-text-2)' }">
                    {{ canOperateOnSavedNote ? "Configure read-only and editable public links for this note." : "Save the note first to enable public sharing controls." }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    class="action-button rounded-xl border px-3 py-2 text-xs transition"
                    :class="state.sharePanelOpen ? 'surface-note-active' : 'surface-soft'"
                    @click="state.sharePanelOpen = !state.sharePanelOpen"
                  >
                    Settings
                  </button>
                </div>
              </div>

              <div v-if="state.sharePanelOpen" class="space-y-4">
                <div class="grid gap-4 lg:grid-cols-2">
                  <label class="block">
                    <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Share state</span>
                    <select
                      v-model="state.shareMode"
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
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
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
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
                    class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    :disabled="!canOperateOnSavedNote"
                  />
                </label>

                <p v-if="isEditMode" class="text-sm" :style="{ color: 'var(--danger)' }">
                  Anyone with this link can edit this note.
                </p>

                <div class="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label class="mb-3 flex items-center gap-2 text-sm">
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
                      class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                      :disabled="!state.sharePasswordEnabled || !canOperateOnSavedNote"
                    />
                    <p v-if="state.shareHasExistingPassword" class="mt-2 text-xs" :style="{ color: 'var(--vp-c-text-2)' }">
                      A password is already set. Leave the field empty to keep it unchanged.
                    </p>
                  </div>

                  <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Expiration</span>
                      <input
                        v-model="state.shareExpirationAmount"
                        type="number"
                        min="1"
                        placeholder="leave empty for none"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                        :disabled="!canOperateOnSavedNote"
                      />
                    </label>
                    <label class="block">
                      <span class="mb-2 block text-sm" :style="{ color: 'var(--vp-c-text-2)' }">Unit</span>
                      <select
                        v-model="state.shareExpirationUnit"
                        class="surface-soft w-full rounded-2xl border px-4 py-3 text-sm outline-none"
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
                  <div class="stat-card rounded-2xl px-3 py-2">
                    <p class="uppercase tracking-[0.2em]">View count</p>
                    <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.shareViewCount }}</p>
                  </div>
                  <div class="stat-card rounded-2xl px-3 py-2">
                    <p class="uppercase tracking-[0.2em]">Edit count</p>
                    <p class="mt-1 text-[13px]" :style="{ color: 'var(--vp-c-text-1)' }">{{ state.shareEditCount }}</p>
                  </div>
                </div>

                <div class="flex flex-wrap gap-2">
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
              </div>
            </div>

            <div class="mb-3 flex min-w-0 items-start justify-between gap-3 text-xs sm:items-center" :style="{ color: 'var(--vp-c-text-2)' }">
              <div class="flex min-w-0 items-center gap-3">
                <span>{{ byteCount }} bytes</span>
                <span>{{ publicStatusText }}</span>
              </div>
              <span class="min-w-0 flex-1 text-right break-words">{{ state.feedback || (state.isDirty ? "Unsaved changes" : "All changes saved") }}</span>
            </div>

            <textarea
              v-model="state.editorContent"
              class="surface-soft min-h-[50vh] w-full min-w-0 flex-1 resize-none rounded-3xl border p-5 text-sm leading-7 outline-none transition"
              :style="{ color: 'var(--vp-c-text-1)', fontSize: `${state.editorFontSize}px` }"
              spellcheck="false"
              @input="
                state.isDirty = true;
                scheduleAutosave();
              "
            />
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
