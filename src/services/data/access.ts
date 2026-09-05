import { supabase } from './supabase';

export type UserRole = 'teacher' | 'student';

export interface UserAccess {
  user_id: string;
  email: string;
  status: 'pending' | 'approved' | 'revoked';
  trial_ends_at: string | null;
  requested_at: string;
  role: UserRole;
}

export async function getMyAccess(userId: string): Promise<UserAccess | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('user_access').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createAccessRequest(userId: string, email: string, role: UserRole = 'teacher'): Promise<void> {
  if (!supabase) return;
  await supabase.from('user_access').insert({ user_id: userId, email, status: 'pending', role });
}

export async function getAllAccess(): Promise<UserAccess[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('user_access').select('*').order('requested_at', { ascending: false });
  return data ?? [];
}

export async function approveUser(userId: string, trialDays = 30): Promise<boolean> {
  if (!supabase) return false;
  const trial_ends_at = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('user_access').update({ status: 'approved', trial_ends_at }).eq('user_id', userId);
  return !error;
}

export async function revokeUser(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('user_access').update({ status: 'revoked', trial_ends_at: null }).eq('user_id', userId);
  return !error;
}

export async function extendTrial(userId: string, days = 30): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from('user_access').select('trial_ends_at').eq('user_id', userId).maybeSingle();
  const base = data?.trial_ends_at ? new Date(data.trial_ends_at) : new Date();
  const trial_ends_at = new Date(Math.max(base.getTime(), Date.now()) + days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('user_access').update({ status: 'approved', trial_ends_at }).eq('user_id', userId);
  return !error;
}
