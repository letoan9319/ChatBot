export type StudyDocument = {
  id: string;
  name: string;
  subject: string;
  file_type: string;
  size_bytes: number;
  status: string;
  error: string | null;
  created_at: string;
};
export type Conversation = { id: string; title: string; created_at: string };
export type Source = {
  id: string;
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
  generation_provider: "ollama" | "openrouter" | null;
  message_sources: Source[];
};
export type SourceDetail = Source & {
  available: boolean;
  content?: string;
  url?: string | null;
};
