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
  credits_used: number;
  credits_limit: number;
  username: string | null;
  email: string | null;
  plan: string;
};

const ProfileContext = createContext<{
  profile: Profile | null;
  profileLoading: boolean;
  refresh: () => void;
}>({ profile: null, profileLoading: true, refresh: () => {} });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/profile", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setProfile({
            analyses_used: data.analyses_used ?? 0,
            analyses_limit: data.analyses_limit ?? 5,
            credits_used: data.credits_used ?? 0,
            credits_limit: data.credits_limit ?? 30,
            username: data.username ?? null,
            email: data.email ?? null,
            plan: data.plan ?? "free",
          });
        } else {
          setProfile(null);
        }
      })
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
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
    <ProfileContext.Provider value={{ profile, profileLoading, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
