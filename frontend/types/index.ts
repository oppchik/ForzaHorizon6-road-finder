// Xbox Live types
export interface XboxProfile {
  gamertag: string;
  gamerscore: number;
  accountTier: string;
  xuid: string;
  displayPicRaw: string;
  tenure: string;
}

export interface XboxAchievement {
  id: string;
  name: string;
  description: string;
  isUnlocked: boolean;
  progressPercentage: number;
}

export interface XboxProfileResponse {
  success: boolean;
  profile?: XboxProfile;
  forzaAchievement?: XboxAchievement | null;
  error?: string;
}

// CV Analysis types
export interface RoadSegment {
  /** Bounding box in image coordinates (0–1 normalized) */
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Centroid in normalized coords */
  centerX: number;
  centerY: number;
  /** Estimated pixel area of the segment */
  pixelArea: number;
  /** Confidence score 0–1 */
  confidence: number;
}

export interface AnalysisResult {
  success: boolean;
  imageWidth: number;
  imageHeight: number;
  unexploredSegments: RoadSegment[];
  totalUnexplored: number;
  processingTimeMs: number;
  error?: string;
}

// API request/response types
export interface AnalyzeRequest {
  /** Base64-encoded image (without data: prefix) */
  imageBase64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface XboxLookupRequest {
  gamertag: string;
}

// Security / rate limiting
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
}
