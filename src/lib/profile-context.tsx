"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  analyses_used: number;
  analyses_limit: number;
  clips_used: number;
  clips_limit: number;
  username: string | null;
  email: string | null;
  plan: string;
};

const ProfileContext = createContext<{
  profile: Profile | null;
  refresh: () => void;
}>({ profile: null, refresh: () => {} });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/profile", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setProfile({
            analyses_used: data.analyses_used ?? 0,
            analyses_limit: data.analyses_limit ?? 3,
            clips_used: data.clips_used ?? 0,
            clips_limit: data.clips_limit ?? 0,
            username: data.username ?? null,
            email: data.email ?? null,
            plan: data.plan ?? "free",
          });
        } else {
          setProfile(null);
        }
      })
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  return (
    <ProfileContext.Provider value={{ profile, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
