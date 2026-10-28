// Generated from backend/app/data/wardrobe_sections.json by scripts/gen-shared-data.mjs.
// Do not edit by hand; run `npm run vocab:gen`.
export const STANDARD_SECTION_KEYS = ['tops', 'knitwear', 'outerwear', 'trousers', 'footwear', 'accessories'] as const;
export const HIDDEN_SECTION_KEYS = ['skirts', 'dresses', 'suits', 'bags', 'hosiery'] as const;

export const SECTION_TYPES: Record<string, readonly string[]> = {
  tops: ['shirt', 't-shirt', 'top', 'polo', 'blouse', 'tank-top'] as const,
  knitwear: ['sweater', 'hoodie', 'cardigan', 'vest'] as const,
  outerwear: ['jacket', 'coat', 'blazer'] as const,
  trousers: ['pants', 'jeans', 'shorts'] as const,
  footwear: ['shoes', 'sneakers', 'boots', 'sandals'] as const,
  accessories: ['hat', 'scarf', 'belt', 'tie', 'accessories'] as const,
  skirts: ['skirt'] as const,
  dresses: ['dress', 'jumpsuit'] as const,
  suits: ['suit'] as const,
  bags: ['bag'] as const,
  hosiery: ['socks', 'tights'] as const,
};

export const SECTION_FALLBACK: Record<string, string> = {
  skirts: 'trousers',
  dresses: 'unsorted',
  suits: 'outerwear',
  bags: 'accessories',
  hosiery: 'accessories',
};
