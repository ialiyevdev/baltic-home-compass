import { describe, expect, it } from 'vitest';
import { splitAtSeriesBreaks } from './ComparisonChart';

describe('source breaks in charts', () => {
  it('starts a separate line at a flagged observation and preserves the measured value', () => {
    const data = [
      { period: '2023', EE: 16000, EE_status: null },
      { period: '2024', EE: 18000, EE_status: 'b' },
      { period: '2025', EE: 19000, EE_status: null },
    ];
    const result = splitAtSeriesBreaks(data, ['EE']);
    expect(result.breaks).toEqual(['2024']);
    expect(result.rows[0].EE_0).toBe(16000);
    expect(result.rows[1].EE_0).toBeUndefined();
    expect(result.rows[1].EE_1).toBe(18000);
    expect(result.rows[2].EE_1).toBe(19000);
    expect(data[1].EE).toBe(18000);
  });

  it('leaves missing values null within a segment', () => {
    const result = splitAtSeriesBreaks([
      { period: '2025-01', EE: 1.2, EE_status: null },
      { period: '2025-02', EE: null, EE_status: null },
      { period: '2025-03', EE: -0.5, EE_status: null },
    ], ['EE']);
    expect(result.rows[1].EE_0).toBeNull();
    expect(result.rows[2].EE_0).toBe(-0.5);
    expect(result.series).toHaveLength(1);
  });

  it('recognizes upper-case publisher break flags without changing them', () => {
    const result = splitAtSeriesBreaks([
      { period: '2024-01', EE: 3.5, EE_status: 'A' },
      { period: '2024-02', EE: 3.4, EE_status: 'B' },
    ], ['EE']);
    expect(result.breaks).toEqual(['2024-02']);
    expect(result.rows[1].EE_status).toBe('B');
  });
});
