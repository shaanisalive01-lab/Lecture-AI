export type Topic = { title: string; explanation: string; source?: string }
export type Flashcard = { front: string; back: string }
export type QuizQuestion = { question: string; options: string[]; answer: number; explanation: string }
export type BeginnerStep = { title: string; explanation: string; check?: string }
export type StudyMaterial = {
  summary: string
  topics: Topic[]
  flashcards: Flashcard[]
  quiz: QuizQuestion[]
  beginner_steps: BeginnerStep[]
}
export type Lecture = {
  id: string
  title: string
  course_name: string
  source_type: 'pdf' | 'ppt' | 'audio' | 'youtube' | 'topic' | 'demo'
  source_name: string
  source_url?: string
  storage_path?: string
  status: 'processing' | 'ready' | 'error'
  materials: StudyMaterial
  created_at: string
}
export type Exam = { id: string; title: string; course_name: string; exam_date: string; created_at: string }
export type StudyTask = { id: string; title: string; details: string; due_date: string; completed: boolean }
export type LearningSignal = {
  lecture_id?: string
  topic?: string
  method: string
  action: string
  correct?: boolean
  confidence?: number
  duration_seconds?: number
}
