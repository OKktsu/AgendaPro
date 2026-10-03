CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment" ADD CONSTRAINT "no_overlapping_scheduled_appointments"
EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
)
WHERE ("status" = 'SCHEDULED');
