'use client';

import type { CurrentUser, Permission } from '@kenisha/shared';
import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PlatformMe } from '../api/types';
import { type SessionManager, platformSession, staffSession } from './session-manager';

interface SessionValue<Me> {
  me: Me;
  session: SessionManager;
  logout: () => Promise<void>;
}

/**
 * Restores the session on page load from the HttpOnly refresh cookie (nothing sensitive is
 * kept in browser storage) and sends the user to the sign-in page when there is none.
 */
function createSessionProvider<Me>(
  session: SessionManager,
  mePath: string,
  logoutPath: string,
  loginPath: string,
) {
  const Context = createContext<SessionValue<Me> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      let active = true;
      session
        .request<Me>(mePath)
        .then((value) => active && setMe(value))
        .catch(() => {
          if (!active) return;
          setFailed(true);
          router.replace(loginPath);
        });
      return () => {
        active = false;
      };
    }, [router]);

    const logout = useCallback(async () => {
      try {
        await session.request(logoutPath, { method: 'POST' });
      } finally {
        session.clear();
        router.replace(loginPath);
      }
    }, [router]);

    if (!me) {
      return (
        <p className="p-8 text-sm text-muted-foreground" role="status">
          {failed ? 'Redirecting to sign in…' : 'Loading…'}
        </p>
      );
    }
    return <Context.Provider value={{ me, session, logout }}>{children}</Context.Provider>;
  }

  function useSession(): SessionValue<Me> {
    const value = useContext(Context);
    if (!value) throw new Error('useSession must be used inside its provider');
    return value;
  }

  return { Provider, useSession };
}

const staff = createSessionProvider<CurrentUser>(
  staffSession,
  '/auth/me',
  '/auth/logout',
  '/login',
);
export const StaffSessionProvider = staff.Provider;
export const useStaffSession = staff.useSession;

const platform = createSessionProvider<PlatformMe>(
  platformSession,
  '/platform/auth/me',
  '/platform/auth/logout',
  '/platform/login',
);
export const PlatformSessionProvider = platform.Provider;
export const usePlatformSession = platform.useSession;

/** UI convenience only — the API enforces every permission itself. */
export function useCan(): (permission: Permission) => boolean {
  const { me } = useStaffSession();
  return (permission) => me.permissions.includes(permission);
}
