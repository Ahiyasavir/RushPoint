"use strict";
// ═══════════════════════════════════════════════════════════════════════════════
// @rushpoint/shared — canonical type definitions
//
// Firestore path convention (strictly enforced — never deviate):
//
//   PUBLIC  →  artifacts/{appId}/public/data/{collection}/{docId}
//   PRIVATE →  artifacts/{appId}/users/{userId}/{collection}/{docId}
//
// Collection name constants are in COLLECTIONS below.
// Path builder helpers are in FIRESTORE_PATHS below.
// ═══════════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIRESTORE_PATHS = exports.COLLECTIONS = void 0;
// ─── Firestore path helpers ───────────────────────────────────────────────────
/** Type-safe Firestore collection name constants. */
exports.COLLECTIONS = {
    // Public collections
    TASKS: 'tasks',
    EVENTS: 'events',
    LEADERBOARD: 'leaderboard',
    FLASH_MISSIONS: 'flashMissions',
    ADMIN_ALERTS: 'adminAlerts',
    // Private per-user collections
    PROFILE: 'profile',
    GAME_STATE: 'gameState',
    CHECK_INS: 'checkIns',
    ASSIGNMENTS: 'assignments',
};
/** Build Firestore collection paths consistently. */
exports.FIRESTORE_PATHS = {
    /** artifacts/{appId}/public/data/{collection} */
    public: (appId, collection) => `artifacts/${appId}/public/data/${collection}`,
    /** artifacts/{appId}/users/{userId}/{collection} */
    private: (appId, userId, collection) => `artifacts/${appId}/users/${userId}/${collection}`,
};
