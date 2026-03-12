export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";

export type HistoryItem = {
  id: string;
  video_id: string;
  video_url: string;
  video_title: string;
  channel_title: string;
  view_count: string;
  duration: string;
  score: number;
  diagnosis: DiagnosisJSON;
  status?: AnalysisStatus;
  video_data: {
    title: string;
    description: string;
    tags: string[];
    duration: string;
    viewCount: string;
    publishedAt: string;
    channelTitle: string;
  };
  created_at: string;
};

export type DiagnosisJSON = {
  score: number;
  ratio_analysis?: {
    ratio: number;
    interpretation: string;
    benchmark: string;
  };
  context?: string;
  verdict: string;
  overperformed?: boolean;
  performance_breakdown?: {
    titre: number;
    description: number;
    tags: number;
    timing: number;
    duree: number;
  };
  kills: string[];
  title_analysis?: string;
  title_original?: string;
  title_problem?: string;
  title_fixed: string;
  description_problem: string;
  description_fixed: string;
  tags_problem?: string;
  tags_analysis?: string;
  tags_fixed: string[];
  timing: string;
  thumbnail_tips?: string;
  quickwins: string[];
  next_video_idea?: string;
};
