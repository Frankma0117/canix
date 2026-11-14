/**
 * What the automation needs from the project that hosts it: who the administrator is and how to
 * tell them something (WhatsApp in Canix). Each project plugs its own in at startup (index.ts);
 * until then the automation works without notices.
 */
export interface PublisherHost {
  adminId(): number | null;
  notify(text: string): Promise<void>;
}

let host: PublisherHost = { adminId: () => null, notify: async () => {} };

export const setPublisherHost = (h: PublisherHost) => {
  host = h;
};
export const publisherHost = () => host;
