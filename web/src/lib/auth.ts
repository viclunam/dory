import { supabase } from "./supabase";

export function signInWithGithub() {
  return supabase.auth.signInWithOAuth({
    provider: "github",
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function currentUser() {
  return supabase.auth.getUser();
}
