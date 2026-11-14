/**
 * What the automation needs from the project that hosts it: who the administrator is and how to
 * tell them something (WhatsApp in Canix). Each project plugs its own in at startup (index.ts);
 * until then the automation works without notices.
 */
export interface PublisherHost {
  adminId(): number | null;
  /** Sends the text (with a picture when given) and returns the message id, so a reaction to it can be recognized (null if unknown). */
  notify(text: string, opts?: { image?: Buffer }): Promise<string | null>;
}

let host: PublisherHost = { adminId: () => null, notify: async () => null };

export const setPublisherHost = (h: PublisherHost) => {
  host = h;
};
export const publisherHost = () => host;
