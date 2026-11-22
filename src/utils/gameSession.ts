import { info } from "@tauri-apps/plugin-log";
import type { GameRecord } from "@/utils/playerProfile";

export type StoredGameSession = {
    gameId: string;
    record: GameRecord;
};

const keyFor = (tabId: string) => `game-session:${tabId}`;

export function saveGameSession(tabId: string, session: StoredGameSession): void {
    try {
        sessionStorage.setItem(keyFor(tabId), JSON.stringify(session));
        info(`[session] saved ${session.gameId} for tab ${tabId}`);
    } catch {
        // sessionStorage may be unavailable.
    }
}

export function readGameSession(tabId: string): StoredGameSession | null {
    try {
        const raw = sessionStorage.getItem(keyFor(tabId));
        if (!raw) {
            info(`[session] no saved game for tab ${tabId}`);
            return null;
        }
        const parsed = JSON.parse(raw) as StoredGameSession;
        if (!parsed || typeof parsed.gameId !== "string" || !parsed.record) {
            return null;
        }
        info(`[session] found saved game ${parsed.gameId} for tab ${tabId}`);
        return parsed;
    } catch {
        return null;
    }
}

export function clearGameSession(tabId: string): void {
    try {
        sessionStorage.removeItem(keyFor(tabId));
        info(`[session] cleared game for tab ${tabId}`);
    } catch {
        // sessionStorage may be unavailable.
    }
}
