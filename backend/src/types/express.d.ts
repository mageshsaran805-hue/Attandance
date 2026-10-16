import type { AuthUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth after the session is verified against the database. */
      user?: AuthUser;
    }
  }
}

export {};
