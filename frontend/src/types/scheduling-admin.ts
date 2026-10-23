import type { ProfessionalProfile } from './index.ts';

export interface ProRow {
  user_id: number;
  name: string | null;
  phone: string;
  profile: ProfessionalProfile | null;
}
