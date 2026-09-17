/**
 * Turning a table on screen into a file on somebody's desk.
 *
 * Extracted when Bookings wanted an export and would have been the THIRD copy
 * of this. Payments and Reports each had their own, including the same comment
 * about quoting, written out twice — which is how two exports end up disagreeing
 * about whether a comma is a separator or part of a class name.
 *
 * Everything here is browser-side, over data already fetched. There is no
 * export endpoint and does not need to be one: these files are the rows the
 * operator is looking at, which is also the honest limit — a screen showing a
 * hundred of four hundred bookings exports a hundred, and the table's own
 * footer is what says so.
 */

export type CsvCell = string | number | null | undefined;

/**
 * RFC 4180 quoting, applied to every cell rather than only the ones that look
 * dangerous.
 *
 * A class called `Wheel Throwing, Level 2` would otherwise split into two
 * columns, and a customer name containing a quote would break the row after
 * it. Both failures are silent, and both are discovered in somebody's
 * spreadsheet rather than here.
 */
function toRow(cells: CsvCell[]): string {
  return cells
    .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
    .join(',');
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map(toRow).join('\n');
}

/**
 * Builds the file and hands it to the browser.
 *
 * The leading BOM is what makes Excel read it as UTF-8. Without it a studio
 * called Café Ceramics exports as CafÃ© Ceramics, and the person who opens it
 * has no way to tell that the file was fine and the reader was not.
 */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob([`﻿${toCsv(rows)}`], {
    type: 'text/csv;charset=utf-8',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
