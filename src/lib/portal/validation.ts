// Zod validation schemas for the RAIA Portal Feed API. Mirrors the field
// reference in docs/raia-portal-feed-build-guide.md.

import { z } from 'zod';

// ── Enums ───────────────────────────────────────────────────────────────────

export const StatusEnum = z.enum([
  'AVAILABLE',
  'UNDER_OFFER',
  'SOLD_STC',
  'SOLD_STCM',
  'RESERVED',
  'LET_AGREED',
  'OFF_MARKET',
  'WITHDRAWN'
]);
export type Status = z.infer<typeof StatusEnum>;

export const TransactionTypeEnum = z.enum(['SALES', 'LETTINGS']);
export type TransactionType = z.infer<typeof TransactionTypeEnum>;

export const PropertyTypeEnum = z.enum([
  'FLAT',
  'APARTMENT',
  'STUDIO',
  'MAISONETTE',
  'TERRACED',
  'END_TERRACE',
  'SEMI_DETACHED',
  'DETACHED',
  'BUNGALOW',
  'COTTAGE',
  'TOWNHOUSE',
  'LAND',
  'OTHER'
]);

export const TenureEnum = z.enum([
  'FREEHOLD',
  'LEASEHOLD',
  'SHARE_OF_FREEHOLD',
  'COMMONHOLD'
]);

export const FurnishingEnum = z.enum([
  'FURNISHED',
  'PART_FURNISHED',
  'UNFURNISHED',
  'FURNISHED_OR_UNFURNISHED'
]);

export const RentFrequencyEnum = z.enum(['MONTHLY', 'YEARLY', 'WEEKLY']);

export const ParkingEnum = z.enum([
  'OFF_STREET',
  'GARAGE',
  'ALLOCATED',
  'RESIDENT_PERMIT',
  'NONE'
]);

export const OutsideSpaceEnum = z.enum([
  'GARDEN',
  'BALCONY',
  'TERRACE',
  'PATIO',
  'COURTYARD',
  'ROOF_TERRACE'
]);

export const RemovalReasonEnum = z.enum([
  'SOLD_BY_US',
  'SOLD_BY_ANOTHER_AGENT',
  'LET_BY_US',
  'LET_BY_ANOTHER_AGENT',
  'WITHDRAWN_FROM_MARKET',
  'LOST_INSTRUCTION',
  'REMOVED'
]);

export const CommercialClassificationEnum = z.enum([
  'OFFICE',
  'INDUSTRIAL_AND_LOGISTICS',
  'RETAIL',
  'LEISURE_AND_HOSPITALITY',
  'LAND_AND_DEVELOPMENT',
  'OTHER'
]);

// ── Reusable shapes ─────────────────────────────────────────────────────────

export const ReferencePattern = /^[A-Za-z0-9_-]{1,100}$/;
export const RaiaIdPattern = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;

const isoCountry = z
  .string()
  .regex(/^[A-Z]{2}$/, 'country must be ISO 3166 alpha-2 (e.g. GB).');

const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be ISO 4217 (e.g. GBP).');

const epcLetter = z.string().regex(/^[A-G]$/, 'epc_rating must be a single letter A-G.');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD.');

const url1024 = z.string().url('Must be a valid URL.').max(1024);

const MediaAsset = z.object({
  url: url1024,
  description: z.string().max(200).optional(),
  order: z.number().int().min(0).optional(),
  etag: z.string().max(200).optional()
});

const MediaBlock = z
  .object({
    photos: z.array(MediaAsset).max(50).optional(),
    floor_plans: z.array(MediaAsset).max(20).optional(),
    epcs: z.array(MediaAsset).max(10).optional(),
    brochures: z
      .array(
        MediaAsset.refine(
          (a) => a.url.toLowerCase().endsWith('.pdf'),
          { message: 'brochure URLs must end in .pdf' }
        )
      )
      .max(10)
      .optional(),
    virtual_tours: z.array(MediaAsset).max(10).optional()
  })
  .strict();

