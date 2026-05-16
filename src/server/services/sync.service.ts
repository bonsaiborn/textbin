interface NoteUpdateEvent {
  type: "note-updated";
  filename: string;
  version: number;
  updatedAt: string;
}

type Subscriber = {
  send: (event: NoteUpdateEvent) => void;
  close: () => void;
};

const subscribers = new Map<string, Set<Subscriber>>();

function getNoteKey(username: string, filename: string): string {
  return `${username}:${filename}`;
}

export function subscribeToNote(
  username: string,
  filename: string,
  send: (event: NoteUpdateEvent) => void,
  close: () => void
) {
  const key = getNoteKey(username, filename);
  const set = subscribers.get(key) ?? new Set<Subscriber>();
  const subscriber: Subscriber = { send, close };
  set.add(subscriber);
  subscribers.set(key, set);

  return () => {
    const current = subscribers.get(key);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      subscribers.delete(key);
    }
  };
}

export function publishNoteUpdated(username: string, filename: string, version: number, updatedAt: string) {
  const key = getNoteKey(username, filename);
  const current = subscribers.get(key);
  if (!current) {
    return;
  }

  const payload: NoteUpdateEvent = {
    type: "note-updated",
    filename,
    version,
    updatedAt
  };

  for (const subscriber of current) {
    subscriber.send(payload);
  }
}

export function getSubscriberCount(username: string, filename: string): number {
  return subscribers.get(getNoteKey(username, filename))?.size ?? 0;
}

export function resetSyncSubscribers() {
  for (const set of subscribers.values()) {
    for (const subscriber of set) {
      subscriber.close();
    }
  }
  subscribers.clear();
}
