create function public.app_get_document_ocr(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.documents; text_value text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into d from public.documents where id=p_id and status='ready'
    and (user_id=auth.uid() or app_private.can_read_document(id));
  if not found then raise exception 'NOT_FOUND'; end if;

  select string_agg(
    case when page is null then content else format('## Trang %s%s%s',page,E'\n\n',content) end,
    E'\n\n' order by first_ordinal
  ) into text_value
  from (
    select page,min(ordinal) as first_ordinal,string_agg(content,E'\n\n' order by ordinal) as content
    from public.document_chunks
    where document_id=d.id and user_id=d.user_id and index_version=d.index_version
    group by page
  ) pages;

  if text_value is null then raise exception 'OCR_UNAVAILABLE'; end if;
  return jsonb_build_object('text',text_value);
end $$;

revoke all on function public.app_get_document_ocr(uuid) from public,anon,authenticated;
grant execute on function public.app_get_document_ocr(uuid) to authenticated;