const PublicCard = z
  .object({
    raia_id: z
      .string()
      .regex(RaiaIdPattern, 'public_card.raia_id must match prop-{cc}-{slug}-{n}.')
      .optional(),
    publish: z.boolean().optional().default(true),
    suppress_address: z.boolean().optional().default(true)
  })
  .strict();

const Address = z
  .object({
    display_address: z.string().min(1).max(120),
    postcode: z.string().min(1).max(12),
    country: isoCountry,
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional()
  })
  .strict();

// ── Residential ────────────────────────────────────────────────────────────

const ResidentialBase = z
  .object({
    kind: z.literal('residential'),
    transaction_type: TransactionTypeEnum,
    status: StatusEnum,
    property_type: PropertyTypeEnum,
    headline: z.string().min(1).max(200),
    description: z.string().max(10000).optional(),
    bedrooms: z.number().int().min(0).optional(),
    bathrooms: z.number().int().min(0).optional(),
    reception_rooms: z.number().int().min(0).optional(),
    floor_area_sqm: z.number().min(0).optional(),
    available_from: isoDate.optional(),
    asking_price: z.number().min(0).optional(),
    asking_rent_pcm: z.number().min(0).optional(),
    rent_frequency: RentFrequencyEnum.optional(),
    deposit: z.number().min(0).optional(),
    currency: isoCurrency.optional(),
    tenure: TenureEnum.optional(),
    furnishing: FurnishingEnum.optional(),
    epc_rating: epcLetter.optional(),
    features: z.array(z.string().max(200)).max(20).optional(),
    parking: z.array(ParkingEnum).optional(),
    outside_space: z.array(OutsideSpaceEnum).optional(),
    address: Address,
    media: MediaBlock.optional(),
    public_card: PublicCard.optional()
  })
  .strict();

export const ResidentialListing = ResidentialBase.superRefine((d, ctx) => {
  if (d.transaction_type === 'SALES' && d.asking_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'asking_price is required when transaction_type=SALES.',
      path: ['asking_price']
    });
  }
  if (d.transaction_type === 'LETTINGS' && d.asking_rent_pcm === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'asking_rent_pcm is required when transaction_type=LETTINGS.',
      path: ['asking_rent_pcm']
    });
  }
  if (d.tenure !== undefined && d.transaction_type !== 'SALES') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tenure is only valid for SALES.',
      path: ['tenure']
    });
  }
  if (d.furnishing !== undefined && d.transaction_type !== 'LETTINGS') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'furnishing is only valid for LETTINGS.',
      path: ['furnishing']
    });
  }
});

// ── Commercial ──────────────────────────────────────────────────────────────

const CommercialClassification = z
  .object({
    classification: CommercialClassificationEnum,
    sub_type: z.string().max(80).optional()
  })
  .strict();

const CommercialPricing = z
  .object({
    asking_price: z.number().min(0).optional(),
    asking_rent_pa: z.number().min(0).optional(),
    rent_frequency: RentFrequencyEnum.optional(),
    currency: isoCurrency.optional()
  })
  .strict();

const CommercialSpace = z
  .object({
    reference: z.string().regex(ReferencePattern),
    primary_classification: CommercialClassification,
    floor_area_sqm: z.number().min(0).optional(),
    pricing: CommercialPricing.optional(),
    description: z.string().max(10000).optional(),
    media: MediaBlock.optional()
  })
  .strict();

const CommercialBuilding = z
  .object({
    reference: z.string().regex(ReferencePattern),
    status: StatusEnum,
    primary_classification: CommercialClassification,
    address: Address,
    description: z.string().max(10000).optional(),
    pricing: CommercialPricing.optional(),
    media: MediaBlock.optional(),
    spaces: z.array(CommercialSpace).max(50).optional()
  })
  .strict();

const CommercialBase = z
  .object({
    kind: z.literal('commercial'),
    transaction_type: TransactionTypeEnum,
    building: CommercialBuilding,
    public_card: PublicCard.optional()
  })
  .strict();

