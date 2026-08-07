-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'INSTRUCTOR', 'FRONT_DESK');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('APPOINTMENT', 'EVENT', 'COURSE_SERIES');

-- CreateEnum
CREATE TYPE "StaffPreference" AS ENUM ('MANUAL', 'LEAST_BUSY', 'MOST_BUSY', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('FIXED', 'SERVICE_AREA', 'CUSTOMER_SUPPLIED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('WHEEL', 'KILN', 'SLAB_ROLLER', 'KIT', 'VEHICLE', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "AvailabilityRuleType" AS ENUM ('WORKING', 'BREAK');

-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('DAY_OFF', 'CUSTOM_HOURS', 'EXTRA_HOURS');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'INSTRUCTOR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "booking_mode" "BookingMode" NOT NULL DEFAULT 'APPOINTMENT',
    "duration_minutes" INTEGER NOT NULL,
    "slot_granularity_minutes" INTEGER NOT NULL DEFAULT 15,
    "capacity_min" INTEGER NOT NULL DEFAULT 1,
    "capacity_max" INTEGER NOT NULL DEFAULT 1,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "deposit_type" TEXT NOT NULL DEFAULT 'none',
    "deposit_value" INTEGER NOT NULL DEFAULT 0,
    "padding_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "padding_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "max_horizon_days" INTEGER NOT NULL DEFAULT 120,
    "staff_preference" "StaffPreference" NOT NULL DEFAULT 'MANUAL',
    "skill_level" TEXT,
    "prerequisite_service_type_id" UUID,
    "color" TEXT NOT NULL DEFAULT '#A6522C',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "bio" TEXT,
    "photo_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "color" TEXT NOT NULL DEFAULT '#A6522C',
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_bookings_per_day" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_services" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "price_override_cents" INTEGER,

    CONSTRAINT "staff_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "timezone" TEXT,
    "sms_consent_at" TIMESTAMPTZ(3),
    "marketing_consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" "LocationType" NOT NULL DEFAULT 'FIXED',
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "radius_meters" INTEGER,
    "boundary" geography(Polygon, 4326),
    "travel_fee_bands" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_locations" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,

    CONSTRAINT "staff_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_locations" (
    "id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,

    CONSTRAINT "service_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID,
    "name" TEXT NOT NULL,
    "resource_type" "ResourceType" NOT NULL DEFAULT 'OTHER',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_resources" (
    "id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "quantity_per_seat" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "booking_id" UUID,
    "session_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "location_id" UUID,
    "rule_type" "AvailabilityRuleType" NOT NULL DEFAULT 'WORKING',
    "rrule" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "override_type" "OverrideType" NOT NULL,
    "local_date" TEXT NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "busy_blocks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "external_source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "busy_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_series" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cohort_label" TEXT,
    "session_count" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "course_series_id" UUID,
    "series_index" INTEGER,
    "staff_id" UUID,
    "location_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "local_start_time" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "session_id" UUID,
    "staff_id" UUID,
    "location_id" UUID,
    "service_address" JSONB,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "travel_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "cancel_token" BYTEA NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_holds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID,
    "staff_id" UUID,
    "customer_id" UUID,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "checkout_reference" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_time_blocks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "booking_id" UUID,
    "session_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'booking',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_time_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_organization_id_name_key" ON "service_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "service_types_organization_id_is_active_idx" ON "service_types"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_organization_id_slug_key" ON "service_types"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "staff_organization_id_is_active_idx" ON "staff"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_organization_id_email_key" ON "staff"("organization_id", "email");

-- CreateIndex
CREATE INDEX "staff_services_service_type_id_idx" ON "staff_services"("service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_services_staff_id_service_type_id_key" ON "staff_services"("staff_id", "service_type_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_idx" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "locations_organization_id_is_active_idx" ON "locations"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_locations_staff_id_location_id_key" ON "staff_locations"("staff_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_locations_service_type_id_location_id_key" ON "service_locations"("service_type_id", "location_id");

-- CreateIndex
CREATE INDEX "resources_organization_id_is_active_idx" ON "resources"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "service_resources_service_type_id_resource_id_key" ON "service_resources"("service_type_id", "resource_id");

-- CreateIndex
CREATE INDEX "resource_allocations_resource_id_starts_at_ends_at_idx" ON "resource_allocations"("resource_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "resource_allocations_organization_id_idx" ON "resource_allocations"("organization_id");

-- CreateIndex
CREATE INDEX "availability_rules_staff_id_effective_from_idx" ON "availability_rules"("staff_id", "effective_from");

-- CreateIndex
CREATE INDEX "availability_rules_organization_id_idx" ON "availability_rules"("organization_id");

-- CreateIndex
CREATE INDEX "availability_overrides_organization_id_idx" ON "availability_overrides"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "availability_overrides_staff_id_local_date_override_type_key" ON "availability_overrides"("staff_id", "local_date", "override_type");

-- CreateIndex
CREATE INDEX "busy_blocks_staff_id_starts_at_ends_at_idx" ON "busy_blocks"("staff_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "busy_blocks_staff_id_external_source_external_id_key" ON "busy_blocks"("staff_id", "external_source", "external_id");

-- CreateIndex
CREATE INDEX "course_series_organization_id_idx" ON "course_series"("organization_id");

-- CreateIndex
CREATE INDEX "sessions_organization_id_starts_at_idx" ON "sessions"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_service_type_id_starts_at_idx" ON "sessions"("service_type_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_course_series_id_series_index_idx" ON "sessions"("course_series_id", "series_index");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_cancel_token_key" ON "bookings"("cancel_token");

-- CreateIndex
CREATE INDEX "bookings_organization_id_starts_at_idx" ON "bookings"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_session_id_idx" ON "bookings"("session_id");

-- CreateIndex
CREATE INDEX "bookings_staff_id_starts_at_idx" ON "bookings"("staff_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");

-- CreateIndex
CREATE INDEX "booking_holds_expires_at_released_at_idx" ON "booking_holds"("expires_at", "released_at");

-- CreateIndex
CREATE INDEX "booking_holds_session_id_idx" ON "booking_holds"("session_id");

-- CreateIndex
CREATE INDEX "staff_time_blocks_staff_id_starts_at_ends_at_idx" ON "staff_time_blocks"("staff_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "staff_time_blocks_organization_id_idx" ON "staff_time_blocks"("organization_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organization_id_key_key" ON "idempotency_keys"("organization_id", "key");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_series" ADD CONSTRAINT "course_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_series" ADD CONSTRAINT "course_series_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_course_series_id_fkey" FOREIGN KEY ("course_series_id") REFERENCES "course_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_blocks" ADD CONSTRAINT "staff_time_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_blocks" ADD CONSTRAINT "staff_time_blocks_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_blocks" ADD CONSTRAINT "staff_time_blocks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_blocks" ADD CONSTRAINT "staff_time_blocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
