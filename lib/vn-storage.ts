import Dexie from "dexie";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import type { VnSession, VnMessage, VnChapterMeta, VnLayoutPrefs, VnBeat, VnFrameAudio } from "./vn-types";
export type { VnSession, VnMessage, VnChapterMeta, VnLayoutPrefs, VnBeat };

class VnDatabase extends Dexie {
  sessions!: Dexie.Table<VnSession, string>;
  messages!: Dexie.Table<VnMessage, string>;
  config!: Dexie.Table<{ key: string; value: string }, string>;

  constructor() {
    super("AiPhoneVnDB");
    this.version(1).stores({
      sessions: "id, characterId, updatedAt",
      messages: "id, sessionId, chapterIndex, createdAt",
    });
    this.version(2).stores({
      sessions: "id, characterId, updatedAt",
      messages: "id, sessionId, chapterIndex, createdAt",
      config: "key",
    });
  }
}

const vnDb = new VnDatabase();

let _hydrated = false;
let _sessionsCache: VnSession[] = [];
let _messagesCache: VnMessage[] = [];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getVnSessionActivityTime(session: VnSession): number {
  const lastMessageTime = _messagesCache
    .filter((message) => message.sessionId === session.id)
    .reduce((latest, message) => Math.max(latest, parseTime(message.createdAt)), 0);
  return Math.max(lastMessageTime, parseTime(session.updatedAt));
}

