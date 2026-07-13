-- Give every existing tenant the default ID-card design as a real row value.
--
-- Behaviourally this is a no-op: resolveCardDesign() in routes/companies.ts
-- already merges these defaults underneath whatever is stored, so a NULL column
-- has always rendered as the navy default. Persisting it just makes the design an
-- explicit, editable record rather than an implicit fallback.
--
-- teacherName stays empty on purpose — resolveCardDesign falls back to the company
-- name, so a tenant that renames itself doesn't keep a stale name on its cards.
--
-- Only NULL rows are touched, so a tenant that has already customised its card
-- design is never overwritten.
UPDATE companies
SET card_design = '{
  "template": "navy",
  "teacherName": "",
  "teacherTitle": "",
  "phone": "",
  "whatsapp": "",
  "email": "",
  "location": "",
  "qrLink": "",
  "slogan": "التفوق لا يأتي صدفة\nبل هو نتيجة الإجتهاد والثقة بالله",
  "instructions": [
    "يحافظ الطالب على البطاقة وعدم إعارتها.",
    "في حالة فقدان البطاقة يتم إبلاغ المعلم فوراً.",
    "تُستخدم البطاقة في الحضور والانصراف.",
    "المحافظة على البطاقة وعدم العبث بها.",
    "الالتزام بالقوانين دليل على احترامك لنفسك وللآخرين."
  ],
  "highlights": [
    "شرح مبسط وفهم عميق",
    "مراجعات نهائية",
    "اختبارات دورية",
    "متابعة مستمرة وتقييم شامل"
  ]
}'::jsonb,
    updated_at = NOW()
WHERE card_design IS NULL;
