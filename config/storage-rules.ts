export type StorageRule = { pattern: string; format: 'array' | 'object' | 'theme' | 'attempt'; fallback: string | null };
export const storageRules: StorageRule[] = [
 {pattern:'^od-note-read:',format:'array',fallback:'[]'},
 {pattern:'^od-review-solved:',format:'array',fallback:'[]'},
 {pattern:'^od-panels:',format:'object',fallback:'{}'},
 {pattern:'^od-theme$',format:'theme',fallback:'light'},
 {pattern:'^od-review-attempt:v1:',format:'attempt',fallback:null},
];
