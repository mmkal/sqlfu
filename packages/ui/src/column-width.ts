export type ColumnWidthInput = {
  readonly key: string;
  readonly header: string;
  readonly cells: readonly string[];
};

export type CalculatedColumnWidth = {
  readonly key: string;
  readonly minWidth: number;
  readonly idealWidth: number;
  readonly width: number;
};

const CHAR_WIDTH_PX = 8;
const CELL_PADDING_PX = 28;
const DEFAULT_MIN_WIDTH_PX = 100;
const MAX_IDEAL_WIDTH_PX = 420;

export function columnWidthAlgorithm(input: {
  readonly availableWidth: number;
  readonly columns: readonly ColumnWidthInput[];
}): readonly CalculatedColumnWidth[] {
  if (input.columns.length === 0) {
    return [];
  }

  const columns = input.columns.map((column) => {
    const headerWidth = measureTextWidth(column.header);
    const cellWidths = column.cells.map(measureTextWidth).sort((left, right) => left - right);
    const percentileWidth = percentile(cellWidths, 0.75);
    const maxWidth = cellWidths.at(-1) ?? headerWidth;
    const minWidth = Math.max(DEFAULT_MIN_WIDTH_PX, headerWidth);
    const idealWidth = clamp(Math.max(minWidth, percentileWidth), minWidth, Math.max(minWidth, MAX_IDEAL_WIDTH_PX));
    const flexCapacity = Math.max(0, maxWidth - idealWidth);

    return {
      key: column.key,
      minWidth,
      idealWidth,
      width: idealWidth,
      flexCapacity,
    };
  });

  let remaining = Math.max(0, input.availableWidth - sum(columns.map((column) => column.width)));
  if (remaining > 0) {
    const totalFlexCapacity = sum(columns.map((column) => column.flexCapacity));
    if (totalFlexCapacity > 0) {
      const distributed = distributeWidth(
        columns.map((column) => column.flexCapacity),
        remaining,
      );
      columns.forEach((column, index) => {
        column.width += distributed[index] ?? 0;
      });
      remaining = Math.max(0, input.availableWidth - sum(columns.map((column) => column.width)));
    }

    if (remaining > 0) {
      const even = distributeWidth(
        columns.map(() => 1),
        remaining,
      );
      columns.forEach((column, index) => {
        column.width += even[index] ?? 0;
      });
    }
  }

  return columns.map(({flexCapacity: _, ...column}) => column);
}

export function measureTextWidth(value: string) {
  return Math.max(0, value.length * CHAR_WIDTH_PX + CELL_PADDING_PX);
}

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) {
    return DEFAULT_MIN_WIDTH_PX;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * fraction)));
  return values[index] ?? DEFAULT_MIN_WIDTH_PX;
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distributeWidth(weights: readonly number[], space: number) {
  const totalWeight = sum(weights);
  if (space <= 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (weight / totalWeight) * space);
  const whole = exact.map((value) => Math.floor(value));
  let remainder = space - sum(whole);
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - whole[index]!,
    }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const item of order) {
    if (remainder <= 0) {
      break;
    }
    whole[item.index] = (whole[item.index] ?? 0) + 1;
    remainder -= 1;
  }

  return whole;
}
