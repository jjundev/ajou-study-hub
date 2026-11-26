export const courseWorkers = {
  'logic-lab': { name: 'ajou-study-hub-logic-lab', binding: 'COURSE_LOGIC_LAB' },
  'life-science': { name: 'ajou-study-hub-life-science', binding: 'COURSE_LIFE_SCIENCE' },
  'circuits-2': { name: 'ajou-study-hub-circuits-2', binding: 'COURSE_CIRCUITS_2' },
  'data-structures': { name: 'ajou-study-hub-data-structures', binding: 'COURSE_DATA_STRUCTURES' },
  'ml-basics': { name: 'ajou-study-hub-ml-basics', binding: 'COURSE_ML_BASICS' },
} as const;

export type CourseId = keyof typeof courseWorkers;
export type StaticWorkerProfile = 'legacy' | 'pilot' | 'all';
export const courseIds = Object.keys(courseWorkers) as CourseId[];

export function isCourseId(value: string): value is CourseId {
  return Object.hasOwn(courseWorkers, value);
}

export function workerProfile(value = 'legacy'): StaticWorkerProfile {
  if (value === 'legacy' || value === 'pilot' || value === 'all') return value;
  throw Error('Unknown static Worker profile');
}

export function boundCourseIds(profile: StaticWorkerProfile): readonly CourseId[] {
  if (profile === 'legacy') return [];
  return profile === 'pilot' ? ['life-science'] : courseIds;
}
