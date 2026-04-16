# Partner logos

Drop your partner logos into this folder and reference them from
`src/app/landing.component.ts` → `partners` array.

## Recommended format

- **SVG** preferred (scales crisp on retina, small file size)
- PNG with transparent background also fine
- Target aspect ratio: roughly 3:1 (wide), max height 40px
- Avoid JPG / backgrounds — cards on the page are white

## How to add a new partner

1. Save the logo here, e.g. `partners/acme.svg`
2. Open `src/app/landing.component.ts`
3. Add an entry to the `partners: Partner[]` array:
   ```ts
   { name: 'ACME Corp', logo: 'partners/acme.svg' },
   ```
4. Omit `logo` to fall back to a text card:
   ```ts
   { name: 'ACME Corp' },
   ```

If the file is missing at runtime the card automatically falls back to the
partner name — so you can commit the array first and add logos later.
