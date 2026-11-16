
CREATE TABLE public.tbl_payment_audit_log (
    id bigserial NOT NULL,
    payment_type text NOT NULL,
    payment_id uuid NOT NULL,
    changed_by uuid,
    change_timestamp timestamp with time zone NOT NULL DEFAULT now(),
    changes jsonb NOT NULL,
    CONSTRAINT tbl_payment_audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT tbl_payment_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id)
);

-- RLS Policies
ALTER TABLE public.tbl_payment_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to service_role"
    ON public.tbl_payment_audit_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow read access to authenticated users"
    ON public.tbl_payment_audit_log
    FOR SELECT
    TO authenticated
    USING (true);
