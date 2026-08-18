export interface UploadResult {
  key: string;
  url: string;
}

/** Abstracts "where garment photos live" behind a swappable interface - the only implementation
 *  today is DigitalOcean Spaces (spaces-storage.service.ts), but nothing in the rest of Fashion
 *  Mode depends on that directly. */
export interface StorageService {
  uploadOriginal(userId: number, publicId: string, buffer: Buffer, contentType: string, ext: string): Promise<UploadResult>;
  uploadThumbnail(userId: number, publicId: string, buffer: Buffer, ext: string): Promise<UploadResult>;
  delete(keys: string[]): Promise<void>;
  getPublicUrl(key: string): string;
}
