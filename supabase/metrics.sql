-- Run as the database owner. Aggregates only, no document/message content.
select kind,
       count(*) as jobs,
       count(*) filter(where status='failed') as failed,
       percentile_cont(0.5) within group(order by extract(epoch from started_at-created_at)) as queue_p50_seconds,
       percentile_cont(0.95) within group(order by extract(epoch from started_at-created_at)) as queue_p95_seconds,
       percentile_cont(0.5) within group(order by extract(epoch from finished_at-started_at)) as processing_p50_seconds,
       percentile_cont(0.95) within group(order by extract(epoch from finished_at-started_at)) as processing_p95_seconds
from public.jobs
where created_at > now()-interval '7 days'
group by kind;

-- Processing time includes backoff and retries after the first attempt.
