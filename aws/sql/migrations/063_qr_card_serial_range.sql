-- QR pool cards get a RESERVED serial range, above every organic student code.
--
-- Linking a card now gives the student the card's number as their student_code, and
-- a new student's code is MAX(student_code) + 1. Without a reserved range those two
-- sequences collide: link card 5, the next new student is assigned code 6, and card
-- 6 can never be linked. Serials therefore start above 100000, and the next student
-- code is computed only from codes BELOW it (see students.ts / crm.ts).
--
-- Cards printed before this ran carry serials 1..N. Lift them clear.

UPDATE qr_cards
   SET serial = serial + 100000
 WHERE serial <= 100000;

-- A card already in a student's hand just changed number, and the number on the card
-- is the number staff type — so the student's code follows the card.
UPDATE students s
   SET student_code = c.serial,
       updated_at   = NOW()
  FROM qr_cards c
 WHERE c.student_id = s.id
   AND s.student_code IS DISTINCT FROM c.serial
   AND NOT EXISTS (
         SELECT 1 FROM students o
          WHERE o.company_id = s.company_id
            AND o.student_code = c.serial
            AND o.id <> s.id);

-- Sold per academy: off until we switch it on for that tenant.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS qr_cards_enabled BOOLEAN NOT NULL DEFAULT false;
