import type { Exam, Lecture, LearningSignal, StudyMaterial } from '../types'

const keys = { lectures: 'lectureAI.lectures', exams: 'lectureAI.exams', signals: 'lectureAI.signals' }
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
function write<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)) }

export const sampleMaterial: StudyMaterial = {
  summary: 'Cells transfer energy stored in food into ATP, a form of energy they can use. This sample lesson is included so you can explore the interface before connecting an AI service.',
  topics: [
    { title: 'The big picture', explanation: 'Cells capture energy stored in glucose and transfer it into ATP, a form of energy the cell can use. Oxygen helps release more of this energy.', source: 'Sample source · slide 1' },
    { title: 'Glycolysis', explanation: 'This first step happens in the cell’s fluid. One glucose molecule is split into two smaller molecules, producing a small amount of ATP.', source: 'Sample source · slide 2' },
    { title: 'The mitochondria', explanation: 'Later steps happen inside the mitochondria. The cell uses oxygen to release more energy and produces carbon dioxide and water.', source: 'Sample source · slide 3' },
  ],
  flashcards: [
    { front: 'What is the main purpose of cellular respiration?', back: 'To transfer energy stored in glucose into ATP, which cells can use.' },
    { front: 'Where does glycolysis take place?', back: 'In the fluid part of the cell, outside the mitochondria.' },
    { front: 'What does ATP do for a cell?', back: 'It carries usable energy for jobs such as movement and building molecules.' },
  ],
  quiz: [
    { question: 'What is ATP’s role in the cell?', options: ['It carries usable energy for cell jobs', 'It stores genetic instructions', 'It surrounds the cell'], answer: 0, explanation: 'ATP transfers energy to the cell’s everyday processes.' },
    { question: 'Where does glycolysis happen?', options: ['In the cell fluid', 'Inside the nucleus', 'Outside the cell'], answer: 0, explanation: 'Glycolysis takes place in the cell’s fluid, the cytosol.' },
  ],
  beginner_steps: [
    { title: 'Living things are made of cells', explanation: 'A cell is a tiny living unit. Your body is made of many cells, and each one needs energy to do its job.', check: 'What does a cell need in order to do its work?' },
    { title: 'Food stores energy', explanation: 'Food contains molecules such as glucose. Think of glucose as a small energy package that cells can open.' },
    { title: 'Cells make that energy usable', explanation: 'Cellular respiration is a set of steps that transfers some of glucose’s energy into ATP. ATP is like a rechargeable energy token the cell can spend.' },
  ],
}

export function getDemoLectures(): Lecture[] { return read<Lecture[]>(keys.lectures, []) }
export function saveDemoLecture(lecture: Lecture) {
  const current = getDemoLectures().filter(item => item.id !== lecture.id)
  write(keys.lectures, [lecture, ...current])
}
export function removeDemoLecture(id: string) { write(keys.lectures, getDemoLectures().filter(item => item.id !== id)) }
export function getDemoExams(): Exam[] { return read<Exam[]>(keys.exams, []) }
export function saveDemoExam(exam: Exam) { write(keys.exams, [exam, ...getDemoExams().filter(item => item.id !== exam.id)]) }
export function removeDemoExam(id: string) { write(keys.exams, getDemoExams().filter(item => item.id !== id)) }
export function addDemoSignal(signal: LearningSignal) {
  const current = read<LearningSignal[]>(keys.signals, [])
  current.push(signal)
  write(keys.signals, current.slice(-500))
}
export function getDemoSignals(): LearningSignal[] { return read<LearningSignal[]>(keys.signals, []).reverse() }
