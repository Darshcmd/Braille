// ===== Braille data: alphabet, numbers, contractions =====
// Dot layout: 1 4 / 2 5 / 3 6 (indices 0-5)

export const BRAILLE_ALPHABET: Record<string, number[]> = {
  A: [1,0,0,0,0,0], B: [1,1,0,0,0,0], C: [1,0,0,1,0,0],
  D: [1,0,0,1,1,0], E: [1,0,0,0,1,0], F: [1,1,0,1,0,0],
  G: [1,1,0,1,1,0], H: [1,1,0,0,1,0], I: [0,1,0,1,0,0],
  J: [0,1,0,1,1,0], K: [1,0,1,0,0,0], L: [1,1,1,0,0,0],
  M: [1,0,1,1,0,0], N: [1,0,1,1,1,0], O: [1,0,1,0,1,0],
  P: [1,1,1,1,0,0], Q: [1,1,1,1,1,0], R: [1,1,1,0,1,0],
  S: [0,1,1,1,0,0], T: [0,1,1,1,1,0], U: [1,0,1,0,0,1],
  V: [1,1,1,0,0,1], W: [0,1,0,1,1,1], X: [1,0,1,1,0,1],
  Y: [1,0,1,1,1,1], Z: [1,0,1,0,1,1],
};

// Numbers use the same cells as A-J, preceded by the numeric indicator (dots 3,4,5,6)
// Since the indicator can't coexist on a single 6-dot cell, we display the letter cell
// and the indicator is shown in the on-screen glyph and spoken by the proctor.
export const BRAILLE_NUMBERS: Record<string, number[]> = {
  '1': [1,0,0,0,0,0], '2': [1,1,0,0,0,0], '3': [1,0,0,1,0,0],
  '4': [1,0,0,1,1,0], '5': [1,0,0,0,1,0], '6': [1,1,0,1,0,0],
  '7': [1,1,0,1,1,0], '8': [1,1,0,0,1,0], '9': [0,1,0,1,0,0],
  '0': [0,1,0,1,1,0],
};

// UEB contractions (common ones)
export const BRAILLE_CONTRACTIONS: Record<string, number[]> = {
  'AND': [1,1,1,1,0,1], 'FOR': [1,1,1,1,1,1], 'OF': [1,1,1,0,1,1],
  'THE': [0,1,1,1,0,1], 'WITH': [0,1,1,1,1,1], 'CH': [1,0,0,0,0,1],
  'GH': [1,1,0,0,0,1], 'SH': [1,0,0,1,0,1], 'TH': [1,0,0,1,1,1],
  'WH': [1,0,0,0,1,1], 'OU': [1,1,0,0,1,1], 'OW': [0,1,0,1,0,1],
  'ST': [0,0,1,1,0,0], 'ING': [0,0,1,1,0,1], 'BLE': [0,0,1,1,1,0],
};

export type Curriculum = 'alphabet' | 'numbers' | 'contractions';

export function getSymbols(curriculum: Curriculum): Record<string, number[]> {
  switch (curriculum) {
    case 'alphabet': return BRAILLE_ALPHABET;
    case 'numbers': return BRAILLE_NUMBERS;
    case 'contractions': return BRAILLE_CONTRACTIONS;
  }
}

// Returns 1-based dot indices (1-6) for the firmware SET_DOTS command
export function getDotIndices(pattern: number[]): number[] {
  return pattern.map((v, i) => v ? i + 1 : -1).filter(i => i >= 0);
}

export function getDotDescription(char: string, pattern: number[]): string {
  const dots = getDotIndices(pattern);
  if (dots.length === 0) return `The letter ${char} has no raised dots`;
  const names = ['top left', 'middle left', 'bottom left', 'top right', 'middle right', 'bottom right'];
  const dotNames = dots.map(d => `dot ${d} (${names[d - 1]})`);
  return `The letter ${char} has ${dots.length} dots: ${dotNames.join(', ')}`;
}