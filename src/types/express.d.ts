import { AuthSessionUser } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthSessionUser | null;
      authSessionId?: string | null;
      csrfToken?: string | null;
      impersonatedBy?: AuthSessionUser | null;
      viewingAsUser?: AuthSessionUser | null;
    }
  }
}

export {};
