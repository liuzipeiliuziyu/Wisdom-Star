
export type Grade = 1 | 2 | 3 | 4 | 5 | 6;
export type Subject = 'Math' | 'Chinese' | 'English';
export type QuestionType = 'choice' | 'input';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options?: string[]; // 仅限选择题
  correctIndex?: number; // 仅限选择题
  points: number; // 本题分值 (2-8)
  explanation: string;
  visualPrompt: string;
  visualUrl?: string;
  sampleAnswer?: string; // 仅限填空题：参考答案
}

export interface UserProfile {
  name: string;
  grade: Grade;
  streak: number;
  coins: number;
  points: number;
  trophies: number;
  avatarUrl?: string; // 头像URL或Base64
  setsCompleted: Record<Subject, number>; // 每科完成套数
}

export interface SubjectProgress {
  subject: Subject;
  level: number;
  progress: number;
  lastTopic: string;
}
