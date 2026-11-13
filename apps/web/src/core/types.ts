export type StudyDocument = {
  id: string;
  name: string;
  subject: string;
  file_type: string;
  size_bytes: number;
  status: string;
  error: string | null;
  created_at: string;
  scope?: "personal" | "knowledge";
  description?: string;
};
export type DocumentDetail = StudyDocument & {
  scope: "personal" | "knowledge";
  requested_chunk_available: boolean;
  excerpt: { id: string; content: string; page: number | null; section: string | null; paragraph: number | null } | null;
};
export type Conversation = { id: string; title: string; created_at: string };
export type StudyStreak = {
  current: number;
  longest: number;
  total_days: number;
  today_completed: boolean;
  last_study_date: string | null;
  today: string;
  timezone: "Asia/Ho_Chi_Minh";
  week: { date: string; completed: boolean }[];
};
export type Source = {
  id: string;
  document_id: string;
  label: string;
  document_name: string;
  page: number | null;
  section: string | null;
  paragraph: number | null;
  chunk_id: string | null;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  sequence: number;
  generation_provider: "ollama" | "openrouter" | "deploy" | null;
  message_sources: Source[];
  web_sources?: { label: string; title: string; url: string }[];
};
export type SourceDetail = Source & {
  available: boolean;
  content?: string;
  url?: string | null;
};
