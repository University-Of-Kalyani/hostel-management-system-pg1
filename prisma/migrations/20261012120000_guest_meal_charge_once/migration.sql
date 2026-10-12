-- Two managers approving the same guest meal at the same moment could each
-- insert a charge (see src/lib/ledger.ts). The second read the same previous
-- balance as the first, so it never reached the running balance - it only
-- inflated "Total charged". Drop those, keeping the first row per meal.
--
-- Only a duplicate that left the balance where the row before it was is
-- dropped. One that did move the balance would need every later row
-- rewritten, so it is left alone and the unique index below fails the deploy
-- rather than guessing.
DELETE FROM "user_bills" b
USING (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "guest_meal_id", "type" ORDER BY "created_at", "id"
         ) AS "nth",
         "balance_remaining" - lag("balance_remaining") OVER (
           PARTITION BY "user_id" ORDER BY "created_at", "id"
         ) AS "moved"
  FROM "user_bills"
) d
WHERE b."id" = d."id"
  AND b."guest_meal_id" IS NOT NULL
  AND d."nth" > 1
  AND abs(d."moved") < 0.005;

-- CreateIndex
CREATE UNIQUE INDEX "user_bills_guest_meal_id_type_key" ON "user_bills"("guest_meal_id", "type");
