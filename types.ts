
export enum UserLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced'
}

export enum PracticeGoal {
  DAILY = 'Daily Conversation',
  INTERVIEW = 'Job Interview',
  OFFICE = 'Office Talk',
  NEWS_EVENTS = 'News & Events',
  MOVIES = 'Cinema & Movies',
  SPORTS = 'Sports Talk',
  GK = 'General Knowledge',
  EXAM_PREP = 'Exam Preparation',
  SKILL_EVAL = 'Skill Evaluation'
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  type: 'text' | 'audio';
  timestamp: number;
}

export interface Session {
  id: string;
  date: number;
  level: UserLevel;
  goal: PracticeGoal;
  nativeLanguage: string;
  messages: Message[];
}
