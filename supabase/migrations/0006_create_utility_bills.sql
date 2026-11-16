
CREATE TABLE public.tbl_utility_bills (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    tenancy_id uuid,
    utility_type text NOT NULL,
    provider text,
    account_number text,
    billing_period_start date,
    billing_period_end date,
    due_date date NOT NULL,
    amount_due numeric(10, 2) NOT NULL,
    amount_paid numeric(10, 2),
    payment_date date,
    status text NOT NULL DEFAULT 'due'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tbl_utility_bills_pkey PRIMARY KEY (id),
    CONSTRAINT tbl_utility_bills_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.tbl_properties(id),
    CONSTRAINT tbl_utility_bills_tenancy_id_fkey FOREIGN KEY (tenancy_id) REFERENCES public.tbl_tenancies(id)
);

CREATE TRIGGER handle_updated_at
    BEFORE UPDATE ON public.tbl_utility_bills
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime('updated_at');

-- RLS Policies
ALTER TABLE public.tbl_utility_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to service_role"
    ON public.tbl_utility_bills
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow read access to authenticated users"
    ON public.tbl_utility_bills
    FOR SELECT
    TO authenticated
    USING (true);
    
    