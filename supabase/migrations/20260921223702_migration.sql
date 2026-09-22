update triagem_records tr
set status='void', result_score=null, graded_at=now(),
    reason = coalesce(reason, '[]'::jsonb) || '["Dado indisponível"]'::jsonb
where tr.passed and tr.status='pending'
  and tr.kickoff < now() - interval '3 hours'
  and tr.fixture_id in (
    select p.fixture_id
    from (
      select fixture_id, kickoff
      from triagem_records
      where passed and status='pending' and kickoff < now() - interval '3 hours'
      group by fixture_id, kickoff
    ) p
    left join (
      select fixture_id, status from auto_tickets
      where fixture_id in (
        select fixture_id from triagem_records
        where passed and status='pending' and kickoff < now() - interval '3 hours'
      )
    ) at using (fixture_id)
    where at.status = 'void'
       or (at.status is distinct from 'void'
           and extract(epoch from (now() - p.kickoff))/3600.0 >= 12)
  );