export const CommercialListing = CommercialBase.superRefine((d, ctx) => {
    const spaces = d.building.spaces || [];

    // Space references must be unique and != building reference.
    const seen = new Set<string>();
    for (let i = 0; i < spaces.length; i++) {
      const ref = spaces[i].reference;
      if (ref === d.building.reference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'space.reference must differ from building.reference.',
          path: ['building', 'spaces', i, 'reference']
        });
      }
      if (seen.has(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'space.reference must be unique within the building.',
          path: ['building', 'spaces', i, 'reference']
        });
      }
      seen.add(ref);
    }

    // Pricing requirement: building OR every space.
    const buildingHasPricing =
      !!d.building.pricing &&
      (d.building.pricing.asking_price !== undefined ||
        d.building.pricing.asking_rent_pa !== undefined);
    if (!buildingHasPricing && spaces.length > 0) {
      const allSpacesHavePricing = spaces.every(
        (s) =>
          !!s.pricing &&
          (s.pricing.asking_price !== undefined ||
            s.pricing.asking_rent_pa !== undefined)
      );
      if (!allSpacesHavePricing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'pricing required at building level when not every space has pricing.',
          path: ['building', 'pricing']
        });
      }
    }
  });

// ── Discriminated union ────────────────────────────────────────────────────

// Discriminated-union members must be plain ZodObjects, so we use the
// *Base* schemas here and apply each kind's cross-field refinements separately
// in parseListingPayload below.
export const ListingPayload = z.discriminatedUnion('kind', [
  ResidentialBase,
  CommercialBase
]);
export type ListingPayloadT = z.infer<typeof ListingPayload>;

// We expose a single parser that runs the residential refinements after the
// discriminated union narrows the type.
export function parseListingPayload(input: unknown):
  | { ok: true; data: ListingPayloadT }
  | { ok: false; errors: Array<{ field: string; message: string; code: string }> } {
  const initial = ListingPayload.safeParse(input);
  if (!initial.success) {
    return {
      ok: false,
      errors: initial.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
        code: 'INVALID'
      }))
    };
  }
  if (initial.data.kind === 'residential') {
    const refined = ResidentialListing.safeParse(input);
    if (!refined.success) {
      return {
        ok: false,
        errors: refined.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: 'INVALID'
        }))
      };
    }
    return { ok: true, data: refined.data };
  }
  const refinedCommercial = CommercialListing.safeParse(input);
  if (!refinedCommercial.success) {
    return {
      ok: false,
      errors: refinedCommercial.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
        code: 'INVALID'
      }))
    };
  }
  return { ok: true, data: refinedCommercial.data };
}

// ── Delete body ────────────────────────────────────────────────────────────

export const DeleteListingBody = z
  .object({
    removal_reason: RemovalReasonEnum,
    branch_id: z.union([z.string().min(1), z.number().int()]).optional(),
    removed_at: z.string().datetime().optional(),
    note: z.string().max(500).optional()
  })
  .strict();
export type DeleteListingBodyT = z.infer<typeof DeleteListingBody>;

// ── Product activations ────────────────────────────────────────────────────

export const PremiumActivationRequest = z
  .object({
    listing_id: z.string().min(1).optional(),
    customer_listing_id: z.string().regex(ReferencePattern).optional(),
    branch_id: z.string().min(1).optional(),
    highlights: z
      .array(z.object({ id: z.number().int().min(1) }).strict())
      .max(10)
      .optional()
  })
  .strict()
  .refine(
    (d) => !!d.listing_id || !!d.customer_listing_id,
    {
      message: 'At least one of listing_id or customer_listing_id is required.',
      path: ['customer_listing_id']
    }
  );

export const FeaturedActivationRequest = z
  .object({
    listing_id: z.string().min(1).optional(),
    customer_listing_id: z.string().regex(ReferencePattern).optional(),
    branch_id: z.string().min(1).optional()
  })
  .strict()
  .refine(
    (d) => !!d.listing_id || !!d.customer_listing_id,
    {
      message: 'At least one of listing_id or customer_listing_id is required.',
      path: ['customer_listing_id']
    }
  );

export function zodIssuesToValidationErrors(issues: z.ZodIssue[]) {
  return issues.map((i) => ({
    field: i.path.join('.'),
    message: i.message,
    code: 'INVALID'
  }));
}
