-- "security_logs" tablosu için silme izni tanımlama
create policy "Enable delete for authenticated users only"
on "public"."security_logs"
as permissive
for delete
to authenticated
using (true);
