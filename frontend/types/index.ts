export interface XboxProfile {
  gamertag: string;
  gamerscore: number;
  accountTier: string;
  xuid: string;
  displayPicRaw: string;
  tenure: string;
}

export interface XboxProfileResponse {
  success: boolean;
  profile?: XboxProfile;
  forzaAchievement?: {
    id: string;
    name: string;
    description: string;
    isUnlocked: boolean;
    progressPercentage: number;
  } | null;
  error?: string;
}

export interface AnalysisResult {
  success: boolean;
  imageWidth: number;
  imageHeight: number;
  imageBase64: string;
  totalUnexplored: number;
  processingTimeMs: number;
  error?: string;
}
