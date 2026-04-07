const STORAGE_KEY = "pf2e-relic-sheet-v1";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyDb() {
  return {
    version: 1,
    activeId: null,
    characters: {},
  };
}

function readDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyDb();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.characters && typeof parsed.characters === "object") {
      return {
        version: 1,
        activeId: parsed.activeId || null,
        characters: parsed.characters,
      };
    }
    // Backward compatibility: old single-state payload
    if (parsed && parsed.version === 1 && parsed.base) {
      const id = parsed.saveMeta?.saveId || uid();
      parsed.saveMeta = parsed.saveMeta || {};
      parsed.saveMeta.saveId = id;
      parsed.saveMeta.saveName = parsed.saveMeta.saveName || "New Save";
      parsed.saveMeta.lastSavedAt = Date.now();
      return { version: 1, activeId: id, characters: { [id]: parsed } };
    }
  } catch (_err) {
    return emptyDb();
  }
  return emptyDb();
}

function writeDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function saveState(state) {
  const db = readDb();
  const next = structuredClone(state || {});
  next.saveMeta = next.saveMeta || {};
  if (!next.saveMeta.saveId) next.saveMeta.saveId = uid();
  if (!next.saveMeta.saveName) next.saveMeta.saveName = "New Save";
  next.saveMeta.lastSavedAt = Date.now();
  db.characters[next.saveMeta.saveId] = next;
  db.activeId = next.saveMeta.saveId;
  writeDb(db);
}

export function loadState() {
  const db = readDb();
  if (db.activeId && db.characters[db.activeId]) {
    return structuredClone(db.characters[db.activeId]);
  }
  const first = Object.keys(db.characters)[0];
  if (first) return structuredClone(db.characters[first]);
  return null;
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function listCharacterSaves() {
  const db = readDb();
  return Object.entries(db.characters).map(([id, state]) => ({
    id,
    saveName: String(state?.saveMeta?.saveName || "New Save"),
    characterName: String(state?.base?.characterName || "Character"),
    lastSavedAt: Number(state?.saveMeta?.lastSavedAt || 0),
    isActive: db.activeId === id,
  }));
}

export function loadCharacterById(id) {
  const db = readDb();
  const row = db.characters[String(id || "")];
  return row ? structuredClone(row) : null;
}
