/**
 * The sample artifact offered on first load.
 *
 * It is deliberately awkward: a hyphenated key, an integer and a decimal in
 * one array, a null, an empty array, two same-named nested objects that must
 * not collide, and array items with differing shapes. Clicking "Load sample"
 * therefore demonstrates the engine's actual behaviour rather than a happy
 * path that any converter would handle.
 */
export const SAMPLE_JSON = `{
  "id": 42,
  "user-name": "Mahmoud",
  "price": 19.99,
  "active": true,
  "nickname": null,
  "tags": ["java", "spring"],
  "scores": [1, 2.5, null],
  "empty": [],
  "company": { "address": { "city": "Cairo" } },
  "customer": { "address": { "city": "Alexandria" } },
  "orders": [
    { "total": 9.99, "profile": { "city": "Giza" } },
    { "total": 5, "note": "gift", "profile": { "city": "Luxor", "zip": 123 } }
  ]
}`;
