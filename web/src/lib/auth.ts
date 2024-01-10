import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function signInWithGithub() {
  return supabase.auth.signInWithOAuth({
    provider: "github",
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function currentSession() {
  return supabase.auth.getSession();
}

type AuthStateChangeCallback = Parameters<
  typeof supabase.auth.onAuthStateChange
>[0];

export function onAuthStateChange(callback: AuthStateChangeCallback) {
  return supabase.auth.onAuthStateChange(callback);
}
