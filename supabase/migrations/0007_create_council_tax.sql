
CREATE TABLE public.tbl_council_tax (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    tenancy_id uuid,
    billing_authority text NOT NULL,
    account_number text,
    billing_year integer NOT NULL,
    total_due numeric(10, 2) NOT NULL,
    payment_schedule jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tbl_council_tax_pkey PRIMARY KEY (id),
    CONSTRAINT tbl_council_tax_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.tbl_properties(id),
    CONSTRAINT tbl_council_tax_tenancy_id_fkey FOREIGN KEY (tenancy_id) REFERENCES public.tbl_tenancies(id)
);

CREATE TRIGGER handle_updated_at
    BEFORE UPDATE ON public.tbl_council_tax
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime('updated_at');

-- RLS Policies
ALTER TABLE public.tbl_council_tax ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to service_role"
    ON public.tbl_council_tax
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow read access to authenticated users"
    ON public.tbl_council_tax
    FOR SELECT
    TO authenticated
    USING (true);

