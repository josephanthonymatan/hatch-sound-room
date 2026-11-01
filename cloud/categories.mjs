import catalog from './catalog.json' with { type: 'json' };
import { text } from './core.mjs';

// Categories live on sounds, so adding a sound and its category is one durable write.
export function categoryName(value, state) {
  const name = text(value, 'Category', 60).normalize('NFC').replace(/\s+/g, ' ');
  const categories = [...catalog, ...state.tracks, ...state.savedSounds].map(track => track.category).filter(Boolean);
  return categories.find(category => category.toLowerCase() === name.toLowerCase()) ?? name;
}
