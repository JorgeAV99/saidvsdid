export const slugify = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const parseTags = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);
export const formatTags = (tags: string[]): string => tags.map((t) => '#' + t).join(' ');