function isPreferredVnSession(candidate: VnSession, current: VnSession): boolean {
  const candidateTime = getVnSessionActivityTime(candidate);
  const currentTime = getVnSessionActivityTime(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  const candidateUpdated = parseTime(candidate.updatedAt);
  const currentUpdated = parseTime(current.updatedAt);
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;
  return candidate.id.localeCompare(current.id) > 0;
}

function normalizeVnSessions(sessions: VnSession[]): { items: VnSession[]; changed: boolean } {
  const normalized: VnSession[] = [];
  const indexByCharacter = new Map<string, number>();
  let changed = false;

  for (const session of sessions) {
    const id = session.id?.trim();
    const characterId = session.characterId?.trim();
    if (!id || !characterId) {
      changed = true;
      continue;
    }
    const item = id === session.id && characterId === session.characterId
      ? session
      : { ...session, id, characterId };
    const existingIndex = indexByCharacter.get(characterId);
    if (existingIndex === undefined) {
      indexByCharacter.set(characterId, normalized.length);
      normalized.push(item);
      if (item !== session) changed = true;
      continue;
    }

    changed = true;
    if (isPreferredVnSession(item, normalized[existingIndex])) {
      normalized[existingIndex] = item;
    }
  }

  return { items: normalized, changed };
}

function persistVnSessionsSnapshot(sessions: VnSession[]): void {
  vnDb.transaction("rw", vnDb.sessions, async () => {
    await vnDb.sessions.clear();
    await vnDb.sessions.bulkPut(sessions);
  }).catch(() => undefined);
}

export async function hydrateVnStorage(): Promise<void> {
  if (_hydrated || typeof window === "undefined") return;
  const [sessions, messages] = await Promise.all([
    vnDb.sessions.toArray().catch(() => []),
    vnDb.messages.toArray().catch(() => []),
  ]);
  _messagesCache = messages;
  const normalized = normalizeVnSessions(sessions);
  _sessionsCache = normalized.items;
  if (normalized.changed) persistVnSessionsSnapshot(normalized.items);
  _hydrated = true;
}

export function loadVnSessions(): VnSession[] {
  const normalized = normalizeVnSessions(_sessionsCache);
  if (normalized.changed) _sessionsCache = normalized.items;
  return [..._sessionsCache].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createOrGetVnSession(characterId: string): VnSession {
  const normalized = normalizeVnSessions(_sessionsCache);
  if (normalized.changed) {
    _sessionsCache = normalized.items;
    persistVnSessionsSnapshot(normalized.items);
  }
  const existing = _sessionsCache.find((s) => s.characterId === characterId);
  if (existing) return existing;

  const session: VnSession = {
    id: generateId("vn_sess"),
    characterId,
    updatedAt: new Date().toISOString(),
    chapters: [],
    activeChapterIndex: -1,
  };
  _sessionsCache.unshift(session);
  vnDb.sessions.put(session).catch(() => undefined);
  return session;
}

export function loadVnMessages(sessionId: string): VnMessage[] {
  return _messagesCache
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadVnMessagesForChapter(sessionId: string, chapterIndex: number): VnMessage[] {
  return _messagesCache
    .filter((m) => m.sessionId === sessionId && m.chapterIndex === chapterIndex)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function pushVnMessage(
  input: Omit<VnMessage, "id" | "createdAt">
): VnMessage {
  const message: VnMessage = {
    ...input,
    id: generateId("vn_msg"),
    createdAt: new Date().toISOString(),
  };
  _messagesCache.push(message);
  vnDb.messages.put(message).catch(() => undefined);

  const preview = message.rawContent.replace(/\s+/g, " ").trim().slice(0, 64);
  updateVnSession(message.sessionId, {
    lastMessageId: message.id,
    lastMessagePreview: preview,
    updatedAt: message.createdAt,
  });

  return message;
}

export function deleteVnMessage(messageId: string): void {
  _messagesCache = _messagesCache.filter((m) => m.id !== messageId);
  vnDb.messages.delete(messageId).catch(() => undefined);
}

export function deleteVnMessagesFrom(sessionId: string, messageId: string): void {
  const msg = _messagesCache.find((m) => m.id === messageId);
  if (!msg) return;
  const idsToDelete = _messagesCache
    .filter((m) => m.sessionId === sessionId && m.createdAt >= msg.createdAt)
    .map((m) => m.id);
  _messagesCache = _messagesCache.filter((m) => !idsToDelete.includes(m.id));
  vnDb.messages.bulkDelete(idsToDelete).catch(() => undefined);
}

export function editVnMessage(messageId: string, newRawContent: string): void {
  const idx = _messagesCache.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  _messagesCache[idx] = {
    ..._messagesCache[idx],
    rawContent: newRawContent,
  };
  vnDb.messages.put(_messagesCache[idx]).catch(() => undefined);
}

export function updateVnMessageFrameAudio(
  messageId: string,
  frameIndex: number,
  audio: VnFrameAudio,
): VnMessage | null {
  const idx = _messagesCache.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  const frameAudio = {
    ..._messagesCache[idx].frameAudio,
    [frameIndex]: audio,
  };
  _messagesCache[idx] = {
    ..._messagesCache[idx],
    frameAudio,
  };
  vnDb.messages.put(_messagesCache[idx]).catch(() => undefined);
  return _messagesCache[idx];
}

function updateVnSession(sessionId: string, updates: Partial<VnSession>): VnSession | null {
  const idx = _sessionsCache.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;
  const next: VnSession = {
    ..._sessionsCache[idx],
    ...updates,
    updatedAt: updates.updatedAt || new Date().toISOString(),
  };
  _sessionsCache[idx] = next;
  vnDb.sessions.put(next).catch(() => undefined);
  return next;
}

export function saveVnLayoutPrefs(sessionId: string, prefs: VnLayoutPrefs): void {
  updateVnSession(sessionId, { layoutPrefs: prefs });
}

export function updateChapterBeats(sessionId: string, chapterIndex: number, beats: VnBeat[]): void {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return;
  const chapters = [...session.chapters];
  if (!chapters[chapterIndex]) return;
  chapters[chapterIndex] = { ...chapters[chapterIndex], beats };
  updateVnSession(sessionId, { chapters });
}

export function setActiveBeatIndex(sessionId: string, chapterIndex: number, beatIndex: number): void {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return;
  const chapters = [...session.chapters];
  if (!chapters[chapterIndex]) return;
  chapters[chapterIndex] = { ...chapters[chapterIndex], activeBeatIndex: beatIndex };
  updateVnSession(sessionId, { chapters });
}

export function formatBeatsForPrompt(chapter: VnChapterMeta): { beatsList: string; currentBeat: string } {
  const beats = chapter.beats;
  if (!beats || beats.length === 0) return { beatsList: "", currentBeat: "" };
  const activeIdx = chapter.activeBeatIndex ?? 0;
  const lines = beats.map((b, i) => {
    const marker = i < activeIdx ? "✓" : i === activeIdx ? "→" : " ";
    return `${marker} ${i + 1}. ${b.title}`;
  });
  const current = beats[activeIdx];
  const currentText = current
    ? `${current.title}${current.description ? `：${current.description}` : ""}`
    : "";
  return { beatsList: lines.join("\n"), currentBeat: currentText };
}

export function startNewChapter(
  sessionId: string,
  title: string,
  subtitle?: string
): VnChapterMeta | null {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return null;

  const index = session.chapters.length;
  const chapter: VnChapterMeta = {
    id: generateId("vn_ch"),
    index,
    title,
    subtitle,
    startMessageId: "",
    archived: false,
  };

  const updatedChapters = [...session.chapters, chapter];
  updateVnSession(sessionId, {
    chapters: updatedChapters,
    activeChapterIndex: index,
  });

  return chapter;
}

export function archiveChapter(sessionId: string, chapterIndex: number): void {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return;

  const chapters = [...session.chapters];
  const ch = chapters[chapterIndex];
  if (!ch) return;

  // Find last message in this chapter
  const chapterMessages = loadVnMessagesForChapter(sessionId, chapterIndex);
  const lastMsg = chapterMessages[chapterMessages.length - 1];

  chapters[chapterIndex] = {
    ...ch,
    archived: true,
    endMessageId: lastMsg?.id,
  };

  updateVnSession(sessionId, { chapters });
}

function numberToChineseChapter(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 10) return digits[n];
  if (n === 10) return "十";
  if (n < 20) return `十${digits[n - 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(n);
}

/**
 * Delete a chapter and all of its messages. Later chapters/messages are
 * re-indexed so chapterIndex remains contiguous. The write is persisted in a
 * single IndexedDB transaction, while the in-memory caches update immediately.
 */
export function deleteVnChapter(sessionId: string, chapterIndex: number): boolean {
  const sessionIndex = _sessionsCache.findIndex((s) => s.id === sessionId);
  if (sessionIndex === -1) return false;

  const session = _sessionsCache[sessionIndex];
  if (!session.chapters[chapterIndex]) return false;

  const deletedMessageIds = _messagesCache
    .filter((message) => message.sessionId === sessionId && message.chapterIndex === chapterIndex)
    .map((message) => message.id);

  _messagesCache = _messagesCache
    .filter((message) => !(message.sessionId === sessionId && message.chapterIndex === chapterIndex))
    .map((message) => (
      message.sessionId === sessionId && message.chapterIndex > chapterIndex
        ? { ...message, chapterIndex: message.chapterIndex - 1 }
        : message
    ));

  const defaultTitlePattern = /^第[零一二三四五六七八九十百\d]+章$/;
  const chapters = session.chapters
    .filter((_, index) => index !== chapterIndex)
    .map((chapter, index) => ({
      ...chapter,
      index,
      title: defaultTitlePattern.test(chapter.title)
        ? `第${numberToChineseChapter(index + 1)}章`
        : chapter.title,
    }));

  let activeChapterIndex = session.activeChapterIndex;
  if (activeChapterIndex === chapterIndex) activeChapterIndex = -1;
  else if (activeChapterIndex > chapterIndex) activeChapterIndex -= 1;
  if (activeChapterIndex >= chapters.length) activeChapterIndex = -1;

  const remainingMessages = _messagesCache
    .filter((message) => message.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastMessage = remainingMessages[remainingMessages.length - 1];
  const updatedAt = new Date().toISOString();
  const nextSession: VnSession = {
    ...session,
    chapters,
    activeChapterIndex,
    updatedAt,
    lastMessageId: lastMessage?.id,
    lastMessagePreview: lastMessage
      ? lastMessage.rawContent.replace(/\s+/g, " ").trim().slice(0, 64)
      : undefined,
  };
  _sessionsCache[sessionIndex] = nextSession;

  vnDb.transaction("rw", vnDb.sessions, vnDb.messages, async () => {
    if (deletedMessageIds.length > 0) await vnDb.messages.bulkDelete(deletedMessageIds);
    if (remainingMessages.length > 0) await vnDb.messages.bulkPut(remainingMessages);
    await vnDb.sessions.put(nextSession);
  }).catch(() => undefined);

  return true;
}

export function updateChapterSummary(
  sessionId: string,
  chapterIndex: number,
  summary: string
): void {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return;

  const chapters = [...session.chapters];
  const ch = chapters[chapterIndex];
  if (!ch) return;

  chapters[chapterIndex] = {
    ...ch,
    summaryContent: summary,
    summaryTimestamp: new Date().toISOString(),
  };

  updateVnSession(sessionId, { chapters });
}

export function updateChapterStartMessageId(
  sessionId: string,
  chapterIndex: number,
  messageId: string
): void {
  const session = _sessionsCache.find((s) => s.id === sessionId);
  if (!session) return;

  const chapters = [...session.chapters];
  const ch = chapters[chapterIndex];
  if (!ch || ch.startMessageId) return;

  chapters[chapterIndex] = { ...ch, startMessageId: messageId };
  updateVnSession(sessionId, { chapters });
}

export type VnProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
};

function compactText(text: string, maxLen = 160): string {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

export function loadVnProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string }
): VnProjectionEntry[] {
  const session = _sessionsCache.find((s) => s.characterId === characterId);
  if (!session) return [];

  const projections: VnProjectionEntry[] = [];

  for (const chapter of session.chapters) {
    if (!chapter.archived || !chapter.summaryContent) continue;
    const ts = chapter.summaryTimestamp || session.updatedAt;
    if (options?.afterTimestamp && ts <= options.afterTimestamp) continue;

    const snippet = compactText(chapter.summaryContent, 500);
    if (!snippet) continue;

    const formattedTs = formatChatTimestamp(ts);
    projections.push({
      id: `vn_projection_${chapter.id}`,
      timestamp: ts,
      content: `[事件 ${formattedTs}] ${snippet}`,
    });
  }

  return projections;
}

// ── Global VN Config (key-value in IndexedDB) ──

let _configCache: Record<string, string> = {};
let _configHydrated = false;

async function hydrateConfig(): Promise<void> {
  if (_configHydrated) return;
  try {
    const rows = await vnDb.config.toArray();
    for (const r of rows) _configCache[r.key] = r.value;
  } catch { /* table may not exist yet */ }
  _configHydrated = true;
}

// Call during app init (alongside hydrateVnStorage)
hydrateVnStorage().then(() => hydrateConfig());

export function loadVnConfig(key: string): string {
  return _configCache[key] || "";
}

export function saveVnConfig(key: string, value: string): void {
  if (value) {
    _configCache[key] = value;
    vnDb.config.put({ key, value }).catch(() => undefined);
  } else {
    delete _configCache[key];
    vnDb.config.delete(key).catch(() => undefined);
  }
}
