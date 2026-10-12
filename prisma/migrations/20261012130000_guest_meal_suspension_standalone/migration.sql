-- guest_meal_suspended now stands on its own: it is honoured whatever the
-- meal status, so a boarder can keep their regular meal with guest booking
-- closed. Until now it was ignored outside SUSPENDED, and rows that left
-- SUSPENDED some other way (a transfer to alumni sets INACTIVE) kept a stale
-- true. Clear those so nobody loses guest booking on deploy.
UPDATE "meals" SET "guest_meal_suspended" = false
WHERE "status" <> 'SUSPENDED' AND "guest_meal_suspended" = true;
