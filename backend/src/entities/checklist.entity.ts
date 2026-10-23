export interface Checklist {
  id: number;
  user_id: number;
  name: string;
  // What it's a list of - see shared/utils/list-kinds.ts.
  kind: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  user_id: number;
  checklist_id: number;
  title: string;
  /** Done: bought, watched, read, listened, played - whatever the list is about. */
  checked: number;
  // Media library fields (lists of music, movies, series, books, games, podcasts) - NULL elsewhere.
  /** Artist, director, author, studio... */
  creator: string | null;
  genre: string | null;
  year: number | null;
  /** What it's about - from the person, or from the link it came with. */
  summary: string | null;
  url: string | null;
  /** The same link saved in the general link library, when it came with one. */
  link_id: number | null;
  /** 1-5 once watched/read/listened. */
  rating: number | null;
  /** The person's own notes about it. */
  notes: string | null;
  done_at: string | null;
  created_at: string;
}
