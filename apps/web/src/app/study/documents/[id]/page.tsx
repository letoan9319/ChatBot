import { notFound, redirect } from "next/navigation";
import { sessionClient } from "@/core/supabase-server";
import { uuid } from "@/core/validation";
import { DocumentReader } from "@/components/document-reader";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chunk?: string; conversation?: string }>;
}) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/study");
  const db = await sessionClient(true);
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth");
  const query = await searchParams;
  const chunk = query.chunk ? uuid.safeParse(query.chunk) : null;
  const conversation = query.conversation ? uuid.safeParse(query.conversation) : null;
  if (chunk && !chunk.success) notFound();
  return <DocumentReader id={id} chunk={chunk?.data} conversation={conversation?.data} />;
}
