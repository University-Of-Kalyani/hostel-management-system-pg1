-- A meal suspension can now also take away guest meal booking. A plain
-- suspension keeps guest meals open, as it always has, so every existing row
-- starts out false.
ALTER TABLE "meals" ADD COLUMN "guest_meal_suspended" BOOLEAN NOT NULL DEFAULT false;
