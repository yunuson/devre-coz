import { Fraction } from './fraction';

/**
 * Solves A · x = b exactly with Gaussian elimination.
 * Returns null when A is singular. The inputs are not modified.
 */
export function solveLinearSystem(
  matrix: readonly (readonly Fraction[])[],
  rhs: readonly Fraction[],
): Fraction[] | null {
  const size = matrix.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]!]);

  for (let col = 0; col < size; col++) {
    let pivotRow = col;
    while (pivotRow < size && rows[pivotRow]![col]!.isZero()) {
      pivotRow++;
    }
    if (pivotRow === size) return null;
    [rows[col], rows[pivotRow]] = [rows[pivotRow]!, rows[col]!];

    const pivot = rows[col]!;
    const pivotValue = pivot[col]!;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const current = rows[row]!;
      const factor = current[col]!.div(pivotValue);
      if (factor.isZero()) continue;
      for (let c = col; c <= size; c++) {
        current[c] = current[c]!.sub(factor.mul(pivot[c]!));
      }
    }
  }

  return rows.map((row, index) => row[size]!.div(row[index]!));
}
